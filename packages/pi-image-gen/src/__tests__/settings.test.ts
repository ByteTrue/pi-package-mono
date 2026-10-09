import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveDefaultRoute } from '../config.js';
import {
  describeImageGenSettingsPath,
  imageGenSettingsPath,
  loadImageGenSettings,
  readImageGenSettingsLayer,
  settingsLocation,
  updateImageGenSettings,
} from '../settings.js';

const ENV_KEYS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'DASHSCOPE_API_KEY', 'ARK_API_KEY', 'OPENROUTER_API_KEY'];

const originalHome = process.env.HOME;
const originalDir = process.env.PI_CODING_AGENT_DIR;
const originalPkgDir = process.env.PI_PKG_CFG_DIR;
const originalUserProfile = process.env.USERPROFILE;
const originalEnvKeys = new Map(ENV_KEYS.map((name) => [name, process.env[name]]));

afterEach(() => {
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalDir;
  if (originalPkgDir === undefined) delete process.env.PI_PKG_CFG_DIR;
  else process.env.PI_PKG_CFG_DIR = originalPkgDir;
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
  delete process.env.PI_PKG_CFG_DIR;
  for (const name of ENV_KEYS) delete process.env[name];
  return root;
}

/** Where 0.5.x wrote the file; the layout a v1/v2 upgrade starts from. */
function oldSettingsDir(): string {
  const dir = join(process.env.PI_CODING_AGENT_DIR!, 'pi-image-gen');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeLegacy(document: unknown): string {
  const text = `${JSON.stringify(document, null, 2)}\n`;
  writeFileSync(join(oldSettingsDir(), 'settings.json'), text);
  return text;
}

function writeCurrent(text: string): string {
  const path = currentSettingsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return text;
}

function currentSettingsPath(): string {
  return join(process.env.PI_CODING_AGENT_DIR!, 'pi-pkg-cfg', 'pi-image-gen', 'settings.json');
}

describe('image generation settings', () => {
  it('stores config in a dedicated versioned file outside Pi settings.json', () => {
    isolated();
    updateImageGenSettings(() => ({ default: { provider: 'openai', model: 'gpt-image-2' } }));
    const path = imageGenSettingsPath();
    expect(path).toBe(
      join(process.env.PI_CODING_AGENT_DIR!, 'pi-pkg-cfg', 'pi-image-gen', 'settings.json'),
    );
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

  it('moves a v2 file into the pkg-config root and leaves the original in place', () => {
    isolated();
    const original = writeLegacy({ version: 2, default: { provider: 'openai', model: 'gpt-image-2' } });

    expect(settingsLocation()).toEqual({ path: currentSettingsPath(), legacy: false });
    expect(readFileSync(currentSettingsPath(), 'utf8')).toBe(original);
    expect(readFileSync(join(oldSettingsDir(), 'settings.json'), 'utf8')).toBe(original);
  });

  it('ignores the older file once the new one exists', () => {
    isolated();
    writeLegacy({ version: 2, default: { provider: 'openai', model: 'old' } });
    writeCurrent(`${JSON.stringify({ version: 2, default: { provider: 'openai', model: 'new' } })}\n`);

    expect(loadImageGenSettings().default).toEqual({ provider: 'openai', model: 'new' });
  });

  it('falls back to the older location when it cannot be copied forward', () => {
    isolated();
    const original = writeLegacy({ version: 2, default: { provider: 'openai', model: 'gpt-image-2' } });
    mkdirSync(currentSettingsPath(), { recursive: true });

    expect(settingsLocation()).toEqual({ path: join(oldSettingsDir(), 'settings.json'), legacy: true });
    expect(describeImageGenSettingsPath()).toMatch(/\(legacy \(read-only fallback\)\)$/);
    expect(loadImageGenSettings().default).toEqual({ provider: 'openai', model: 'gpt-image-2' });
    expect(readFileSync(join(oldSettingsDir(), 'settings.json'), 'utf8')).toBe(original);
  });

  it('honors PI_PKG_CFG_DIR for the new root and PI_AGENT_HOME only for the older file', () => {
    const root = isolated();
    delete process.env.PI_CODING_AGENT_DIR;
    process.env.PI_PKG_CFG_DIR = join(root, 'shared');
    process.env.PI_AGENT_HOME = join(root, 'home-agent');
    const legacyPath = join(root, 'home-agent', 'pi-image-gen', 'settings.json');
    mkdirSync(dirname(legacyPath), { recursive: true });
    writeFileSync(legacyPath, `${JSON.stringify({ version: 2, default: { provider: 'openai', model: 'old' } })}\n`);

    expect(imageGenSettingsPath()).toBe(join(root, 'shared', 'pi-image-gen', 'settings.json'));
    expect(loadImageGenSettings().default).toEqual({ provider: 'openai', model: 'old' });
    expect(readFileSync(join(root, 'shared', 'pi-image-gen', 'settings.json'), 'utf8')).toContain('"old"');
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
    writeCurrent('{ broken');
    expect(() => updateImageGenSettings(() => ({ default: { provider: 'x', model: 'y' } }))).toThrow(
      /refusing to overwrite/i,
    );
    expect(readFileSync(imageGenSettingsPath(), 'utf8')).toBe('{ broken');
  });

  it('reports a broken older file in place instead of copying it forward', () => {
    isolated();
    writeLegacy({ version: 2, providers: { corp: null } });
    writeFileSync(join(oldSettingsDir(), 'settings.json'), '{ broken');
    expect(() => readImageGenSettingsLayer()).toThrow(/not valid settings JSON/i);
    expect(readFileSync(join(oldSettingsDir(), 'settings.json'), 'utf8')).toBe('{ broken');
    expect(existsSync(currentSettingsPath())).toBe(false);
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
    const backup = join(process.env.PI_CODING_AGENT_DIR!, 'pi-pkg-cfg', 'pi-image-gen', 'settings.json.v1.bak');
    expect(readFileSync(backup, 'utf8')).toBe(original);
    // The older location is left alone, so downgrading still finds its file.
    expect(readFileSync(join(oldSettingsDir(), 'settings.json'), 'utf8')).toBe(original);

    // The second read is a plain v2 read; the backup still holds the v1 text.
    expect(loadImageGenSettings()).toEqual(settings);
    expect(readFileSync(backup, 'utf8')).toBe(original);
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
    expect(existsSync(join(process.env.PI_CODING_AGENT_DIR!, 'pi-pkg-cfg', 'pi-image-gen', 'settings.json.v1.bak'))).toBe(false);
  });

  it('migrates in memory even when the file cannot be rewritten', () => {
    isolated();
    // A directory in the backup slot makes persistence fail the same way on
    // every platform, unlike chmod, which Windows treats as advisory.
    mkdirSync(join(process.env.PI_CODING_AGENT_DIR!, 'pi-pkg-cfg', 'pi-image-gen', 'settings.json.v1.bak'), {
      recursive: true,
    });
    writeLegacy({ defaultModel: 'gpt-image-2', providers: { openai: { apiKey: 'k' } } });
    expect(loadImageGenSettings().default).toEqual({ provider: 'openai', model: 'gpt-image-2' });
    expect(readFileSync(imageGenSettingsPath(), 'utf8')).toContain('defaultModel');
  });

  it('does not migrate a versionless v2-shaped file as v1 (BYTE-5 #2)', () => {
    isolated();
    // A v2 layout whose version field was lost (hand-written or stripped by
    // another tool). Pre-fix this was read as v1, migration kept only the
    // built-in row, and the shrunk file overwrote the original — losing the
    // custom provider, the default route, and outputDir with it.
    const original = writeCurrent(
      JSON.stringify(
        {
          outputDir: '.pi/art',
          default: { provider: 'corp', model: 'image-v1' },
          providers: {
            corp: { api: 'openai', baseUrl: 'https://images.corp.example/v1', apiKey: 'k', models: ['image-v1'] },
          },
        },
        null,
        2,
      ) + '\n',
    );

    // Runtime read: fail-soft keeps the file exactly as it is — no migration,
    // no rewrite, no data loss. Migration would return nothing usable anyway
    // (no v1 markers), but the must-not-do is overwriting the user's file.
    expect(loadImageGenSettings()).toEqual({});
    expect(readFileSync(imageGenSettingsPath(), 'utf8')).toBe(original);
    expect(existsSync(join(dirname(imageGenSettingsPath()), 'settings.json.v1.bak'))).toBe(false);

    // Strict read (interactive write flow) refuses rather than guessing.
    expect(() => readImageGenSettingsLayer()).toThrow(/refusing to rewrite/i);
    expect(readFileSync(imageGenSettingsPath(), 'utf8')).toBe(original);

    // A versionless file that DOES carry v1 markers still migrates: markers
    // cannot exist in a v2 document, so this is the safe hand-written-v1 case.
    isolated();
    process.env.OPENAI_API_KEY = 'env-secret';
    writeCurrent(JSON.stringify({ defaultModel: 'gpt-image-2' }) + '\n');
    expect(loadImageGenSettings().default).toEqual({ provider: 'openai', model: 'gpt-image-2' });
    expect(JSON.parse(readFileSync(imageGenSettingsPath(), 'utf8')).version).toBe(2);
  });
});
