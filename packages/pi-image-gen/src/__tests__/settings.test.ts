import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveModel } from '../config.js';
import {
  exposeProjectTrustToCli,
  imageGenSettingsPath,
  isCliProjectTrusted,
  loadImageGenSettings,
  readImageGenSettingsLayer,
  updateImageGenSettings,
} from '../settings.js';

const originalHome = process.env.HOME;
const originalDir = process.env.PI_CODING_AGENT_DIR;
const originalTrusted = process.env.PI_IMAGE_GEN_TRUSTED_CWD;
const originalUserProfile = process.env.USERPROFILE;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalDir;
  if (originalTrusted === undefined) delete process.env.PI_IMAGE_GEN_TRUSTED_CWD;
  else process.env.PI_IMAGE_GEN_TRUSTED_CWD = originalTrusted;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

function isolated(): { root: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), 'pi-image-gen-settings-'));
  const cwd = join(root, 'project');
  process.env.USERPROFILE = join(root, 'home');
  process.env.HOME = join(root, 'home');
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  return { root, cwd };
}

describe('image generation settings', () => {
  it('ignores an untrusted project route and enables it only for the exact trusted cwd', () => {
    const { cwd } = isolated();
    updateImageGenSettings(cwd, 'global', () => ({
      defaultModel: 'gpt-image-2',
      providers: { openai: { baseUrl: 'https://global.example/v1', apiKey: '$GLOBAL_KEY' } },
    }));
    updateImageGenSettings(cwd, 'project', () => ({
      providers: { openai: { baseUrl: 'https://evil.example/v1', headers: { 'x-evil': '1' } } },
    }));

    expect(loadImageGenSettings(cwd, false).providers?.openai).toEqual({
      baseUrl: 'https://global.example/v1',
      apiKey: '$GLOBAL_KEY',
    });
    expect(loadImageGenSettings(cwd, true).providers?.openai).toEqual({
      baseUrl: 'https://evil.example/v1',
      apiKey: '$GLOBAL_KEY',
      headers: { 'x-evil': '1' },
    });

    exposeProjectTrustToCli(cwd, true);
    expect(isCliProjectTrusted(cwd)).toBe(true);
    expect(isCliProjectTrusted(join(cwd, 'other'))).toBe(false);
    exposeProjectTrustToCli(cwd, false);
    expect(isCliProjectTrusted(cwd)).toBe(false);
  });

  it('atomically preserves unrelated settings and writes mode 0600', () => {
    const { cwd } = isolated();
    const path = imageGenSettingsPath(cwd, 'global');
    updateImageGenSettings(cwd, 'global', () => ({ defaultModel: 'nano-banana' }));
    const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    document.theme = 'dark';
    writeFileSync(path, `${JSON.stringify(document)}\n`);
    chmodSync(path, 0o644);

    updateImageGenSettings(cwd, 'global', (current) => ({ ...current, outputDir: '.pi/art' }));
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
    expect(saved.theme).toBe('dark');
    expect(saved['pi-image-gen']).toEqual({ defaultModel: 'nano-banana', outputDir: '.pi/art' });
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('uses project tombstones to suppress inherited credentials, headers, and env fallback', () => {
    const { cwd } = isolated();
    process.env.OPENAI_API_KEY = 'env-secret';
    updateImageGenSettings(cwd, 'global', () => ({
      defaultModel: 'gpt-image-2',
      providers: {
        openai: { apiKey: 'global-secret', headers: { Authorization: 'Bearer global-secret' } },
      },
    }));
    updateImageGenSettings(cwd, 'project', () => ({
      providers: { openai: { baseUrl: 'http://127.0.0.1:8188/v1', apiKey: '', headers: {} } },
    }));

    const settings = loadImageGenSettings(cwd, true);
    const result = resolveModel('gpt-image-2', settings);
    if ('error' in result) throw new Error(result.error);
    expect(result.provider.apiKey).toBeUndefined();
    expect(result.provider.headers).toBeUndefined();
    expect(result.provider.baseUrl).toBe('http://127.0.0.1:8188/v1');
  });

  it('rejects malformed nested provider settings without dereferencing them', () => {
    const { cwd } = isolated();
    const path = imageGenSettingsPath(cwd, 'global');
    mkdirSync(dirname(path), { recursive: true });
    const original = JSON.stringify({ 'pi-image-gen': { customProviders: { corp: null } } });
    writeFileSync(path, original);
    expect(loadImageGenSettings(cwd, false)).toEqual({});
    expect(() => readImageGenSettingsLayer(cwd, 'global')).toThrow(/invalid nested shape/i);
    expect(() => updateImageGenSettings(cwd, 'global', () => ({ defaultModel: 'x' }))).toThrow(/invalid nested shape/i);
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  it('refuses to overwrite malformed settings', () => {
    const { cwd } = isolated();
    const path = imageGenSettingsPath(cwd, 'global');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ broken');
    expect(() => updateImageGenSettings(cwd, 'global', () => ({ defaultModel: 'x' }))).toThrow(
      /refusing to overwrite/i,
    );
    expect(readFileSync(path, 'utf8')).toBe('{ broken');
  });
});
