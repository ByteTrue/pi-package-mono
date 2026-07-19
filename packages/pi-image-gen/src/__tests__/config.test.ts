import { describe, expect, it } from 'vitest';
import { resolveModel } from '../config.js';
import type { ImageGenSettings } from '../types.js';

describe('resolveModel', () => {
  it('routes nano-banana alias to gemini provider', () => {
    process.env.GEMINI_API_KEY = 'gem-test';
    const result = resolveModel('nano-banana', {});
    if ('error' in result) throw new Error(result.error);
    expect(result.provider.id).toBe('gemini');
    expect(result.provider.api).toBe('gemini');
    expect(result.remoteId).toBe('gemini-2.5-flash-image');
    expect(result.provider.apiKey).toBe('gem-test');
  });

  it('routes gpt-image-2 to openai', () => {
    process.env.OPENAI_API_KEY = 'oa-test';
    const result = resolveModel('gpt-image-2', {});
    if ('error' in result) throw new Error(result.error);
    expect(result.provider.id).toBe('openai');
    expect(result.remoteId).toBe('gpt-image-2');
    expect(result.requestedId).toBe('gpt-image-2');
  });

  it('routes qwen-image-2.0 to dashscope', () => {
    process.env.DASHSCOPE_API_KEY = 'ds-test';
    const result = resolveModel('qwen-image-2.0', {});
    if ('error' in result) throw new Error(result.error);
    expect(result.provider.id).toBe('dashscope');
    expect(result.remoteId).toBe('qwen-image-2.0');
    expect(result.provider.baseUrl).toContain('dashscope.aliyuncs.com');
  });

  it('respects per-provider apiKey override with env-var interpolation', () => {
    process.env.MY_KEY = 'override-key';
    const settings: ImageGenSettings = {
      providers: {
        // Build the literal `${MY_KEY}` at runtime so the source code itself
        // does not contain a `${...}` sequence inside a single-quoted string,
        // which would trip lint/suspicious/noTemplateCurlyInString.
        openai: { apiKey: `$${'{MY_KEY}'}`, baseUrl: 'https://proxy.example.com/v1' },
      },
    };
    const result = resolveModel('gpt-image-2', settings);
    if ('error' in result) throw new Error(result.error);
    expect(result.provider.apiKey).toBe('override-key');
    expect(result.provider.baseUrl).toBe('https://proxy.example.com/v1');
  });

  it('matches a custom provider by alias', () => {
    process.env.MY_SD_KEY = 'sd-key';
    const settings: ImageGenSettings = {
      customProviders: {
        'my-sd': {
          api: 'openai',
          baseUrl: 'https://api.my-sd.test/v1',
          apiKey: '$MY_SD_KEY',
          models: [{ id: 'sd-3-large', alias: 'sd3' }, 'sd-3-medium'],
        },
      },
    };
    const a = resolveModel('sd3', settings);
    if ('error' in a) throw new Error(a.error);
    expect(a.provider.id).toBe('my-sd');
    expect(a.provider.builtIn).toBe(false);
    expect(a.remoteId).toBe('sd-3-large');
    expect(a.provider.apiKey).toBe('sd-key');

    const b = resolveModel('sd-3-medium', settings);
    if ('error' in b) throw new Error(b.error);
    expect(b.remoteId).toBe('sd-3-medium');
  });

  it('supports <provider>/<remote-id> fallback for openrouter', () => {
    process.env.OPENROUTER_API_KEY = 'or-test';
    const result = resolveModel('openrouter/google/gemini-2.5-flash-image', {});
    if ('error' in result) throw new Error(result.error);
    expect(result.provider.id).toBe('openrouter');
    expect(result.remoteId).toBe('google/gemini-2.5-flash-image');
  });

  it('returns an error for an unknown model', () => {
    const result = resolveModel('totally-made-up-model', {});
    expect('error' in result).toBe(true);
  });

  it('error message lists configured customProviders when nothing matched', () => {
    const result = resolveModel('totally-made-up-model', {
      customProviders: {
        narrow: {
          api: 'openai',
          baseUrl: 'https://narrow.example/',
          apiKey: 'k',
          models: [{ id: 'x' }],
        },
      },
    });
    if (!('error' in result)) throw new Error('expected error');
    expect(result.error).toContain('narrow');
    expect(result.error).toContain('catch-all');
  });

  it('routes any model through a customProvider that omits `models` (catch-all)', () => {
    const settings: ImageGenSettings = {
      customProviders: {
        amaster: {
          api: 'openai',
          baseUrl: 'https://credits.amaster.ai/',
          apiKey: 'sk-test',
        },
      },
    };
    const result = resolveModel('any-future-model-id', settings);
    if ('error' in result) throw new Error(result.error);
    expect(result.provider.id).toBe('amaster');
    expect(result.remoteId).toBe('any-future-model-id');
  });

  it('routes a built-in model id through a catch-all when its built-in provider has no api key', () => {
    delete process.env.DASHSCOPE_API_KEY;
    const settings: ImageGenSettings = {
      customProviders: {
        amaster: {
          api: 'openai',
          baseUrl: 'https://credits.amaster.ai/',
          apiKey: 'sk-test',
        },
      },
    };
    const result = resolveModel('qwen-image-2.0', settings);
    if ('error' in result) throw new Error(result.error);
    expect(result.provider.id).toBe('amaster');
    expect(result.remoteId).toBe('qwen-image-2.0');
  });

  it('explicit `models` list still wins over catch-all', () => {
    const settings: ImageGenSettings = {
      customProviders: {
        narrow: {
          api: 'openai',
          baseUrl: 'https://narrow.example/',
          apiKey: 'k1',
          models: [{ id: 'sd-3', alias: 'sd' }],
        },
        wide: {
          api: 'openai',
          baseUrl: 'https://wide.example/',
          apiKey: 'k2',
        },
      },
    };
    const a = resolveModel('sd', settings);
    if ('error' in a) throw new Error(a.error);
    expect(a.provider.id).toBe('narrow');

    const b = resolveModel('something-else', settings);
    if ('error' in b) throw new Error(b.error);
    expect(b.provider.id).toBe('wide');
  });
});
