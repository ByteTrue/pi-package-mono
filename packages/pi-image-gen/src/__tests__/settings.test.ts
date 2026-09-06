import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveModel } from '../config.js';
import {
  imageGenSettingsPath,
  loadImageGenSettings,
  readImageGenSettingsLayer,
  updateImageGenSettings,
} from '../settings.js';

const originalHome = process.env.HOME;
const originalDir = process.env.PI_CODING_AGENT_DIR;
const originalUserProfile = process.env.USERPROFILE;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalDir;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

function isolated(): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-image-gen-settings-'));
  process.env.USERPROFILE = join(root, 'home');
  process.env.HOME = join(root, 'home');
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  return root;
}

describe('image generation settings', () => {
  it('stores config in a dedicated file outside Pi settings.json', () => {
    isolated();
    updateImageGenSettings(() => ({ defaultModel: 'gpt-image-2' }));
    const path = imageGenSettingsPath();
    expect(path).toBe(join(process.env.PI_CODING_AGENT_DIR!, 'pi-image-gen', 'settings.json'));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ defaultModel: 'gpt-image-2' });
    expect(
      () => readFileSync(join(process.env.PI_CODING_AGENT_DIR!, 'settings.json'), 'utf8'),
    ).toThrow();
  });

  it('preserves unrelated top-level keys and writes mode 0600', () => {
    isolated();
    const path = imageGenSettingsPath();
    updateImageGenSettings(() => ({ defaultModel: 'nano-banana' }));
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    saved.theme = 'dark';
    writeFileSync(path, `${JSON.stringify(saved)}\n`);
    chmodSync(path, 0o644);

    updateImageGenSettings((current) => ({ ...current, outputDir: '.pi/art' }));
    const next = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
    expect(next.theme).toBe('dark');
    expect(next.defaultModel).toBe('nano-banana');
    expect(next.outputDir).toBe('.pi/art');
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('uses a top-level tombstone to suppress the built-in env fallback', () => {
    isolated();
    process.env.OPENAI_API_KEY = 'env-secret';
    updateImageGenSettings(() => ({
      defaultModel: 'gpt-image-2',
      providers: {
        openai: { baseUrl: 'http://127.0.0.1:8188/v1', apiKey: '', headers: {} },
      },
    }));

    const settings = loadImageGenSettings();
    const result = resolveModel('gpt-image-2', settings);
    if ('error' in result) throw new Error(result.error);
    expect(result.provider.apiKey).toBeUndefined();
    expect(result.provider.headers).toBeUndefined();
    expect(result.provider.baseUrl).toBe('http://127.0.0.1:8188/v1');
  });

  it('rejects malformed provider settings without dereferencing them', () => {
    isolated();
    mkdirSync(join(process.env.PI_CODING_AGENT_DIR!, 'pi-image-gen'), { recursive: true });
    const path = imageGenSettingsPath();
    const original = JSON.stringify({ customProviders: { corp: null } });
    writeFileSync(path, original);
    expect(loadImageGenSettings()).toEqual({});
    expect(() => readImageGenSettingsLayer()).toThrow(/invalid shape/i);
    expect(() => updateImageGenSettings(() => ({ defaultModel: 'x' }))).toThrow(/invalid shape/i);
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  it('refuses to overwrite malformed settings', () => {
    isolated();
    mkdirSync(join(process.env.PI_CODING_AGENT_DIR!, 'pi-image-gen'), { recursive: true });
    const path = imageGenSettingsPath();
    writeFileSync(path, '{ broken');
    expect(() => updateImageGenSettings(() => ({ defaultModel: 'x' }))).toThrow(
      /refusing to overwrite/i,
    );
    expect(readFileSync(path, 'utf8')).toBe('{ broken');
  });
});
