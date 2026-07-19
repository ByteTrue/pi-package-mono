import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyImageOutput, resolveImageInputs, toDataUri } from '../image-input.js';

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000115c46f250000000049454e44ae426082',
  'hex',
);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);

describe('resolveImageInputs', () => {
  it('returns empty when no image given', async () => {
    expect(await resolveImageInputs(undefined, '/tmp', fetch)).toEqual([]);
    expect(await resolveImageInputs([], '/tmp', fetch)).toEqual([]);
  });

  it('reads a local PNG file by absolute path and detects mime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-image-input-'));
    const file = join(dir, 'a.png');
    writeFileSync(file, PNG_BYTES);
    const out = await resolveImageInputs([file], dir, fetch);
    expect(out).toHaveLength(1);
    expect(out[0]?.mimeType).toBe('image/png');
    expect(Buffer.from(out[0]!.bytes).equals(PNG_BYTES)).toBe(true);
  });

  it('resolves relative paths against cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-image-input-'));
    writeFileSync(join(dir, 'b.jpg'), JPEG_BYTES);
    const out = await resolveImageInputs(['./b.jpg'], dir, fetch);
    expect(out[0]?.mimeType).toBe('image/jpeg');
  });

  it('rejects a data: URI with a clear error', async () => {
    const dataUri = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
    await expect(resolveImageInputs([dataUri], '/tmp', fetch)).rejects.toThrow(
      /`data:` URI is not supported/i,
    );
  });

  it('downloads an http(s) URL with the given fetch impl and respects abort signal', async () => {
    let receivedSignal: AbortSignal | null | undefined;
    const fetchImpl: typeof fetch = (async (_url, init) => {
      receivedSignal = (init as RequestInit | undefined)?.signal;
      return new Response(PNG_BYTES, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }) as typeof fetch;
    const ctrl = new AbortController();
    const out = await resolveImageInputs(
      ['https://example.com/img.png'],
      '/tmp',
      fetchImpl,
      ctrl.signal,
    );
    expect(out[0]?.mimeType).toBe('image/png');
    expect(receivedSignal).toBe(ctrl.signal);
  });

  it('rejects a long raw base64 blob with a clear error', async () => {
    // 600+ bytes of arbitrary content → 800+ chars base64, no internal padding.
    const blob = Buffer.alloc(600, 0xab).toString('base64');
    await expect(resolveImageInputs([blob], '/tmp', fetch)).rejects.toThrow(/raw base64 blob/i);
  });

  it('treats short non-path strings as paths and reports the failed read', async () => {
    await expect(resolveImageInputs(['nope.png'], '/tmp', fetch)).rejects.toThrow(
      /not a readable file path/,
    );
  });

  it('accepts arrays of file paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-image-input-'));
    const a = join(dir, 'a.png');
    const b = join(dir, 'b.jpg');
    writeFileSync(a, PNG_BYTES);
    writeFileSync(b, JPEG_BYTES);
    const out = await resolveImageInputs([a, b], dir, fetch);
    expect(out).toHaveLength(2);
    expect(out[0]?.mimeType).toBe('image/png');
    expect(out[1]?.mimeType).toBe('image/jpeg');
  });
});

describe('toDataUri', () => {
  it('round-trips bytes + mimeType', () => {
    const uri = toDataUri({ bytes: PNG_BYTES, mimeType: 'image/png' });
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    expect(uri.endsWith(PNG_BYTES.toString('base64'))).toBe(true);
  });
});

describe('classifyImageOutput', () => {
  it('returns null for empty / undefined / whitespace', () => {
    expect(classifyImageOutput(undefined)).toBeNull();
    expect(classifyImageOutput(null)).toBeNull();
    expect(classifyImageOutput('')).toBeNull();
    expect(classifyImageOutput('   ')).toBeNull();
  });

  it('classifies http(s) URLs as kind:url', () => {
    expect(classifyImageOutput('https://cdn.test/img.png')).toEqual({
      kind: 'url',
      url: 'https://cdn.test/img.png',
    });
    expect(classifyImageOutput('http://localhost:8080/foo.jpg')).toEqual({
      kind: 'url',
      url: 'http://localhost:8080/foo.jpg',
    });
  });

  it('decodes data: URIs into kind:base64 with detected mimeType', () => {
    const dataUri = `data:image/jpeg;base64,${JPEG_BYTES.toString('base64')}`;
    const result = classifyImageOutput(dataUri);
    expect(result).toEqual({
      kind: 'base64',
      bytes: JPEG_BYTES.toString('base64'),
      mimeType: 'image/jpeg',
    });
  });

  it('detects bare base64 image bytes by sniffing magic', () => {
    const result = classifyImageOutput(PNG_BYTES.toString('base64'));
    expect(result).toEqual({
      kind: 'base64',
      bytes: PNG_BYTES.toString('base64'),
      mimeType: 'image/png',
    });
  });

  it('returns null for short or non-image base64', () => {
    expect(classifyImageOutput('aGVsbG8=')).toBeNull(); // "hello"
    expect(classifyImageOutput('not-base64-stuff!!')).toBeNull();
  });
});
