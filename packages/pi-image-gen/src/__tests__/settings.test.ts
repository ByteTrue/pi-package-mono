import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveDefaultRoute } from '../config.js';
import {
  imageGenSettingsPath,
  loadImageGenSettings,
  readImageGenSettingsLayer,
  updateImageGenSettings,
} from '../settings.js';

const ENV_KEYS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'DASHSCOPE_API_KEY', 'ARK_API_KEY', 'OPENROUTER_API_KEY'];

const originalHome = process.env.HOME;
const originalDir = process.env.PI_CODING_AGENT_DIR;
const originalUserProfile = process.env.USERPROFILE;
const originalEnvKeys = new Map(ENV_KEYS.map((name) => [name, process.env[name]]));

afterEach(() => {
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalDir;
  for (const [name, value] of originalEnvKeys) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function isolated(): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-image-gen-settings-'));
  process.env.USERPROFILE = join(root, 'home');
  process.env.HOME = join(root, 'home');
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  for (const name of ENV_KEYS) delete process.env[name];
  return root;
}

function settingsDir(): string {
  const dir = join(process.env.PI_CODING_AGENT_DIR!, 'pi-image-gen');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSettingsFile(text: string): string {
  const dir = settingsDir();
  const path = join(dir, 'settings.json');
  writeFileSync(path, text);
  return text;
}

function writeLegacy(document: unknown): string {
  return writeSettingsFile(`${JSON.stringify(document, null, 2)}\n`);
}

describe('image generation settings', () => {
  it('stores config in a dedicated versioned file outside Pi settings.json', () => {
    isolated();
    updateImageGenSettings(() => ({ default: { provider: 'openai', model: 'gpt-image-2' } }));
    const path = imageGenSettingsPath();
    expect(path).toBe(join(process.env.PI_CODING_AGENT_DIR!, 'pi-image-gen', 'settings.json'));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      version: 2,
      default: { provider: 'openai', model: 'gpt-image-2' },
    });
    expect(
      () => readFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'settings.json'), 'utf8'),
    ).toThrow();
  });

  it('preserves unrelated top-level keys and writes mode 0600', () => {
    isolated();
    const path = imageGenSettingsPath();
    updateImageGenSettings(() => ({ default: { provider: 'openai', model: 'gpt-image-2' } }));
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    saved.theme = 'dark';
    writeFileSync(path, `${JSON.stringify(saved)}\n`);
    chmodSync(path, 0o644);

    updateImageGenSettings((current) => ({ ...current, outputDir: '.pi/art' }));
    const next = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
    expect(next.theme).toBe('dark');
    expect(next.version).toBe(2);
    expect(next.default).toEqual({ provider: 'openai', model: 'gpt-image-2' });
    expect(next.outputDir).toBe('.pi/art');
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('uses a tombstone to suppress the built-in env fallback', () => {
    isolated();
    process.env.OPENAI_API_KEY = 'env-secret';
    updateImageGenSettings(() => ({
      default: { provider: 'openai', model: 'gpt-image-2' },
      providers: {
        openai: { baseUrl: 'http://127.0.0.1:8188/v1', apiKey: '', headers: {} },
      },
    }));

    const resolved = resolveDefaultRoute(loadImageGenSettings());
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.provider.apiKey).toBeUndefined();
    expect(resolved.provider.headers).toBeUndefined();
    expect(resolved.provider.baseUrl).toBe('http://127.0.0.1:8188/v1');
  });

  it('rejects malformed provider settings without dereferencing them', () => {
    isolated();
    const original = writeLegacy({ version: 2, providers: { corp: null } });
    expect(loadImageGenSettings()).toEqual({});
    expect(() => readImageGenSettingsLayer()).toThrow(/invalid shape/i);
    expect(() => updateImageGenSettings(() => ({ default: { provider: 'x', model: 'y' } }))).toThrow(/invalid shape/i);
    expect(readFileSync(imageGenSettingsPath(), 'utf8')).toBe(original);
  });

  it('refuses to overwrite malformed settings', () => {
    isolated();
    writeSettingsFile('{ broken');
    expect(() => updateImageGenSettings(() => ({ default: { provider: 'x', model: 'y' } }))).toThrow(
      /refusing to overwrite/i,
    );
    expect(readFileSync(imageGenSettingsPath(), 'utf8')).toBe('{ broken');
  });

  it('refuses to rewrite a file written by a newer version', () => {
    isolated();
    writeLegacy({ version: 3, default: { provider: 'openai', model: 'gpt-image-2' } });
    expect(loadImageGenSettings()).toEqual({});
    expect(() => readImageGenSettingsLayer()).toThrow(/newer pi-image-gen/i);
    expect(JSON.parse(readFileSync(imageGenSettingsPath(), 'utf8')).version).toBe(3);
  });
});

describe('migration from the v1 layout', () => {
  it('rewrites a v1 file once, keeping the original as a backup', () => {
    isolated();
    process.env.OPENAI_API_KEY = 'env-secret';
    const original = writeLegacy({
      defaultModel: 'gpt-image-2',
      outputDir: '.pi/art',
      providers: { openai: { baseUrl: 'https://proxy.example.com/v1' } },
    });

    const settings = loadImageGenSettings();
    expect(settings).toEqual({
      version: 2,
      outputDir: '.pi/art',
      default: { provider: 'openai', model: 'gpt-image-2' },
      providers: { openai: { baseUrl: 'https://proxy.example.com/v1' } },
    });
    const path = imageGenSettingsPath();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(settings);
    expect(readFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'pi-image-gen', 'settings.json.v1.bak'), 'utf8')).toBe(original);

    // The second read is a plain v2 read; the backup still holds the v1 text.
    expect(loadImageGenSettings()).toEqual(settings);
    expect(readFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'pi-image-gen', 'settings.json.v1.bak'), 'utf8')).toBe(original);
  });

  it('merges both v1 containers into one, keeping custom protocols', () => {
    isolated();
    writeLegacy({
      defaultModel: 'hero',
      customProviders: {
        corp: {
          api: 'openai',
          baseUrl: 'https://images.corp.example/v1',
          apiKey: '$CORP_KEY',
          headers: { 'x-team': 'ai' },
          models: [{ id: 'image-v1', alias: 'hero' }, 'image-v0'],
        },
      },
      providers: { gemini: { baseUrl: 'https://gen.example/v1' } },
    });

    const settings = loadImageGenSettings();
    expect(settings.providers?.corp).toEqual({
      api: 'openai',
      baseUrl: 'https://images.corp.example/v1',
      apiKey: '$CORP_KEY',
      headers: { 'x-team': 'ai' },
      models: [{ id: 'image-v1', alias: 'hero' }, 'image-v0'],
    });
    expect(settings.providers?.gemini).toEqual({ baseUrl: 'https://gen.example/v1' });
    expect(settings.default).toEqual({ provider: 'corp', model: 'image-v1' });
    expect((settings as Record<string, unknown>).customProviders).toBeUndefined();
  });

  it.each([
    [
      'a custom alias',
      { defaultModel: 'hero', customProviders: { corp: { api: 'openai', baseUrl: 'https://c.test/v1', apiKey: 'k', models: [{ id: 'image-v1', alias: 'hero' }] } } },
      { provider: 'corp', model: 'image-v1' },
    ],
    [
      'a built-in alias',
      { defaultModel: 'nano-banana' },
      { provider: 'gemini', model: 'gemini-2.5-flash-image' },
    ],
    [
      'an explicit provider prefix holding slashes',
      { defaultModel: 'openrouter/google/gemini-3.1-flash-image' },
      { provider: 'openrouter', model: 'google/gemini-3.1-flash-image' },
    ],
    [
      'a catch-all provider that declared no models',
      { defaultModel: 'any-future-model', customProviders: { amaster: { api: 'openai', baseUrl: 'https://a.test/', apiKey: 'k' } } },
      { provider: 'amaster', model: 'any-future-model' },
    ],
  ])('recovers the route %s', (_label, legacy, expected) => {
    isolated();
    if (expected.provider === 'gemini') process.env.GEMINI_API_KEY = 'gem-test';
    writeLegacy(legacy);
    expect(loadImageGenSettings().default).toEqual(expected);
  });

  it('omits a default v1 could not route and keeps the providers', () => {
    isolated();
    writeLegacy({
      defaultModel: 'made-up-model',
      customProviders: { narrow: { api: 'openai', baseUrl: 'https://n.test/', apiKey: 'k', models: [{ id: 'x' }] } },
    });
    const settings = loadImageGenSettings();
    expect(settings.default).toBeUndefined();
    expect(Object.keys(settings.providers ?? {})).toEqual(['narrow']);
    const resolved = resolveDefaultRoute(settings);
    expect('error' in resolved && resolved.error).toMatch(/not set/i);
  });

  it('keeps a keyless built-in row usable after migration', () => {
    isolated();
    writeLegacy({ defaultModel: 'gpt-image-2', providers: { openai: { baseUrl: 'http://127.0.0.1:8188/v1' } } });
    const resolved = resolveDefaultRoute(loadImageGenSettings());
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.provider.apiKey).toBeUndefined();
    expect(resolved.provider.baseUrl).toBe('http://127.0.0.1:8188/v1');
  });

  it('leaves a v1 file we cannot represent in one container untouched', () => {
    isolated();
    const original = writeLegacy({
      defaultModel: 'openai/x',
      providers: { openai: { baseUrl: 'https://c.test/' } },
      customProviders: { openai: { api: 'openai', baseUrl: 'https://other.test/', apiKey: 'k' } },
    });
    expect(loadImageGenSettings()).toEqual({});
    expect(() => readImageGenSettingsLayer()).toThrow(/invalid shape/i);
    expect(readFileSync(imageGenSettingsPath(), 'utf8')).toBe(original);
    expect(existsSync(join(process.env.PI_CODING_AGENT_DIR!, 'pi-image-gen', 'settings.json.v1.bak'))).toBe(false);
  });

  it('migrates in memory even when the file cannot be rewritten', () => {
    isolated();
    // A directory in the backup slot makes persistence fail the same way on
    // every platform, unlike chmod, which Windows treats as advisory.
    mkdirSync(join(settingsDir(), 'settings.json.v1.bak'));
    writeLegacy({ defaultModel: 'gpt-image-2', providers: { openai: { apiKey: 'k' } } });
    expect(loadImageGenSettings().default).toEqual({ provider: 'openai', model: 'gpt-image-2' });
    expect(readFileSync(imageGenSettingsPath(), 'utf8')).toContain('defaultModel');
  });
});
