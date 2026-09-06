import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { runImageGenCommand } from '../config-command.js';
import { imageGenSettingsPath } from '../settings.js';
import { resolveModel } from '../config.js';

const originalHome = process.env.HOME;
const originalDir = process.env.PI_CODING_AGENT_DIR;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalDir;
});

function setup(
  selections: Record<string, string | ((options: string[]) => string)>,
  inputs: Record<string, string>,
): { cwd: string; ctx: ExtensionCommandContext; notices: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'pi-image-gen-command-'));
  const cwd = join(root, 'project');
  process.env.HOME = join(root, 'home');
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  const notices: string[] = [];
  const ctx = {
    cwd,
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
  return { cwd, ctx, notices };
}

function savedSection(): Record<string, any> {
  return JSON.parse(readFileSync(imageGenSettingsPath(), 'utf8'));
}

describe('/image-gen configuration', () => {
  it('configures a complete built-in route without manual JSON editing', async () => {
    const { cwd, ctx, notices } = setup(
      {
        'Image generation': 'Configure a built-in provider and model',
        'Built-in provider': 'OpenAI — openai',
        'Default image model': 'gpt-image-2',
        Credential: 'Use $OPENAI_API_KEY',
        'Extra request headers': 'No extra headers',
      },
      { 'Base URL': 'https://gateway.example/v1', 'Output directory': '.pi/generated' },
    );

    await runImageGenCommand(ctx);

    expect(savedSection()).toEqual({
      defaultModel: 'gpt-image-2',
      outputDir: '.pi/generated',
      providers: {
        openai: { baseUrl: 'https://gateway.example/v1', apiKey: '$OPENAI_API_KEY', headers: {} },
      },
    });
    expect(notices.at(-1)).toMatch(/configured/);
  });

  it('configures a custom provider, model alias, credential reference, and output', async () => {
    const { cwd, ctx } = setup(
      {
        'Image generation': 'Configure a custom provider and model',
        'Image API protocol': 'openai',
        Credential: 'Use an environment variable…',
        'Extra request headers': 'No extra headers',
      },
      {
        'Custom provider id': 'corp',
        'Remote model id': 'image-v1',
        'Optional local alias': 'hero',
        'Base URL': 'https://images.corp.example/v1',
        'Environment variable name': 'CORP_IMAGE_KEY',
        'Output directory': '.pi/art',
      },
    );

    await runImageGenCommand(ctx);

    expect(savedSection()).toEqual({
      defaultModel: 'corp/image-v1',
      outputDir: '.pi/art',
      customProviders: {
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
    const { cwd, ctx, notices } = setup(
      {
        'Image generation': 'Configure a custom provider and model',
      },
      { 'Custom provider id': 'openai' },
    );
    await runImageGenCommand(ctx);
    expect(notices.join('\n')).toMatch(/reserved by a built-in provider/i);
    expect(() => readFileSync(imageGenSettingsPath(), 'utf8')).toThrow();
  });

  it('saves a usable keyless built-in route for a local gateway', async () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'must-not-be-sent';
    try {
      const { cwd, ctx } = setup(
        {
          'Image generation': 'Configure a built-in provider and model',
          'Built-in provider': 'OpenAI — openai',
          'Default image model': 'gpt-image-2',
          Credential: 'No API key',
          'Extra request headers': 'No extra headers',
        },
        { 'Base URL': 'http://127.0.0.1:8188/v1', 'Output directory': '.pi/images' },
      );
      await runImageGenCommand(ctx);
      const settings = savedSection();
      expect(settings.providers?.openai).toMatchObject({ apiKey: '', headers: {} });
      const result = resolveModel('gpt-image-2', settings);
      if ('error' in result) throw new Error(result.error);
      expect(result.provider.apiKey).toBeUndefined();
      expect(result.provider.headers).toBeUndefined();
      expect(result.provider.baseUrl).toBe('http://127.0.0.1:8188/v1');
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  it('configures via unified "Configure image model" with preset provider', async () => {
    globalThis.fetch = (async () => ({ ok: false })) as unknown as typeof fetch;
    const { cwd, ctx, notices } = setup(
      {
        'Image generation': 'Configure image model',
        'Built-in provider': 'Google Gemini — gemini',
        'Default image model': 'gemini-3.1-flash-image (nano-banana-2)',
        Credential: 'Use $GEMINI_API_KEY',
        'Extra request headers': 'No extra headers',
      },
      { 'Output directory': '.pi/gemini-art' },
    );

    await runImageGenCommand(ctx);

    expect(savedSection()).toEqual({
      defaultModel: 'gemini-3.1-flash-image',
      outputDir: '.pi/gemini-art',
      providers: {
        gemini: { apiKey: '$GEMINI_API_KEY', headers: {} },
      },
    });
    expect(notices.at(-1)).toMatch(/configured/);
  });

  it('configures via unified "Configure image model" choosing Custom provider option', async () => {
    globalThis.fetch = (async () => ({ ok: false })) as unknown as typeof fetch;
    const { cwd, ctx } = setup(
      {
        'Image generation': 'Configure image model',
        'Built-in provider': 'Custom provider / proxy / self-hosted…',
        'Image API protocol': 'openai',
        Credential: 'Use an environment variable…',
        'Extra request headers': 'No extra headers',
      },
      {
        'Custom provider id': 'siliconflow',
        'Remote model id': 'Kwai-Kolors/Kolors',
        'Optional local alias': 'kolors',
        'Base URL': 'https://api.siliconflow.cn/v1',
        'Environment variable name': 'SILICONFLOW_KEY',
        'Output directory': '.pi/sf-images',
      },
    );

    await runImageGenCommand(ctx);

    expect(savedSection()).toEqual({
      defaultModel: 'siliconflow/Kwai-Kolors/Kolors',
      outputDir: '.pi/sf-images',
      customProviders: {
        siliconflow: {
          api: 'openai',
          baseUrl: 'https://api.siliconflow.cn/v1',
          apiKey: '$SILICONFLOW_KEY',
          headers: {},
          models: [{ id: 'Kwai-Kolors/Kolors', alias: 'kolors' }],
        },
      },
    });
  });

  it('configures using discovered models from endpoint', async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes('/models')) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: 'black-forest-labs/flux-schnell' }, { id: 'meta/llama-3' }],
          }),
        };
      }
      return { ok: false };
    }) as unknown as typeof fetch;

    try {
      const { cwd, ctx } = setup(
        {
          'Image generation': 'Configure image model',
          'Built-in provider': 'OpenAI — openai',
          'Default image model': 'black-forest-labs/flux-schnell (image)',
          Credential: 'Use $OPENAI_API_KEY',
          'Extra request headers': 'No extra headers',
        },
        { 'Output directory': '.pi/flux' },
      );

      await runImageGenCommand(ctx);

      expect(savedSection()).toEqual({
        defaultModel: 'openai/black-forest-labs/flux-schnell',
        outputDir: '.pi/flux',
        providers: {
          openai: { apiKey: '$OPENAI_API_KEY', headers: {} },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not write when the user cancels', async () => {
    const { cwd, ctx } = setup({ 'Image generation': undefined as unknown as string }, {});
    await runImageGenCommand(ctx);
    expect(() => readFileSync(imageGenSettingsPath(), 'utf8')).toThrow();
  });
});
