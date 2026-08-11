import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { resolveModel } from './config.js';
import {
  BUILT_IN_MODELS,
  DEFAULT_API_STYLE,
  DEFAULT_BASE_URL,
  ENV_VARS,
  PROVIDER_DISPLAY_NAME,
} from './models.js';
import { promptSecret } from './secret-input.js';
import {
  imageGenSettingsPath,
  loadImageGenSettings,
  readImageGenSettingsLayer,
  updateImageGenSettings,
  type SettingsScope,
} from './settings.js';
import type {
  ApiStyle,
  BuiltInProviderId,
  BuiltInProviderOverride,
  CustomImageModel,
  CustomImageProvider,
  ImageGenSettings,
} from './types.js';

const BUILT_IN_PROVIDERS = [
  'openai',
  'gemini',
  'dashscope',
  'ark',
  'openrouter',
] as const satisfies readonly BuiltInProviderId[];

const API_STYLES = ['openai', 'gemini', 'dashscope', 'ark', 'openrouter'] as const satisfies readonly ApiStyle[];

type Change<T> = { kind: 'keep' } | { kind: 'set'; value: T } | { kind: 'clear' };

type CredentialChange = Change<string> & { summary?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function applyChange<T extends Record<string, unknown>, K extends keyof T>(
  target: T,
  key: K,
  change: Change<T[K]>,
): void {
  if (change.kind === 'set') target[key] = change.value;
  if (change.kind === 'clear') delete target[key];
}

async function chooseScope(ctx: ExtensionCommandContext): Promise<SettingsScope | undefined> {
  const globalLabel = `Global — ${imageGenSettingsPath(ctx.cwd, 'global')}`;
  const projectLabel = `Project — ${imageGenSettingsPath(ctx.cwd, 'project')}`;
  const options = [globalLabel];
  if (ctx.isProjectTrusted()) options.push(projectLabel);
  const selected = await ctx.ui.select('Where should image generation settings be saved?', options);
  if (!selected) return undefined;
  return selected === projectLabel ? 'project' : 'global';
}

async function inputChange(
  ctx: ExtensionCommandContext,
  title: string,
  current: string | undefined,
): Promise<Change<string> | undefined> {
  const placeholder = current
    ? `Current: ${current} — Enter keeps it; type "default" to clear`
    : 'Enter keeps the provider default';
  const value = await ctx.ui.input(title, placeholder);
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return { kind: 'keep' };
  if (trimmed.toLowerCase() === 'default') return { kind: 'clear' };
  return { kind: 'set', value: trimmed };
}

async function promptCredential(
  ctx: ExtensionCommandContext,
  current: string | undefined,
  defaultEnvVar?: string,
): Promise<CredentialChange | undefined> {
  const keep = current ? 'Keep current credential' : undefined;
  const env = defaultEnvVar ? `Use $${defaultEnvVar}` : 'Use an environment variable…';
  const literal = 'Paste API key (masked)';
  const none = 'No API key';
  const options = [keep, env, literal, none].filter((value): value is string => Boolean(value));
  const selected = await ctx.ui.select('Credential', options);
  if (!selected) return undefined;
  if (selected === keep) return { kind: 'keep', summary: 'kept' };
  if (selected === none) return { kind: 'clear', summary: 'none' };
  if (selected === literal) {
    const value = await promptSecret(ctx.ui, 'API key (masked)');
    if (value === undefined) return undefined;
    if (!value.trim()) {
      ctx.ui.notify('API key cannot be empty.', 'error');
      return undefined;
    }
    return { kind: 'set', value: value.trim(), summary: 'literal key stored' };
  }

  let variable = defaultEnvVar;
  if (!variable) {
    const value = await ctx.ui.input('Environment variable name', 'Example: IMAGE_PROVIDER_API_KEY');
    if (value === undefined) return undefined;
    variable = value.trim();
  }
  if (!variable || !/^[A-Z_][A-Z0-9_]*$/.test(variable)) {
    ctx.ui.notify('Environment variable names must match [A-Z_][A-Z0-9_]*.', 'error');
    return undefined;
  }
  return { kind: 'set', value: `$${variable}`, summary: `$${variable}` };
}

async function promptHeaders(
  ctx: ExtensionCommandContext,
  hasCurrent: boolean,
): Promise<Change<Record<string, string>> | undefined> {
  const keep = hasCurrent ? 'Keep current headers' : undefined;
  const replace = 'Set headers as JSON…';
  const clear = 'No extra headers';
  const selected = await ctx.ui.select(
    'Extra request headers',
    [keep, replace, clear].filter((value): value is string => Boolean(value)),
  );
  if (!selected) return undefined;
  if (selected === keep) return { kind: 'keep' };
  if (selected === clear) return { kind: 'clear' };

  const text = await ctx.ui.editor('Headers JSON object', '{\n  \n}');
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || Object.values(parsed).some((value) => typeof value !== 'string')) {
      throw new Error('expected an object whose values are strings');
    }
    return { kind: 'set', value: parsed as Record<string, string> };
  } catch (error) {
    ctx.ui.notify(
      `Invalid headers JSON: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return undefined;
  }
}

async function promptOutputDir(
  ctx: ExtensionCommandContext,
  current: string | undefined,
): Promise<string | undefined> {
  const value = await ctx.ui.input(
    'Output directory',
    current ? `Current: ${current} — Enter keeps it` : 'Default: .pi/images',
  );
  if (value === undefined) return undefined;
  return value.trim() || current || '.pi/images';
}

function providerOverride(
  current: BuiltInProviderOverride | undefined,
  baseUrl: Change<string>,
  credential: CredentialChange,
  headers: Change<Record<string, string>>,
): BuiltInProviderOverride {
  const next: BuiltInProviderOverride = { ...(current ?? {}) };
  applyChange(next as Record<string, unknown>, 'baseUrl', baseUrl as Change<unknown>);
  if (credential.kind === 'clear') next.apiKey = '';
  else applyChange(next as Record<string, unknown>, 'apiKey', credential as Change<unknown>);
  if (headers.kind === 'clear') next.headers = {};
  else applyChange(next as Record<string, unknown>, 'headers', headers as Change<unknown>);
  return next;
}

function describeCredential(value: string | undefined): string {
  if (!value) return 'none';
  return value.startsWith('$') ? value : 'configured (hidden)';
}

function modelLabel(id: string, aliases: readonly string[] | undefined): string {
  return aliases?.length ? `${id} (${aliases.join(', ')})` : id;
}

async function configureBuiltIn(
  ctx: ExtensionCommandContext,
  scope: SettingsScope,
  effective: ImageGenSettings,
): Promise<void> {
  const labels = BUILT_IN_PROVIDERS.map((id) => `${PROVIDER_DISPLAY_NAME[id]} — ${id}`);
  const selectedProvider = await ctx.ui.select('Built-in provider', labels);
  if (!selectedProvider) return;
  const provider = BUILT_IN_PROVIDERS[labels.indexOf(selectedProvider)];
  if (!provider) return;

  const known = BUILT_IN_MODELS.filter((model) => model.provider === provider);
  const customLabel = 'Enter another remote model id…';
  let remoteModel: string;
  let defaultModel: string;
  if (known.length > 0) {
    const modelLabels = known.map((model) => modelLabel(model.id, model.aliases));
    const selectedModel = await ctx.ui.select('Default image model', [...modelLabels, customLabel]);
    if (!selectedModel) return;
    if (selectedModel === customLabel) {
      const value = await ctx.ui.input('Remote model id');
      if (!value?.trim()) return;
      remoteModel = value.trim();
      defaultModel = `${provider}/${remoteModel}`;
    } else {
      const model = known[modelLabels.indexOf(selectedModel)];
      if (!model) return;
      remoteModel = model.id;
      defaultModel = model.id;
    }
  } else {
    const value = await ctx.ui.input('Remote model id', 'Example: google/gemini-3.1-flash-image');
    if (!value?.trim()) return;
    remoteModel = value.trim();
    defaultModel = `${provider}/${remoteModel}`;
  }

  const existing = effective.providers?.[provider];
  const baseUrl = await inputChange(ctx, 'Base URL', existing?.baseUrl ?? DEFAULT_BASE_URL[provider]);
  if (!baseUrl) return;
  const credential = await promptCredential(ctx, existing?.apiKey, ENV_VARS[provider]);
  if (!credential) return;
  const headers = await promptHeaders(ctx, credential.kind !== 'clear' && Boolean(existing?.headers));
  if (!headers) return;
  const outputDir = await promptOutputDir(ctx, effective.outputDir);
  if (!outputDir) return;

  const summary = [
    `Provider: ${provider}`,
    `Model: ${remoteModel}`,
    `Credential: ${credential.summary ?? describeCredential(existing?.apiKey)}`,
    `Headers: ${headers.kind === 'set' ? Object.keys(headers.value).length : headers.kind}`,
    `Output: ${outputDir}`,
    `Target: ${imageGenSettingsPath(ctx.cwd, scope)}`,
  ].join('\n');
  if (!(await ctx.ui.confirm('Save image model configuration?', summary))) return;

  const path = updateImageGenSettings(ctx.cwd, scope, (current) => ({
    ...current,
    defaultModel,
    outputDir,
    providers: {
      ...(current.providers ?? {}),
      [provider]: providerOverride(current.providers?.[provider], baseUrl, credential, headers),
    },
  }));
  ctx.ui.notify(`Image model configured in ${path}.`, 'info');
}

function upsertModel(
  models: Array<string | CustomImageModel> | undefined,
  model: CustomImageModel,
): Array<string | CustomImageModel> {
  const next = [...(models ?? [])];
  const index = next.findIndex((entry) => (typeof entry === 'string' ? entry : entry.id) === model.id);
  if (index >= 0) next[index] = model;
  else next.push(model);
  return next;
}

async function configureCustom(
  ctx: ExtensionCommandContext,
  scope: SettingsScope,
  effective: ImageGenSettings,
): Promise<void> {
  const providerInput = await ctx.ui.input('Custom provider id', 'Letters, numbers, dot, underscore, hyphen');
  if (!providerInput?.trim()) return;
  const providerId = providerInput.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(providerId)) {
    ctx.ui.notify('Provider id may contain only letters, numbers, dot, underscore, and hyphen.', 'error');
    return;
  }
  if (BUILT_IN_PROVIDERS.includes(providerId as BuiltInProviderId)) {
    ctx.ui.notify(`Provider id "${providerId}" is reserved by a built-in provider. Choose another id.`, 'error');
    return;
  }
  const existing = effective.customProviders?.[providerId];

  const apiLabels = API_STYLES.map((api) => `${api}${existing?.api === api ? ' (current)' : ''}`);
  const selectedApi = await ctx.ui.select('Image API protocol', apiLabels);
  if (!selectedApi) return;
  const api = API_STYLES[apiLabels.indexOf(selectedApi)];
  if (!api) return;

  const modelIdInput = await ctx.ui.input('Remote model id');
  if (!modelIdInput?.trim()) return;
  const modelId = modelIdInput.trim();
  const aliasInput = await ctx.ui.input('Optional local alias', 'Enter for no alias');
  if (aliasInput === undefined) return;
  const alias = aliasInput.trim() || undefined;

  const baseUrl = await inputChange(
    ctx,
    'Base URL',
    existing?.baseUrl ?? DEFAULT_BASE_URL[api as BuiltInProviderId],
  );
  if (!baseUrl) return;
  const credential = await promptCredential(ctx, existing?.apiKey);
  if (!credential) return;
  const headers = await promptHeaders(ctx, credential.kind !== 'clear' && Boolean(existing?.headers));
  if (!headers) return;
  const outputDir = await promptOutputDir(ctx, effective.outputDir);
  if (!outputDir) return;

  const summary = [
    `Provider: ${providerId}`,
    `Protocol: ${api}`,
    `Model: ${modelId}${alias ? ` as ${alias}` : ''}`,
    `Credential: ${credential.summary ?? describeCredential(existing?.apiKey)}`,
    `Headers: ${headers.kind === 'set' ? Object.keys(headers.value).length : headers.kind}`,
    `Output: ${outputDir}`,
    `Target: ${imageGenSettingsPath(ctx.cwd, scope)}`,
  ].join('\n');
  if (!(await ctx.ui.confirm('Save custom image model?', summary))) return;

  const path = updateImageGenSettings(ctx.cwd, scope, (current) => {
    const previous = current.customProviders?.[providerId];
    const next: CustomImageProvider = {
      ...(previous ?? {}),
      api,
      models: upsertModel(previous?.models, alias ? { id: modelId, alias } : { id: modelId }),
    };
    applyChange(next as Record<string, unknown>, 'baseUrl', baseUrl as Change<unknown>);
    if (credential.kind === 'clear') next.apiKey = '';
    else applyChange(next as Record<string, unknown>, 'apiKey', credential as Change<unknown>);
    if (headers.kind === 'clear') next.headers = {};
    else applyChange(next as Record<string, unknown>, 'headers', headers as Change<unknown>);
    return {
      ...current,
      defaultModel: `${providerId}/${modelId}`,
      outputDir,
      customProviders: { ...(current.customProviders ?? {}), [providerId]: next },
    };
  });
  ctx.ui.notify(`Custom image model configured in ${path}.`, 'info');
}

function showConfiguration(ctx: ExtensionCommandContext): void {
  const settings = loadImageGenSettings(ctx.cwd, ctx.isProjectTrusted());
  const lines = [
    `Default model: ${settings.defaultModel ?? 'not configured'}`,
    `Output directory: ${settings.outputDir ?? '.pi/images'}`,
    `Project settings: ${ctx.isProjectTrusted() ? 'trusted and active' : 'not active'}`,
  ];
  if (settings.defaultModel) {
    const resolved = resolveModel(settings.defaultModel, settings);
    if ('error' in resolved) lines.push(`Route: ${resolved.error}`);
    else {
      lines.push(`Provider: ${resolved.provider.name} (${resolved.provider.api})`);
      lines.push(`Credential: ${resolved.provider.apiKey ? 'configured (hidden)' : 'missing / not required'}`);
    }
  }
  const custom = Object.keys(settings.customProviders ?? {});
  if (custom.length) lines.push(`Custom providers: ${custom.join(', ')}`);
  ctx.ui.notify(lines.join('\n'), settings.defaultModel ? 'info' : 'warning');
}

async function setOutputDirectory(
  ctx: ExtensionCommandContext,
  scope: SettingsScope,
  effective: ImageGenSettings,
): Promise<void> {
  const outputDir = await promptOutputDir(ctx, effective.outputDir);
  if (!outputDir) return;
  if (!(await ctx.ui.confirm('Save output directory?', `${outputDir}\n${imageGenSettingsPath(ctx.cwd, scope)}`))) return;
  const path = updateImageGenSettings(ctx.cwd, scope, (current) => ({ ...current, outputDir }));
  ctx.ui.notify(`Output directory saved in ${path}.`, 'info');
}

export async function runImageGenCommand(
  ctx: ExtensionCommandContext,
  args = '',
): Promise<void> {
  const requested = args.trim().toLowerCase();
  if (requested === 'list' || requested === 'show') {
    showConfiguration(ctx);
    return;
  }
  if (requested === 'reload') {
    ctx.ui.notify('Image generation settings are read on every run; nothing is cached.', 'info');
    return;
  }
  if (ctx.mode !== 'tui') {
    ctx.ui.notify('/image-gen configuration is available in interactive TUI mode.', 'error');
    return;
  }

  try {
    const configureBuiltInLabel = 'Configure a built-in provider and model';
    const configureCustomLabel = 'Configure a custom provider and model';
    const outputLabel = 'Set output directory';
    const showLabel = 'Show effective configuration';
    const action = await ctx.ui.select('Image generation', [
      configureBuiltInLabel,
      configureCustomLabel,
      outputLabel,
      showLabel,
    ]);
    if (!action) return;
    if (action === showLabel) {
      showConfiguration(ctx);
      return;
    }

    const scope = await chooseScope(ctx);
    if (!scope) return;
    readImageGenSettingsLayer(ctx.cwd, scope); // fail closed before collecting secrets
    const effective = loadImageGenSettings(ctx.cwd, ctx.isProjectTrusted());
    if (action === configureBuiltInLabel) await configureBuiltIn(ctx, scope, effective);
    else if (action === configureCustomLabel) await configureCustom(ctx, scope, effective);
    else if (action === outputLabel) await setOutputDirectory(ctx, scope, effective);
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
  }
}
