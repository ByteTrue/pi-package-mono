import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { runImageGenCommand } from '../config-command.js';
import { resolveDefaultRoute } from '../config.js';
import { imageGenSettingsPath } from '../settings.js';

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'DASHSCOPE_API_KEY',
  'OPENROUTER_API_KEY',
  'ARK_API_KEY',
] as const;

const OPENAI = 'OpenAI — openai';
const GEMINI = 'Google Gemini — gemini';
const OPENROUTER = 'OpenRouter — openrouter';
const CORP_LABEL = 'corp (custom)';
const CORP_ROW = { api: 'openai', baseUrl: 'https://images.corp.example/v1', apiKey: 'k' };

const originalHome = process.env.HOME;
const originalDir = process.env.PI_CODING_AGENT_DIR;
const originalFetch = globalThis.fetch;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  // Model discovery must never reach the network; cases wanting a populated
  // list install their own mock with mockModels().
  globalThis.fetch = (async () => ({ ok: false })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalDir;
});

type Answers = Record<string, string | ((options: string[]) => string | undefined) | undefined>;

function setup(
  selections: Answers,
  inputs: Record<string, string> = {},
): { ctx: ExtensionCommandContext; notices: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'pi-image-gen-command-'));
  process.env.HOME = join(root, 'home');
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  const notices: string[] = [];
  const ctx = {
    cwd: join(root, 'project'),
    mode: 'tui',
    ui: {
      select: async (title: string, options: string[]) => {
        const answer = selections[title];
        return typeof answer === 'function' ? answer(options) : answer;
      },
      input: async (title: string) => inputs[title] ?? '',
      editor: async () => undefined,
      confirm: async () => true,
      notify: (message: string) => notices.push(message),
      custom: async () => undefined,
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, notices };
}

function writeSettings(settings: Record<string, unknown>): void {
  mkdirSync(dirname(imageGenSettingsPath()), { recursive: true });
  writeFileSync(imageGenSettingsPath(), `${JSON.stringify({ version: 2, ...settings }, null, 2)}\n`, 'utf8');
}

function savedSettings(): Record<string, any> {
  return JSON.parse(readFileSync(imageGenSettingsPath(), 'utf8'));
}

function mockModels(ids: string[]): void {
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ data: ids.map((id) => ({ id })) }),
  })) as unknown as typeof fetch;
}

/** Walk Manage providers → one provider → one action, then run the command. */
async function inProvider(
  provider: string,
  action: string,
  existing: Record<string, unknown>,
  selections: Answers = {},
  inputs: Record<string, string> = {},
): Promise<{ notices: string[] }> {
  const { ctx, notices } = setup(
    {
      'Image generation': 'Manage providers',
      Providers: (options: string[]) => options.find((option) => option.startsWith(provider)) ?? undefined,
      [`Provider: ${provider}`]: action,
      ...selections,
    },
    inputs,
  );
  writeSettings(existing);
  await runImageGenCommand(ctx);
  return { notices };
}

describe('/image-gen menu shape', () => {
  it('offers provider management, the output directory, and the effective view', async () => {
    let top: string[] = [];
    const { ctx } = setup({ 'Image generation': (options) => { top = options; return undefined; } });
    await runImageGenCommand(ctx);
    expect(top).toEqual(['Manage providers', 'Set output directory', 'Show effective configuration']);
  });

  it('marks the default provider and hides built-ins with no row and no env key', async () => {
    process.env.GEMINI_API_KEY = 'env-key';
    let options: string[] = [];
    const { ctx } = setup({
      'Image generation': 'Manage providers',
      Providers: (listed) => {
        options = listed;
        return undefined;
      },
    });
    writeSettings({
      default: { provider: 'corp', model: 'image-v1' },
      providers: { corp: CORP_ROW, gemini: { apiKey: '$GEMINI_API_KEY' } },
    });
    await runImageGenCommand(ctx);
    expect(options).toEqual([GEMINI, `${CORP_LABEL} — default`, 'Add provider…']);
  });

  it('lists a built-in that is configured only through the environment', async () => {
    process.env.GEMINI_API_KEY = 'env-key';
    let options: string[] = [];
    const { ctx } = setup({
      'Image generation': 'Manage providers',
      Providers: (listed) => {
        options = listed;
        return undefined;
      },
    });
    writeSettings({ outputDir: '.pi/images' });
    await runImageGenCommand(ctx);
    expect(options).toEqual([`${GEMINI} (env)`, 'Add provider…']);
  });

  it('keeps the management surface TUI-only but still answers list', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-image-gen-rpc-'));
    process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
    const notices: string[] = [];
    const ctx = {
      cwd: root,
      mode: 'rpc',
      ui: {
        select: async () => {
          throw new Error('menus must not open outside the TUI');
        },
        input: async () => undefined,
        editor: async () => undefined,
        confirm: async () => false,
        notify: (message: string) => notices.push(message),
        custom: async () => undefined,
      },
    } as unknown as ExtensionCommandContext;

    await runImageGenCommand(ctx);
    expect(notices.at(-1)).toMatch(/interactive TUI mode/);

    writeSettings({ default: { provider: 'openai', model: 'gpt-image-2' } });
    await runImageGenCommand(ctx, 'list');
    expect(notices.at(-1)).toContain('openai/gpt-image-2');
  });
});

describe('/image-gen add provider', () => {
  function wizard(extra: Answers = {}, inputs: Record<string, string> = {}) {
    return setup(
      {
        'Image generation': 'Manage providers',
        Providers: 'Add provider…',
        Provider: OPENAI,
        'Default image model': 'gpt-image-2',
        Credential: 'Use $OPENAI_API_KEY',
        'Extra request headers': 'No extra headers',
        ...extra,
      },
      { 'Base URL': 'https://gateway.example/v1', 'Output directory': '.pi/generated', ...inputs },
    );
  }

  it('writes the route, output directory, and provider row in one pass', async () => {
    const { ctx, notices } = wizard();
    await runImageGenCommand(ctx);
    expect(savedSettings()).toEqual({
      version: 2,
      default: { provider: 'openai', model: 'gpt-image-2' },
      outputDir: '.pi/generated',
      providers: { openai: { baseUrl: 'https://gateway.example/v1', apiKey: '$OPENAI_API_KEY', headers: {} } },
    });
    expect(notices.at(-1)).toMatch(/configured/);
  });

  it('adds a custom provider with protocol, alias, and credential reference', async () => {
    const { ctx } = wizard(
      {
        Provider: 'Custom provider / proxy / self-hosted…',
        'Image API protocol': 'openai',
        Credential: 'Use an environment variable…',
      },
      {
        'Custom provider id': 'corp',
        'Remote model id (corp)': 'image-v1',
        'Optional local alias': 'hero',
        'Base URL': 'https://images.corp.example/v1',
        'Environment variable name': 'CORP_IMAGE_KEY',
        'Output directory': '.pi/art',
      },
    );
    await runImageGenCommand(ctx);
    expect(savedSettings()).toEqual({
      version: 2,
      default: { provider: 'corp', model: 'image-v1' },
      outputDir: '.pi/art',
      providers: {
        corp: {
          api: 'openai',
          baseUrl: 'https://images.corp.example/v1',
          apiKey: '$CORP_IMAGE_KEY',
          headers: {},
          models: [{ id: 'image-v1', alias: 'hero' }],
        },
      },
    });
  });

  it('rejects custom provider ids reserved by built-in routing', async () => {
    const { ctx, notices } = wizard(
      { Provider: 'Custom provider / proxy / self-hosted…' },
      { 'Custom provider id': 'openai' },
    );
    await runImageGenCommand(ctx);
    expect(notices.join('\n')).toMatch(/reserved by a built-in provider/i);
    expect(() => readFileSync(imageGenSettingsPath(), 'utf8')).toThrow();
  });

  it('saves a keyless route that sends no credential', async () => {
    process.env.OPENAI_API_KEY = 'must-not-be-sent';
    const { ctx } = wizard(
      { Credential: 'No API key' },
      { 'Base URL': 'http://127.0.0.1:8188/v1', 'Output directory': '.pi/images' },
    );
    await runImageGenCommand(ctx);

    expect(savedSettings().providers.openai).toMatchObject({ apiKey: '', headers: {} });
    const resolved = resolveDefaultRoute(savedSettings());
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.provider.apiKey).toBeUndefined();
    expect(resolved.provider.headers).toBeUndefined();
    expect(resolved.provider.baseUrl).toBe('http://127.0.0.1:8188/v1');
  });

  it('stores a discovered remote id containing slashes verbatim', async () => {
    mockModels(['black-forest-labs/flux-schnell', 'meta/llama-3']);
    const { ctx } = wizard(
      { 'Default image model': 'black-forest-labs/flux-schnell (image)' },
      { 'Base URL': '', 'Output directory': '.pi/flux' },
    );
    await runImageGenCommand(ctx);
    expect(savedSettings()).toEqual({
      version: 2,
      default: { provider: 'openai', model: 'black-forest-labs/flux-schnell' },
      outputDir: '.pi/flux',
      providers: { openai: { apiKey: '$OPENAI_API_KEY', headers: {} } },
    });
  });

  it('does not write when the user cancels at the top menu', async () => {
    const { ctx } = setup({ 'Image generation': undefined });
    await runImageGenCommand(ctx);
    expect(() => readFileSync(imageGenSettingsPath(), 'utf8')).toThrow();
  });
});

describe('/image-gen default model', () => {
  it('changes only the default route on a configured provider', async () => {
    mockModels(['black-forest-labs/flux-2-pro', 'meta/llama-3']);
    const { notices } = await inProvider(
      OPENAI,
      'Change default model…',
      {
        default: { provider: 'openai', model: 'gpt-image-2' },
        outputDir: '.pi/keep-me',
        providers: { openai: { baseUrl: 'https://gateway.example/v1', apiKey: 'sk-stored', headers: { 'x-a': 'b' } } },
      },
      { 'Default image model': 'black-forest-labs/flux-2-pro (image)' },
    );

    expect(savedSettings()).toEqual({
      version: 2,
      default: { provider: 'openai', model: 'black-forest-labs/flux-2-pro' },
      outputDir: '.pi/keep-me',
      providers: {
        openai: { baseUrl: 'https://gateway.example/v1', apiKey: 'sk-stored', headers: { 'x-a': 'b' } },
      },
    });
    expect(notices.at(-1)).toContain('openai/black-forest-labs/flux-2-pro');
    expect(notices.join('\n')).not.toContain('sk-stored');
  });

  it('sets the default on a built-in whose only credential is the environment', async () => {
    process.env.OPENROUTER_API_KEY = 'env-key';
    mockModels(['google/gemini-3-pro-image']);
    await inProvider(
      OPENROUTER,
      'Set as default model…',
      { outputDir: '.pi/openrouter' },
      { 'Default image model': 'google/gemini-3-pro-image (image)' },
    );

    expect(savedSettings()).toEqual({
      version: 2,
      outputDir: '.pi/openrouter',
      default: { provider: 'openrouter', model: 'google/gemini-3-pro-image' },
    });
  });

  it('upserts a newly discovered model into a list the user maintains', async () => {
    mockModels(['brand-new-image']);
    await inProvider(
      CORP_LABEL,
      'Change default model…',
      {
        default: { provider: 'corp', model: 'image-v1' },
        providers: { corp: { ...CORP_ROW, models: [{ id: 'image-v1', alias: 'hero' }] } },
      },
      { 'Default image model': 'brand-new-image (image)' },
    );

    expect(savedSettings().providers.corp.models).toEqual([
      { id: 'image-v1', alias: 'hero' },
      { id: 'brand-new-image' },
    ]);
  });

  it('keeps an alias when re-selecting the current model', async () => {
    await inProvider(
      CORP_LABEL,
      'Change default model…',
      {
        default: { provider: 'corp', model: 'image-v1' },
        providers: { corp: { ...CORP_ROW, models: [{ id: 'image-v1', alias: 'hero' }, { id: 'image-v0' }] } },
      },
      { 'Default image model': 'image-v1 (hero, current)' },
    );

    const settings = savedSettings();
    expect(settings.default).toEqual({ provider: 'corp', model: 'image-v1' });
    expect(settings.providers.corp.models).toEqual([{ id: 'image-v1', alias: 'hero' }, { id: 'image-v0' }]);
    const resolved = resolveDefaultRoute(settings);
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.requestedId).toBe('hero');
  });

  it('never materializes a model list while changing the default', async () => {
    mockModels(['some-new-image-model']);
    await inProvider(
      CORP_LABEL,
      'Change default model…',
      { default: { provider: 'corp', model: 'old-image' }, providers: { corp: CORP_ROW } },
      { 'Default image model': 'some-new-image-model (image)' },
    );
    expect(savedSettings().providers.corp).toEqual(CORP_ROW);
  });

  it('offers known built-in models with their aliases when the probe fails', async () => {
    await inProvider(
      GEMINI,
      'Set as default model…',
      { providers: { gemini: { apiKey: '$GEMINI_API_KEY' } } },
      { 'Default image model': 'gemini-3-pro-image (nano-banana-pro)' },
    );
    expect(savedSettings().default).toEqual({ provider: 'gemini', model: 'gemini-3-pro-image' });
  });

  it('asks for a manual id when nothing is known about the provider', async () => {
    const { notices } = await inProvider(
      CORP_LABEL,
      'Set as default model…',
      { providers: { corp: CORP_ROW } },
      {},
      { 'Remote model id (corp)': 'hand-typed-image' },
    );
    expect(savedSettings().default).toEqual({ provider: 'corp', model: 'hand-typed-image' });
    expect(notices.at(-1)).toContain('corp/hand-typed-image');
  });
});

describe('/image-gen provider settings', () => {
  it('replaces the credential and keeps the endpoint and headers', async () => {
    const { notices } = await inProvider(
      OPENAI,
      'Edit endpoint, credential, headers…',
      {
        default: { provider: 'openai', model: 'gpt-image-2' },
        providers: { openai: { baseUrl: 'https://gateway.example/v1', apiKey: 'sk-stored', headers: { 'x-a': 'b' } } },
      },
      { Credential: 'Use $OPENAI_API_KEY', 'Extra request headers': 'Keep current headers' },
    );

    expect(savedSettings()).toEqual({
      version: 2,
      default: { provider: 'openai', model: 'gpt-image-2' },
      providers: {
        openai: { baseUrl: 'https://gateway.example/v1', apiKey: '$OPENAI_API_KEY', headers: { 'x-a': 'b' } },
      },
    });
    expect(notices.join('\n')).not.toContain('sk-stored');
  });

  it('changes a custom provider protocol without touching its model list', async () => {
    await inProvider(
      CORP_LABEL,
      'Edit endpoint, credential, headers…',
      { default: { provider: 'corp', model: 'image-v1' }, providers: { corp: { ...CORP_ROW, models: [{ id: 'image-v1' }] } } },
      {
        'Image API protocol': 'gemini',
        Credential: 'Keep current credential',
        'Extra request headers': 'No extra headers',
      },
    );

    expect(savedSettings().providers.corp).toEqual({
      ...CORP_ROW,
      api: 'gemini',
      headers: {},
      models: [{ id: 'image-v1' }],
    });
  });

  it('creates the settings row for a provider that lived only in the environment', async () => {
    process.env.OPENAI_API_KEY = 'env-key';
    await inProvider(
      OPENAI,
      'Edit endpoint, credential, headers…',
      { default: { provider: 'openai', model: 'gpt-image-2' } },
      { Credential: 'No API key', 'Extra request headers': 'No extra headers' },
      { 'Base URL': 'http://127.0.0.1:8188/v1' },
    );
    expect(savedSettings().providers).toEqual({
      openai: { baseUrl: 'http://127.0.0.1:8188/v1', apiKey: '', headers: {} },
    });
  });
});

describe('/image-gen model list', () => {
  it('adds a discovered model with an alias', async () => {
    mockModels(['brand-new-image']);
    await inProvider(
      CORP_LABEL,
      'Manage model list…',
      { providers: { corp: { ...CORP_ROW, models: [{ id: 'image-v1', alias: 'hero' }] } } },
      {
        'Model list — corp (1 declared)': 'Add model…',
        'Default image model': 'brand-new-image (image)',
      },
      { 'Optional local alias': 'newhero' },
    );

    expect(savedSettings().providers.corp.models).toEqual([
      { id: 'image-v1', alias: 'hero' },
      { id: 'brand-new-image', alias: 'newhero' },
    ]);
  });

  it('materializes a list on a built-in provider that had none', async () => {
    await inProvider(
      GEMINI,
      'Manage model list…',
      { providers: { gemini: { apiKey: '$GEMINI_API_KEY' } } },
      {
        'Model list — gemini (0 declared)': 'Add model…',
        'Default image model': 'gemini-2.5-flash-image (nano-banana)',
      },
      { 'Optional local alias': 'banana' },
    );
    expect(savedSettings().providers).toEqual({
      gemini: { apiKey: '$GEMINI_API_KEY', models: [{ id: 'gemini-2.5-flash-image', alias: 'banana' }] },
    });
  });

  it('sets an alias on an existing entry', async () => {
    await inProvider(
      CORP_LABEL,
      'Manage model list…',
      { providers: { corp: { ...CORP_ROW, models: [{ id: 'image-v1', alias: 'hero' }, { id: 'image-v0' }] } } },
      {
        'Model list — corp (2 declared)': 'image-v0',
        'Model — corp/image-v0': 'Set alias…',
      },
      { 'Model alias': 'legacy' },
    );
    expect(savedSettings().providers.corp.models).toEqual([
      { id: 'image-v1', alias: 'hero' },
      { id: 'image-v0', alias: 'legacy' },
    ]);
  });

  it('removes an alias without removing the model', async () => {
    await inProvider(
      CORP_LABEL,
      'Manage model list…',
      { providers: { corp: { ...CORP_ROW, models: [{ id: 'image-v1', alias: 'hero' }] } } },
      {
        'Model list — corp (1 declared)': 'image-v1 (hero)',
        'Model — corp/image-v1': 'Remove alias',
      },
    );
    expect(savedSettings().providers.corp.models).toEqual([{ id: 'image-v1' }]);
  });

  it('drops the models key when the last entry is removed', async () => {
    await inProvider(
      CORP_LABEL,
      'Manage model list…',
      { providers: { corp: { ...CORP_ROW, models: [{ id: 'image-v1' }] } } },
      {
        'Model list — corp (1 declared)': 'image-v1',
        'Model — corp/image-v1': 'Remove from list',
      },
    );
    expect(savedSettings().providers.corp).toEqual(CORP_ROW);
  });
});

describe('/image-gen delete provider', () => {
  it('keeps the default route when another provider is deleted', async () => {
    await inProvider(
      CORP_LABEL,
      'Delete provider',
      {
        default: { provider: 'openai', model: 'gpt-image-2' },
        providers: { openai: { apiKey: '$OPENAI_API_KEY' }, corp: CORP_ROW },
      },
    );
    expect(savedSettings()).toEqual({
      version: 2,
      default: { provider: 'openai', model: 'gpt-image-2' },
      providers: { openai: { apiKey: '$OPENAI_API_KEY' } },
    });
  });

  it('clears the default route when the provider behind it is deleted', async () => {
    await inProvider(
      CORP_LABEL,
      'Delete provider',
      { default: { provider: 'corp', model: 'image-v1' }, providers: { corp: CORP_ROW } },
    );
    expect(savedSettings()).toEqual({ version: 2 });
  });

  it('refuses to delete a built-in that has no settings row', async () => {
    process.env.OPENAI_API_KEY = 'env-key';
    const { notices } = await inProvider(
      OPENAI,
      'Delete provider',
      { default: { provider: 'openai', model: 'gpt-image-2' } },
    );
    expect(notices.at(-1)).toMatch(/no settings row/i);
    expect(savedSettings()).toEqual({
      version: 2,
      default: { provider: 'openai', model: 'gpt-image-2' },
    });
  });
});
