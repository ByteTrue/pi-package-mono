import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
  declaredModels,
  isBuiltInProviderId,
  resolveDefaultRoute,
  resolveProviderRoute,
} from './config.js';
import { discoverRemoteModels, isLikelyImageModel } from './discovery.js';
import {
  API_STYLES,
  BUILT_IN_MODELS,
  BUILT_IN_PROVIDER_IDS,
  DEFAULT_API_STYLE,
  DEFAULT_BASE_URL,
  ENV_VARS,
  PROVIDER_DISPLAY_NAME,
} from './models.js';
import { promptSecret } from './secret-input.js';
import {
  describeImageGenSettingsPath,
  loadImageGenSettings,
  updateImageGenSettings,
} from './settings.js';
import type {
  ApiStyle,
  BuiltInProviderId,
  ImageGenSettings,
  ImageModelEntry,
  ImageProvider,
  ResolvedProvider,
} from './types.js';

type Change<T> = { kind: 'keep' } | { kind: 'set'; value: T } | { kind: 'clear' };

type CredentialChange = Change<string> & { summary?: string };

/** The three per-provider settings that never change which model is default. */
type Connection = {
  baseUrl: Change<string>;
  credential: CredentialChange;
  headers: Change<Record<string, string>>;
  api?: Change<ApiStyle>;
};

type ProviderEntry = {
  id: string;
  label: string;
  builtIn: boolean;
  /** False for a built-in reached only through its standard env var. */
  hasRow: boolean;
};

const MANAGE_PROVIDERS = 'Manage providers';
const SET_OUTPUT = 'Set output directory';
const SHOW_CONFIG = 'Show effective configuration';
const ADD_PROVIDER = 'Add provider…';
const CUSTOM_PROVIDER = 'Custom provider / proxy / self-hosted…';
const EDIT_SETTINGS = 'Edit endpoint, credential, headers…';
const MANAGE_MODELS = 'Manage model list…';
const DELETE_PROVIDER = 'Delete provider';
const ADD_MODEL = 'Add model…';
const MANUAL_MODEL = 'Enter another remote model id…';

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

function describeCredential(value: string | undefined): string {
  if (!value) return 'none';
  return value.startsWith('$') ? value : 'configured (hidden)';
}

function modelLabel(id: string, marks: readonly string[]): string {
  return marks.length ? `${id} (${marks.join(', ')})` : id;
}

function modelAliases(models: readonly ImageModelEntry[], id: string): string[] {
  const entry = models.find((model) => model.id === id);
  return entry?.alias ? [entry.alias] : [];
}

function upsertModel(
  models: ImageProvider['models'],
  model: ImageModelEntry,
): ImageProvider['models'] {
  const next = [...(models ?? [])];
  const index = next.findIndex((entry) => (typeof entry === 'string' ? entry : entry.id) === model.id);
  if (index >= 0) next[index] = model;
  else next.push(model);
  return next;
}

function writeRowModels(row: ImageProvider, models: readonly ImageModelEntry[]): void {
  const kept = models.filter((model) => model.id);
  if (kept.length === 0) {
    delete row.models;
    return;
  }
  row.models = kept.map((model) => {
    const entry: ImageModelEntry = { id: model.id };
    if (model.alias) entry.alias = model.alias;
    if (model.name) entry.name = model.name;
    return entry;
  });
}

/** Ask for the wire protocol, marking the one a row already declares. */
async function promptApiStyle(
  ctx: ExtensionCommandContext,
  current: ApiStyle | undefined,
): Promise<ApiStyle | undefined> {
  const labels = API_STYLES.map((style) => `${style}${style === current ? ' (current)' : ''}`);
  const selected = await ctx.ui.select('Image API protocol', labels);
  if (!selected) return undefined;
  return API_STYLES[labels.indexOf(selected)];
}

async function promptConnection(
  ctx: ExtensionCommandContext,
  existing: ImageProvider | undefined,
  defaultBaseUrl: string,
  defaultEnvVar?: string,
): Promise<Connection | undefined> {
  const baseUrl = await inputChange(ctx, 'Base URL', existing?.baseUrl ?? defaultBaseUrl);
  if (!baseUrl) return undefined;
  const credential = await promptCredential(ctx, existing?.apiKey, defaultEnvVar);
  if (!credential) return undefined;
  const headers = await promptHeaders(ctx, credential.kind !== 'clear' && Boolean(existing?.headers));
  if (!headers) return undefined;
  return { baseUrl, credential, headers };
}

function applyConnection(row: ImageProvider, connection: Connection): void {
  applyChange(row as Record<string, unknown>, 'baseUrl', connection.baseUrl as Change<unknown>);
  if (connection.credential.kind === 'clear') row.apiKey = '';
  else applyChange(row as Record<string, unknown>, 'apiKey', connection.credential as Change<unknown>);
  if (connection.headers.kind === 'clear') row.headers = {};
  else applyChange(row as Record<string, unknown>, 'headers', connection.headers as Change<unknown>);
}

function credentialOf(connection: Connection, existing: ImageProvider | undefined): string {
  return connection.credential.summary ?? describeCredential(existing?.apiKey);
}

function headersOf(connection: Connection): string {
  return connection.headers.kind === 'set'
    ? `${Object.keys(connection.headers.value).length} set`
    : connection.headers.kind === 'clear'
      ? 'none'
      : 'kept';
}

function envVarFor(entry: ProviderEntry): string | undefined {
  return entry.builtIn ? ENV_VARS[entry.id as BuiltInProviderId] : undefined;
}

function defaultProviderId(effective: ImageGenSettings): string | undefined {
  const resolved = resolveDefaultRoute(effective);
  return 'error' in resolved ? undefined : resolved.provider.id;
}

function providerLabel(id: string, builtIn: boolean): string {
  return builtIn
    ? `${PROVIDER_DISPLAY_NAME[id as BuiltInProviderId]} — ${id}`
    : `${id} (custom)`;
}

function providerEntries(effective: ImageGenSettings): ProviderEntry[] {
  const rows = effective.providers ?? {};
  const list: ProviderEntry[] = [];
  for (const id of BUILT_IN_PROVIDER_IDS) {
    const hasRow = Boolean(rows[id]);
    if (!hasRow && !process.env[ENV_VARS[id]]) continue;
    list.push({ id, label: providerLabel(id, true), builtIn: true, hasRow });
  }
  for (const id of Object.keys(rows)) {
    if (isBuiltInProviderId(id)) continue;
    list.push({ id, label: providerLabel(id, false), builtIn: false, hasRow: true });
  }
  return list;
}

function routeFor(
  ctx: ExtensionCommandContext,
  entry: ProviderEntry,
  settings: ImageGenSettings,
): ResolvedProvider | undefined {
  const route = resolveProviderRoute(entry.id, settings);
  if (!route) {
    ctx.ui.notify(
      `Provider "${entry.id}" is missing its image API protocol. Edit the provider to set it.`,
      'error',
    );
  }
  return route;
}

/** Pick a remote model: probe the endpoint first, then fall back to the lists. */
async function chooseRemoteModel(
  ctx: ExtensionCommandContext,
  options: {
    entry: ProviderEntry;
    route: ResolvedProvider;
    declared: readonly ImageModelEntry[];
    currentId?: string | undefined;
    askAlias: boolean;
  },
): Promise<{ modelId: string; alias?: string } | undefined> {
  const { entry, route, declared, currentId, askAlias } = options;
  const discovered = await discoverRemoteModels({
    api: route.api,
    baseUrl: route.baseUrl,
    apiKey: route.apiKey,
    headers: route.headers,
  });
  const marksById = new Map<string, string[]>();
  const mark = (id: string, text: string): void => {
    marksById.set(id, [...(marksById.get(id) ?? []), text]);
  };
  for (const model of declared) if (model.alias) mark(model.id, model.alias);
  const knownIds: string[] = [];
  if (entry.builtIn) {
    for (const model of BUILT_IN_MODELS.filter((candidate) => candidate.provider === entry.id)) {
      knownIds.push(model.id);
      for (const alias of model.aliases ?? []) mark(model.id, alias);
    }
  }
  const ids = Array.from(new Set([...discovered, ...declared.map((model) => model.id), ...knownIds]));

  const manualPrompt = async (): Promise<string | undefined> => {
    const hint = entry.builtIn ? 'Example: google/gemini-3.1-flash-image' : undefined;
    const value = await ctx.ui.input(`Remote model id (${entry.id})`, hint);
    return value?.trim() ? value.trim() : undefined;
  };

  let modelId: string | undefined;
  if (ids.length === 0) {
    modelId = await manualPrompt();
  } else {
    const labels = ids.map((id) => {
      const marks = [...(marksById.get(id) ?? [])];
      if (discovered.includes(id) && isLikelyImageModel(id)) marks.push('image');
      if (id === currentId) marks.push('current');
      return modelLabel(id, marks);
    });
    const selected = await ctx.ui.select('Default image model', [...labels, MANUAL_MODEL]);
    if (!selected) return undefined;
    modelId = selected === MANUAL_MODEL ? await manualPrompt() : ids[labels.indexOf(selected)];
  }
  if (!modelId) return undefined;

  let alias: string | undefined;
  if (askAlias) {
    const input = await ctx.ui.input('Optional local alias', 'Enter for no alias');
    if (input === undefined) return undefined;
    alias = input.trim() || undefined;
  }
  return { modelId, alias };
}

async function chooseProvider(
  ctx: ExtensionCommandContext,
  effective: ImageGenSettings,
): Promise<{ providerId: string; api: ApiStyle; builtIn: boolean; defaultEnvVar?: string } | undefined> {
  const presetLabels = BUILT_IN_PROVIDER_IDS.map((id) => `${PROVIDER_DISPLAY_NAME[id]} — ${id}`);
  const selectedProvider = await ctx.ui.select('Provider', [...presetLabels, CUSTOM_PROVIDER]);
  if (!selectedProvider) return undefined;
  const index = presetLabels.indexOf(selectedProvider);
  if (index === -1) {
    const providerInput = await ctx.ui.input('Custom provider id', 'Letters, numbers, dot, underscore, hyphen');
    const providerId = providerInput?.trim() ?? '';
    if (!providerId) return undefined;
    if (!/^[A-Za-z0-9._-]+$/.test(providerId)) {
      ctx.ui.notify('Provider id may contain only letters, numbers, dot, underscore, and hyphen.', 'error');
      return undefined;
    }
    if (isBuiltInProviderId(providerId)) {
      ctx.ui.notify(`Provider id "${providerId}" is reserved by a built-in provider. Choose another id.`, 'error');
      return undefined;
    }
    const api = await promptApiStyle(ctx, effective.providers?.[providerId]?.api);
    return api ? { providerId, api, builtIn: false } : undefined;
  }
  const id = BUILT_IN_PROVIDER_IDS[index];
  if (!id) return undefined;
  return { providerId: id, api: DEFAULT_API_STYLE[id], builtIn: true, defaultEnvVar: ENV_VARS[id] };
}

/** The full setup wizard: it is the only path that can add a provider. */
async function addProvider(
  ctx: ExtensionCommandContext,
  effective: ImageGenSettings,
): Promise<void> {
  const choice = await chooseProvider(ctx, effective);
  if (!choice) return;
  const { providerId, builtIn } = choice;
  const existing = effective.providers?.[providerId];

  const defaultBaseUrl = existing?.baseUrl ?? DEFAULT_BASE_URL[choice.api];
  const connection = await promptConnection(ctx, existing, defaultBaseUrl, choice.defaultEnvVar);
  if (!connection) return;

  // Resolve the route the endpoint probe needs from a draft row, so the probe
  // sees exactly what saving this wizard step would write.
  const draft: ImageProvider = { ...(existing ?? {}) };
  if (!builtIn) draft.api = choice.api;
  applyConnection(draft, connection);
  const pending: ImageGenSettings = {
    ...effective,
    providers: { ...(effective.providers ?? {}), [providerId]: draft },
  };
  const entry: ProviderEntry = {
    id: providerId,
    label: providerLabel(providerId, builtIn),
    builtIn,
    hasRow: Boolean(existing),
  };
  const route = routeFor(ctx, entry, pending);
  if (!route) return;

  const pick = await chooseRemoteModel(ctx, {
    entry,
    route,
    declared: declaredModels(pending, providerId),
    askAlias: !builtIn,
  });
  if (!pick) return;

  const outputDir = await promptOutputDir(ctx, effective.outputDir);
  if (!outputDir) return;

  const summary = [
    `Provider: ${providerId}`,
    `Protocol: ${route.api}`,
    `Model: ${pick.modelId}${pick.alias ? ` as ${pick.alias}` : ''}`,
    `Credential: ${credentialOf(connection, existing)}`,
    `Headers: ${headersOf(connection)}`,
    `Output: ${outputDir}`,
    `Target: ${describeImageGenSettingsPath()}`,
  ].join('\n');
  if (!(await ctx.ui.confirm(builtIn ? 'Save image model configuration?' : 'Save custom image model?', summary))) {
    return;
  }

  const path = updateImageGenSettings((current) => {
    const previous = current.providers?.[providerId];
    const row: ImageProvider = { ...(previous ?? {}) };
    if (!builtIn) row.api = choice.api;
    applyConnection(row, connection);
    if (!builtIn) {
      row.models = upsertModel(
        previous?.models,
        pick.alias ? { id: pick.modelId, alias: pick.alias } : { id: pick.modelId },
      );
    }
    return {
      ...current,
      default: { provider: providerId, model: pick.modelId },
      outputDir,
      providers: { ...(current.providers ?? {}), [providerId]: row },
    };
  });
  ctx.ui.notify(
    builtIn ? `Image model configured in ${path}.` : `Custom image model configured in ${path}.`,
    'info',
  );
}

/** Point the default route at one of this provider's models. */
async function setDefaultModel(
  ctx: ExtensionCommandContext,
  effective: ImageGenSettings,
  entry: ProviderEntry,
): Promise<void> {
  const route = routeFor(ctx, entry, effective);
  if (!route) return;
  const current = resolveDefaultRoute(effective);
  const currentId = 'error' in current || current.provider.id !== entry.id
    ? undefined
    : current.remoteId;

  const pick = await chooseRemoteModel(ctx, {
    entry,
    route,
    declared: declaredModels(effective, entry.id),
    currentId,
    askAlias: false,
  });
  if (!pick) return;

  const summary = [
    `Provider: ${entry.id}`,
    `Model: ${pick.modelId}`,
    `Base URL: ${route.baseUrl}`,
    `Credential: ${describeCredential(effective.providers?.[entry.id]?.apiKey)}`,
    `Target: ${describeImageGenSettingsPath()}`,
  ].join('\n');
  if (!(await ctx.ui.confirm('Change default image model?', summary))) return;

  const path = updateImageGenSettings((currentSettings) => {
    const next: ImageGenSettings = { ...currentSettings, default: { provider: entry.id, model: pick.modelId } };
    const row = currentSettings.providers?.[entry.id];
    // Keep a list the user already maintains in sync; never materialize one.
    if (row?.models?.length) {
      const existing = row.models.find((model) => (typeof model === 'string' ? model : model.id) === pick.modelId);
      const alias = existing && typeof existing !== 'string' ? existing.alias : undefined;
      next.providers = {
        ...currentSettings.providers,
        [entry.id]: {
          ...row,
          models: upsertModel(row.models, alias ? { id: pick.modelId, alias } : { id: pick.modelId }),
        },
      };
    }
    return next;
  });
  ctx.ui.notify(`Default image model set to ${entry.id}/${pick.modelId} in ${path}.`, 'info');
}

async function editProviderSettings(
  ctx: ExtensionCommandContext,
  effective: ImageGenSettings,
  entry: ProviderEntry,
): Promise<void> {
  const existing = effective.providers?.[entry.id];
  const route = routeFor(ctx, entry, effective);
  if (!route) return;

  const api = entry.builtIn ? undefined : await promptApiStyle(ctx, route.api);
  if (!entry.builtIn && !api) return;

  const connection = await promptConnection(ctx, existing, route.baseUrl, envVarFor(entry));
  if (!connection) return;

  const summary = [
    `Provider: ${entry.id}`,
    `Protocol: ${api ?? route.api}`,
    `Base URL: ${connection.baseUrl.kind === 'set' ? connection.baseUrl.value : route.baseUrl}`,
    `Credential: ${credentialOf(connection, existing)}`,
    `Headers: ${headersOf(connection)}`,
    `Target: ${describeImageGenSettingsPath()}`,
  ].join('\n');
  if (!(await ctx.ui.confirm('Save provider settings?', summary))) return;

  const path = updateImageGenSettings((current) => {
    const row: ImageProvider = { ...(current.providers?.[entry.id] ?? {}) };
    if (api) row.api = api;
    applyConnection(row, connection);
    return { ...current, providers: { ...(current.providers ?? {}), [entry.id]: row } };
  });
  ctx.ui.notify(`Provider settings for ${entry.id} saved in ${path}.`, 'info');
}

async function manageModelList(
  ctx: ExtensionCommandContext,
  effective: ImageGenSettings,
  entry: ProviderEntry,
): Promise<void> {
  const models = declaredModels(effective, entry.id);
  const labels = models.map((model) => modelLabel(model.id, modelAliases(models, model.id)));
  const selected = await ctx.ui.select(
    `Model list — ${entry.id} (${models.length} declared)`,
    [...labels, ADD_MODEL],
  );
  if (!selected) return;
  if (selected === ADD_MODEL) {
    await addModel(ctx, effective, entry, models);
    return;
  }
  const target = models[labels.indexOf(selected)];
  if (target) await modelActions(ctx, effective, entry, models, target);
}

async function commitModelList(
  ctx: ExtensionCommandContext,
  entry: ProviderEntry,
  models: readonly ImageModelEntry[],
  title: string,
  detail: string,
  notify: string,
): Promise<void> {
  const summary = [
    detail,
    `Provider: ${entry.id}`,
    `Model list: ${models.map((model) => modelLabel(model.id, modelAliases(models, model.id))).join(', ') || '(none)'}`,
    `Target: ${describeImageGenSettingsPath()}`,
  ].join('\n');
  if (!(await ctx.ui.confirm(title, summary))) return;
  const path = updateImageGenSettings((current) => {
    const previous = current.providers?.[entry.id];
    const row: ImageProvider = { ...(previous ?? {}) };
    writeRowModels(row, models);
    return { ...current, providers: { ...(current.providers ?? {}), [entry.id]: row } };
  });
  ctx.ui.notify(`${notify} in ${path}.`, 'info');
}

async function addModel(
  ctx: ExtensionCommandContext,
  effective: ImageGenSettings,
  entry: ProviderEntry,
  models: readonly ImageModelEntry[],
): Promise<void> {
  const route = routeFor(ctx, entry, effective);
  if (!route) return;
  const pick = await chooseRemoteModel(ctx, { entry, route, declared: models, askAlias: true });
  if (!pick) return;
  const next = models.map((model) => ({ ...model }));
  const index = next.findIndex((model) => model.id === pick.modelId);
  const picked: ImageModelEntry = { id: pick.modelId, ...(pick.alias ? { alias: pick.alias } : {}) };
  if (index >= 0) next[index] = picked;
  else next.push(picked);
  await commitModelList(
    ctx,
    entry,
    next,
    'Add model to list?',
    `Add: ${pick.modelId}${pick.alias ? ` (alias ${pick.alias})` : ''}`,
    `Model ${pick.modelId} added to ${entry.id}`,
  );
}

async function modelActions(
  ctx: ExtensionCommandContext,
  effective: ImageGenSettings,
  entry: ProviderEntry,
  models: readonly ImageModelEntry[],
  target: ImageModelEntry,
): Promise<void> {
  const setAlias = 'Set alias…';
  const clearAlias = target.alias ? 'Remove alias' : undefined;
  const remove = 'Remove from list';
  const selected = await ctx.ui.select(
    `Model — ${entry.id}/${target.id}`,
    [setAlias, clearAlias, remove].filter((value): value is string => Boolean(value)),
  );
  if (!selected) return;

  if (selected === remove) {
    await commitModelList(
      ctx,
      entry,
      models.filter((model) => model.id !== target.id),
      'Remove model from list?',
      `Remove: ${target.id}`,
      `Model ${target.id} removed from ${entry.id}`,
    );
    return;
  }

  let alias: string | undefined;
  if (selected === clearAlias) {
    alias = undefined;
  } else {
    const value = await ctx.ui.input(
      'Model alias',
      target.alias ? `Current: ${target.alias} — Enter clears it` : 'Enter for no alias',
    );
    if (value === undefined) return;
    alias = value.trim() || undefined;
  }
  const next = models.map((model) => (model.id === target.id ? { ...model, alias } : { ...model }));
  await commitModelList(
    ctx,
    entry,
    next,
    'Save model alias?',
    `${target.id} → alias ${alias ?? '(none)'}`,
    `Alias for ${target.id} saved`,
  );
}

async function deleteProvider(
  ctx: ExtensionCommandContext,
  effective: ImageGenSettings,
  entry: ProviderEntry,
): Promise<void> {
  if (!entry.hasRow) {
    const variable = envVarFor(entry);
    ctx.ui.notify(
      `${entry.id} has no settings row to delete; it is configured through $${variable ?? 'its own credentials'}.`,
      'info',
    );
    return;
  }
  const isDefault = defaultProviderId(effective) === entry.id;
  const summary = [
    `Provider: ${entry.id}`,
    `Models declared: ${declaredModels(effective, entry.id).length}`,
    isDefault
      ? 'Default route: cleared — generation stops until you pick another model.'
      : 'Default route: unchanged.',
    `Target: ${describeImageGenSettingsPath()}`,
  ].join('\n');
  if (!(await ctx.ui.confirm('Delete provider?', summary))) return;

  const path = updateImageGenSettings((current) => {
    const next: ImageGenSettings = { ...current };
    const providers = { ...(current.providers ?? {}) };
    delete providers[entry.id];
    if (Object.keys(providers).length > 0) next.providers = providers;
    else delete next.providers;
    if (next.default?.provider === entry.id) delete next.default;
    return next;
  });
  const tail = entry.builtIn
    ? ` $${envVarFor(entry)} can bring it back without a settings row.`
    : '';
  ctx.ui.notify(`Deleted provider ${entry.id} from ${path}.${tail}`, 'info');
}

async function providerDetail(
  ctx: ExtensionCommandContext,
  effective: ImageGenSettings,
  entry: ProviderEntry,
): Promise<void> {
  const isCurrent = defaultProviderId(effective) === entry.id;
  const modelAction = isCurrent ? 'Change default model…' : 'Set as default model…';
  const action = await ctx.ui.select(
    `Provider: ${entry.label}`,
    [modelAction, EDIT_SETTINGS, MANAGE_MODELS, DELETE_PROVIDER],
  );
  if (!action) return;
  if (action === modelAction) return setDefaultModel(ctx, effective, entry);
  if (action === EDIT_SETTINGS) return editProviderSettings(ctx, effective, entry);
  if (action === MANAGE_MODELS) return manageModelList(ctx, effective, entry);
  return deleteProvider(ctx, effective, entry);
}

async function manageProviders(
  ctx: ExtensionCommandContext,
  effective: ImageGenSettings,
): Promise<void> {
  const entries = providerEntries(effective);
  const current = defaultProviderId(effective);
  const labels = entries.map((entry) =>
    `${entry.label}${entry.hasRow ? '' : ' (env)'}${entry.id === current ? ' — default' : ''}`,
  );
  const selected = await ctx.ui.select('Providers', [...labels, ADD_PROVIDER]);
  if (!selected) return;
  if (selected === ADD_PROVIDER) return addProvider(ctx, effective);
  const entry = entries[labels.indexOf(selected)];
  if (entry) return providerDetail(ctx, effective, entry);
}

function showConfiguration(ctx: ExtensionCommandContext): void {
  const settings = loadImageGenSettings();
  const resolved = resolveDefaultRoute(settings);
  const lines = [
    `Default model: ${settings.default ? `${settings.default.provider}/${settings.default.model}` : 'not configured'}`,
    `Output directory: ${settings.outputDir ?? '.pi/images'}`,
    `Config file: ${describeImageGenSettingsPath()}`,
  ];
  if ('error' in resolved) {
    if (settings.default) lines.push(`Route: ${resolved.error}`);
  } else {
    lines.push(`Provider: ${resolved.provider.name} (${resolved.provider.api})`);
    lines.push(`Credential: ${resolved.provider.apiKey ? 'configured (hidden)' : 'missing / not required'}`);
  }
  const providers = providerEntries(settings);
  if (providers.length) lines.push(`Providers: ${providers.map((entry) => entry.id).join(', ')}`);
  ctx.ui.notify(lines.join('\n'), settings.default ? 'info' : 'warning');
}

async function setOutputDirectory(
  ctx: ExtensionCommandContext,
  effective: ImageGenSettings,
): Promise<void> {
  const outputDir = await promptOutputDir(ctx, effective.outputDir);
  if (!outputDir) return;
  if (!(await ctx.ui.confirm('Save output directory?', `${outputDir}\n${describeImageGenSettingsPath()}`))) return;
  const path = updateImageGenSettings((current) => ({ ...current, outputDir }));
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
    const action = await ctx.ui.select('Image generation', [MANAGE_PROVIDERS, SET_OUTPUT, SHOW_CONFIG]);
    if (!action) return;
    if (action === SHOW_CONFIG) {
      showConfiguration(ctx);
      return;
    }
    const effective = loadImageGenSettings();
    if (action === SET_OUTPUT) {
      await setOutputDirectory(ctx, effective);
      return;
    }
    if (action === MANAGE_PROVIDERS) await manageProviders(ctx, effective);
  } catch (error) {
    ctx.ui.notify(
      `Failed to configure image generation: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}
