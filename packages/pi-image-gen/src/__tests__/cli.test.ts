import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCliRequest, runImageGenCli, safeCliError } from '../cli.js';
import { imageGenSettingsPath, updateImageGenSettings } from '../settings.js';
import type { ImageGenResult } from '../types.js';

const originalHome = process.env.HOME;
const originalDir = process.env.PI_CODING_AGENT_DIR;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalTestImageKey = process.env.TEST_IMAGE_KEY;
afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalDir;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  if (originalTestImageKey === undefined) delete process.env.TEST_IMAGE_KEY;
  else process.env.TEST_IMAGE_KEY = originalTestImageKey;
});

function isolated(): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-image-gen-cli-'));
  process.env.HOME = join(root, 'home');
  process.env.PI_CODING_AGENT_DIR = join(root, 'agent');
  return join(root, 'project');
}

describe('pi-image-gen CLI', () => {
  it('validates the stdin JSON contract', () => {
    expect(parseCliRequest('{"prompt":"cat","image":["a.png"],"n":2}')).toEqual({
      prompt: 'cat',
      image: ['a.png'],
      n: 2,
    });
    expect(() => parseCliRequest('{"prompt":""}')).toThrow(/non-empty/);
    expect(() => parseCliRequest('{"prompt":"cat","model":"x"}')).toThrow(/Unknown request field/);
    expect(() => parseCliRequest('{"prompt":"cat","n":9}')).toThrow(/1 to 8/);
  });

  it('loads settings, invokes the shared generate core, and emits markdown', async () => {
    const cwd = isolated();
    updateImageGenSettings(cwd, 'global', () => ({
      defaultModel: 'gpt-image-2',
      providers: { openai: { apiKey: 'secret-value' } },
    }));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const generate = vi.fn(async (): Promise<ImageGenResult> => ({
      model: 'gpt-image-2',
      provider: 'OpenAI',
      images: [{ path: '/tmp/cat.png', mimeType: 'image/png' }],
    }));

    const code = await runImageGenCli({
      args: ['generate'],
      cwd,
      input: '{"prompt":"cat","filename":"cat"}',
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      generate,
    });

    expect(code).toBe(0);
    expect(generate).toHaveBeenCalledWith(
      { prompt: 'cat', filename: 'cat' },
      expect.objectContaining({ cwd, settings: expect.objectContaining({ defaultModel: 'gpt-image-2' }) }),
    );
    expect(stdout.join('\n')).toContain('![cat](/tmp/cat.png)');
    expect(stdout.join('\n')).not.toContain('secret-value');
    expect(stderr).toEqual([]);
  });

  it('redacts literals, built-in env keys, fallbacks, interpolated headers, and successful output', async () => {
    process.env.OPENAI_API_KEY = 'default-secret';
    process.env.TEST_IMAGE_KEY = 'resolved-secret';
    const settings = {
      providers: {
        openai: {
          apiKey: '${MISSING_IMAGE_KEY:-fallback-secret}',
          headers: {
            authorization: 'Bearer-$TEST_IMAGE_KEY',
            'proxy-authorization': 'Bearer literal-header-secret',
          },
        },
      },
    };
    const message = safeCliError(
      new Error('default-secret fallback-secret Bearer-resolved-secret literal-header-secret'),
      settings,
    );
    expect(message).not.toMatch(/default-secret|fallback-secret|resolved-secret|literal-header-secret/);

    const cwd = isolated();
    updateImageGenSettings(cwd, 'global', () => settings);
    const stdout: string[] = [];
    const code = await runImageGenCli({
      args: ['generate'],
      cwd,
      input: '{"prompt":"cat"}',
      stdout: (text) => stdout.push(text),
      generate: async () => ({
        model: 'gpt-image-2',
        provider: 'OpenAI',
        images: [{
          path: '/tmp/cat.png',
          mimeType: 'image/png',
          revisedPrompt: 'default-secret fallback-secret resolved-secret literal-header-secret',
        }],
      }),
    });
    expect(code).toBe(0);
    expect(stdout.join('\n')).not.toMatch(/default-secret|fallback-secret|resolved-secret|literal-header-secret/);
    expect(stdout.join('\n')).toContain('[redacted]');
  });
  it('returns a normal nonzero result for malformed nested settings', async () => {
    const cwd = isolated();
    const path = imageGenSettingsPath(cwd, 'global');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ 'pi-image-gen': { customProviders: { corp: null } } }));
    const stderr: string[] = [];
    await expect(
      runImageGenCli({
        args: ['generate'],
        cwd,
        input: '{"prompt":"cat"}',
        stderr: (text) => stderr.push(text),
      }),
    ).resolves.toBe(1);
    expect(stderr.join('\n')).toMatch(/defaultModel is not set/i);
    expect(stderr.join('\n')).not.toContain('TypeError');
  });
});
