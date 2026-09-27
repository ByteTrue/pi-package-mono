import { afterEach, describe, expect, it } from 'vitest';
import { declaredModels, resolveDefaultRoute, resolveProviderRoute } from '../config.js';
import type { ImageGenSettings } from '../types.js';

const ENV_KEYS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'DASHSCOPE_API_KEY', 'ARK_API_KEY', 'OPENROUTER_API_KEY'];
const originalEnv = new Map(ENV_KEYS.map((name) => [name, process.env[name]]));

function clearProviderEnv(): void {
  for (const name of ENV_KEYS) delete process.env[name];
}

afterEach(() => {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function route(settings: ImageGenSettings) {
  const resolved = resolveDefaultRoute(settings);
  if ('error' in resolved) throw new Error(resolved.error);
  return resolved;
}

function routeError(settings: ImageGenSettings): string {
  const resolved = resolveDefaultRoute(settings);
  if (!('error' in resolved)) throw new Error('expected the route to fail');
  return resolved.error;
}

describe('resolveProviderRoute', () => {
  it('builds a built-in from its template and standard env var', () => {
    clearProviderEnv();
    process.env.GEMINI_API_KEY = 'gem-test';
    const provider = resolveProviderRoute('gemini', {});
    expect(provider).toMatchObject({
      id: 'gemini',
      api: 'gemini',
      builtIn: true,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'gem-test',
    });
  });

  it('lets a row override the base URL, credential source and display name', () => {
    clearProviderEnv();
    process.env.MY_KEY = 'override-key';
    const settings: ImageGenSettings = {
      providers: {
        // Built with runtime concatenation so the source does not contain a
        // literal ${...} sequence, which lint flags as a suspicious template.
        openai: { baseUrl: 'https://proxy.example.com/v1', apiKey: `$${'{MY_KEY}'}`, name: 'Corp proxy' },
      },
    };
    expect(resolveProviderRoute('openai', settings)).toMatchObject({
      apiKey: 'override-key',
      baseUrl: 'https://proxy.example.com/v1',
      name: 'Corp proxy',
    });
  });

  it('resolves environment references inside headers', () => {
    clearProviderEnv();
    process.env.CORP_HEADER_TOKEN = 'header-secret';
    const provider = resolveProviderRoute('corp', {
      providers: { corp: { api: 'openai', baseUrl: 'https://images.example/v1', headers: { authorization: 'Bearer $CORP_HEADER_TOKEN' } } },
    });
    expect(provider?.headers).toEqual({ authorization: 'Bearer header-secret' });
  });

  it('rejects a custom row that never chose a protocol', () => {
    clearProviderEnv();
    expect(resolveProviderRoute('corp', { providers: { corp: { baseUrl: 'https://images.example/v1' } } })).toBeUndefined();
  });

  it('returns nothing for an unknown provider id', () => {
    expect(resolveProviderRoute('nope', { providers: { openai: { apiKey: 'k' } } })).toBeUndefined();
  });
});

describe('declaredModels', () => {
  it('normalizes string and object entries', () => {
    const settings: ImageGenSettings = {
      providers: { corp: { api: 'openai', models: ['image-v0', { id: 'image-v1', alias: 'hero' }] } },
    };
    expect(declaredModels(settings, 'corp')).toEqual([{ id: 'image-v0' }, { id: 'image-v1', alias: 'hero' }]);
    expect(declaredModels(settings, 'missing')).toEqual([]);
  });
});

describe('resolveDefaultRoute', () => {
  it('routes an explicit provider and model pair', () => {
    clearProviderEnv();
    process.env.OPENAI_API_KEY = 'oa-test';
    const resolved = route({ default: { provider: 'openai', model: 'gpt-image-2' } });
    expect(resolved.provider.id).toBe('openai');
    expect(resolved.remoteId).toBe('gpt-image-2');
    expect(resolved.requestedId).toBe('gpt-image-2');
  });

  it('prefers a declared alias as the requested id', () => {
    clearProviderEnv();
    const resolved = route({
      default: { provider: 'corp', model: 'image-v1' },
      providers: {
        corp: { api: 'openai', baseUrl: 'https://images.example/v1', apiKey: 'k', models: [{ id: 'image-v1', alias: 'hero' }] },
      },
    });
    expect(resolved.remoteId).toBe('image-v1');
    expect(resolved.requestedId).toBe('hero');
    expect(resolved.provider.builtIn).toBe(false);
  });

  it('routes a model id that contains slashes', () => {
    clearProviderEnv();
    const resolved = route({
      default: { provider: 'openrouter', model: 'google/gemini-3.1-flash-image' },
      providers: { openrouter: { apiKey: 'or-test' } },
    });
    expect(resolved.remoteId).toBe('google/gemini-3.1-flash-image');
    expect(resolved.provider.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('accepts a keyless built-in the user configured explicitly', () => {
    clearProviderEnv();
    const resolved = route({
      default: { provider: 'openai', model: 'gpt-image-2' },
      providers: { openai: { baseUrl: 'http://127.0.0.1:8188/v1' } },
    });
    expect(resolved.provider.apiKey).toBeUndefined();
    expect(resolved.provider.baseUrl).toBe('http://127.0.0.1:8188/v1');
  });

  it('reports an unset default', () => {
    clearProviderEnv();
    expect(routeError({})).toMatch(/default model is not set/i);
  });

  it('reports a half-specified default', () => {
    clearProviderEnv();
    process.env.OPENAI_API_KEY = 'oa-test';
    expect(routeError({ default: { model: 'gpt-image-2' } as never })).toMatch(/default.provider/);
    expect(routeError({ default: { provider: 'openai' } as never })).toMatch(/default.model/);
  });

  it('names the configured providers when the default points at an unknown one', () => {
    const error = routeError({
      default: { provider: 'ghost', model: 'x' },
      providers: { corp: { api: 'openai', baseUrl: 'https://c.test/', apiKey: 'k' } },
    });
    expect(error).toMatch(/unknown provider "ghost".*corp/s);
  });

  it('points at the env var when a built-in route was never set up', () => {
    clearProviderEnv();
    const error = routeError({ default: { provider: 'ark', model: 'doubao-seedream-5-0-260128' } });
    expect(error).toMatch(/no settings row and no API key.*ARK_API_KEY/s);
  });
});
