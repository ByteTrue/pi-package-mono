import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateImage } from '../generate.js';
import type { ImageGenSettings } from '../types.js';

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000115c46f250000000049454e44ae426082',
  'hex',
);

function fakeJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('generateImage', () => {
  it('saves an image returned as base64 to outputDir and returns its path', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-image-gen-'));
    process.env.OPENAI_API_KEY = 'sk-test';

    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = (async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return fakeJsonResponse({
        data: [{ b64_json: PNG_BYTES.toString('base64'), revised_prompt: 'a cat, but cuter' }],
      });
    }) as typeof fetch;

    const result = await generateImage(
      { prompt: 'a cat', filename: 'cat-test' },
      {
        cwd,
        settings: { default: { provider: 'openai', model: 'gpt-image-2' } },
        fetchImpl,
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/images/generations');
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.path).toMatch(/cat-test\.png$/);
    expect(result.images[0]?.revisedPrompt).toBe('a cat, but cuter');
    expect(readFileSync(result.images[0]!.path)).toEqual(PNG_BYTES);
  });

  it('downloads url-style results and writes them to disk', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-image-gen-'));
    const settings: ImageGenSettings = {
      default: { provider: 'myprov', model: 'x-img' },
      providers: {
        myprov: {
          api: 'openai',
          apiKey: 'k',
          models: ['x-img'],
        },
      },
    };
    const fetchImpl: typeof fetch = (async (input) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.endsWith('/images/generations')) {
        return fakeJsonResponse({ data: [{ url: 'https://cdn.test/img.png' }] });
      }
      return new Response(PNG_BYTES, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }) as typeof fetch;

    const result = await generateImage({ prompt: 'house' }, { cwd, settings, fetchImpl });
    expect(result.provider).toBe('myprov (custom)');
    expect(result.images).toHaveLength(1);
    expect(readFileSync(result.images[0]!.path)).toEqual(PNG_BYTES);
  });

  it('never overwrites an existing image; the retry lands on a -2 name (BYTE-5 #3)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-image-gen-'));
    process.env.OPENAI_API_KEY = 'sk-test';
    const settings = { default: { provider: 'openai', model: 'gpt-image-2' } };
    const fetchImpl: typeof fetch = (async () =>
      fakeJsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] })) as typeof fetch;
    const first = await generateImage({ prompt: 'a cat', filename: 'dup-test' }, { cwd, settings, fetchImpl });
    const second = await generateImage({ prompt: 'a cat again', filename: 'dup-test' }, { cwd, settings, fetchImpl });

    expect(first.images[0]?.path).toMatch(/dup-test\.png$/);
    expect(second.images[0]?.path).toMatch(/dup-test-2\.png$/);
    expect(second.images[0]?.path).not.toBe(first.images[0]?.path);
    // The first generation is still intact byte-for-byte — no silent overwrite.
    expect(readFileSync(first.images[0]!.path)).toEqual(PNG_BYTES);
    expect(readFileSync(second.images[0]!.path)).toEqual(PNG_BYTES);

    // Two images in one response already carry -N suffixes; the exclusive
    // write must still compose with them instead of colliding.
    const two = await generateImage(
      { prompt: 'a cat', filename: 'pair-test' },
      {
        cwd,
        settings,
        fetchImpl: (async () =>
          fakeJsonResponse({
            data: [
              { b64_json: PNG_BYTES.toString('base64') },
              { b64_json: PNG_BYTES.toString('base64') },
            ],
          })) as typeof fetch,
      },
    );
    expect(two.images.map((i) => i.path)).toEqual([
      expect.stringMatching(/pair-test-1\.png$/),
      expect.stringMatching(/pair-test-2\.png$/),
    ]);

    // A single-image generation into the same directory takes the free base
    // name — the exclusive write only ever skips names that really exist.
    const twoAgain = await generateImage(
      { prompt: 'a cat', filename: 'pair-test' },
      {
        cwd,
        settings,
        fetchImpl: (async () =>
          fakeJsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] })) as typeof fetch,
      },
    );
    expect(twoAgain.images[0]?.path).toMatch(/pair-test\.png$/);
  });

  it('raises if the default route is not configured', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-image-gen-'));
    await expect(generateImage({ prompt: 'hi' }, { cwd, settings: {} })).rejects.toThrow(
      /default .* is not set/i,
    );
  });

  it('raises with a helpful error if the default points at an unknown provider', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-image-gen-'));
    delete process.env.GEMINI_API_KEY;
    await expect(
      generateImage(
        { prompt: 'x' },
        { cwd, settings: { default: { provider: 'no-such-provider', model: 'gemini-2.5-flash-image' } }, fetchImpl: fetch },
      ),
    ).rejects.toThrow(/unknown provider/i);
  });

  it('aborts an in-flight provider request when signal fires', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-image-gen-'));
    process.env.OPENAI_API_KEY = 'sk-test';

    const fetchImpl: typeof fetch = ((_input, init) =>
      new Promise((_resolve, reject) => {
        const sig = (init as RequestInit | undefined)?.signal;
        if (!sig) {
          reject(new Error('signal was not propagated to fetch'));
          return;
        }
        sig.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as typeof fetch;

    const ctrl = new AbortController();
    const promise = generateImage(
      { prompt: 'x' },
      {
        cwd,
        settings: { default: { provider: 'openai', model: 'gpt-image-2' } },
        fetchImpl,
        signal: ctrl.signal,
      },
    );
    setTimeout(() => ctrl.abort(), 10);
    await expect(promise).rejects.toThrow(/cancelled|abort/i);
  });

  it('routes to OpenAI /images/edits when an image input is supplied', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-image-gen-'));
    process.env.OPENAI_API_KEY = 'sk-test';

    const calls: Array<{ url: string; method: string; isFormData: boolean }> = [];
    const fetchImpl: typeof fetch = (async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push({
        url,
        method: (init as RequestInit | undefined)?.method ?? 'GET',
        isFormData: (init as RequestInit | undefined)?.body instanceof FormData,
      });
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString('base64') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const refPath = join(cwd, 'ref.png');
    writeFileSync(refPath, PNG_BYTES);
    const result = await generateImage(
      { prompt: 'make it green', image: [refPath], filename: 'edit-test' },
      {
        cwd,
        settings: { default: { provider: 'openai', model: 'gpt-image-2' } },
        fetchImpl,
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/images/edits');
    expect(calls[0]?.isFormData).toBe(true);
    expect(result.images).toHaveLength(1);
  });

  it('accepts a data: URI returned in the `url` field of an OpenAI response', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-image-gen-'));
    process.env.OPENAI_API_KEY = 'sk-test';

    const dataUri = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
    const fetchImpl: typeof fetch = (async () =>
      new Response(JSON.stringify({ data: [{ url: dataUri }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    const result = await generateImage(
      { prompt: 'cat' },
      { cwd, settings: { default: { provider: 'openai', model: 'gpt-image-2' } }, fetchImpl },
    );
    expect(result.images).toHaveLength(1);
    expect(readFileSync(result.images[0]!.path)).toEqual(PNG_BYTES);
  });

  it('skips entries that have neither b64_json nor a usable url', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-image-gen-'));
    process.env.OPENAI_API_KEY = 'sk-test';

    const fetchImpl: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            { url: '' },
            { b64_json: PNG_BYTES.toString('base64') },
            { url: 'https://cdn.test/real.png' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    // We don't follow real.png in this test — provide a fake fetch that returns a body for it.
    const wrappedFetch: typeof fetch = (async (input, init) => {
      const u = typeof input === 'string' ? input : (input as URL).toString();
      if (u === 'https://cdn.test/real.png') {
        return new Response(PNG_BYTES, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return fetchImpl(input, init);
    }) as typeof fetch;

    const result = await generateImage(
      { prompt: 'x' },
      { cwd, settings: { default: { provider: 'openai', model: 'gpt-image-2' } }, fetchImpl: wrappedFetch },
    );
    expect(result.images).toHaveLength(2);
  });

  it('routes OpenRouter to POST /api/v1/images (not /images/generations)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-image-gen-'));
    const settings: ImageGenSettings = {
      default: { provider: 'or', model: 'google/gemini-3.1-flash-image' },
      providers: {
        or: {
          api: 'openrouter',
          apiKey: 'or-test',
          models: ['google/gemini-3.1-flash-image'],
        },
      },
    };
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = (async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return fakeJsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] });
    }) as typeof fetch;

    const result = await generateImage({ prompt: 'a cat' }, { cwd, settings, fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/images');
    expect(calls[0]?.body.model).toBe('google/gemini-3.1-flash-image');
    expect(result.images).toHaveLength(1);
  });

  it('OpenRouter image-to-image sends input_references in JSON body', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'pi-image-gen-'));
    const settings: ImageGenSettings = {
      default: { provider: 'or', model: 'google/gemini-3.1-flash-image' },
      providers: {
        or: {
          api: 'openrouter',
          apiKey: 'or-test',
          models: ['google/gemini-3.1-flash-image'],
        },
      },
    };
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = (async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return fakeJsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] });
    }) as typeof fetch;

    const refPath = join(cwd, 'ref.png');
    writeFileSync(refPath, PNG_BYTES);
    await generateImage({ prompt: 'make blue', image: [refPath] }, { cwd, settings, fetchImpl });

    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/images');
    const refs = calls[0]?.body.input_references as Array<{
      image_url: { url: string };
    }>;
    expect(refs).toHaveLength(1);
    expect(refs[0]?.image_url.url.startsWith('data:image/png;base64,')).toBe(true);
  });
});
