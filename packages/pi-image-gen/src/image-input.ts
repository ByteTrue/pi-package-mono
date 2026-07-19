import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { ResolvedImageInput } from './types.js';

const MAGIC_BYTES: Array<{ mimeType: string; bytes: number[] }> = [
  { mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  // WebP: "RIFF....WEBP" — bytes 0..3 = RIFF, bytes 8..11 = WEBP
  { mimeType: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
];

const DATA_URI_RE = /^data:(image\/[a-z+.-]+);base64,(.+)$/i;

export async function resolveImageInputs(
  raw: string[] | undefined,
  cwd: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<ResolvedImageInput[]> {
  if (!raw || raw.length === 0) return [];
  const out: ResolvedImageInput[] = [];
  for (const entry of raw) {
    out.push(await resolveOne(entry, cwd, fetchImpl, signal));
  }
  return out;
}

async function resolveOne(
  value: string,
  cwd: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<ResolvedImageInput> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('image input is empty.');

  // Reject base64 / data: URIs — tool-call payloads don't survive megabyte-sized
  // string arguments cleanly across providers. Force callers to point us at a
  // path or URL instead, which is also what /image_generate's tool description
  // tells the model.
  if (/^data:/i.test(trimmed)) {
    throw new Error(
      'Image input as a `data:` URI is not supported. Pass a file path (absolute or relative to cwd) or an http(s) URL instead. If you have raw image bytes, write them to a file under .pi/uploads first and pass that path.',
    );
  }
  // Heuristic for raw base64: long, only base64 chars. Not foolproof but
  // catches the common case where the model dumps a giant base64 blob.
  if (trimmed.length > 256 && !/[\s/\\]/.test(trimmed) && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new Error(
      'Image input looks like a raw base64 blob; this is not supported because it bloats the tool argument. Write the bytes to a file path and pass that path instead.',
    );
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const res = await fetchImpl(trimmed, { signal: signal ?? null });
    if (!res.ok) {
      throw new Error(
        `Failed to download image input from ${trimmed} (HTTP ${res.status}). Tell the user to verify the URL is reachable.`,
      );
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const mimeType =
      res.headers.get('content-type')?.split(';')[0]?.trim() || sniffMime(buf) || 'image/png';
    return { bytes: buf, mimeType };
  }

  // Anything else — treat as a file path (absolute or relative to cwd).
  const absolute = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    throw new Error(
      `Image input "${trimmed}" is not a readable file path or http(s) URL (tried ${absolute}): ${(error as Error).message}. Pass an absolute path, a path relative to the session cwd, or an http(s) URL.`,
    );
  }
  const mimeType = sniffMime(bytes) ?? extToMime(absolute) ?? 'image/png';
  return { bytes, mimeType };
}

export function sniffMime(bytes: Uint8Array): string | undefined {
  for (const { mimeType, bytes: magic } of MAGIC_BYTES) {
    if (bytes.length < magic.length) continue;
    let match = true;
    for (let i = 0; i < magic.length; i++) {
      if (bytes[i] !== magic[i]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    if (mimeType === 'image/webp') {
      // RIFF prefix matched — verify WEBP at offset 8.
      if (
        bytes.length >= 12 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      ) {
        return 'image/webp';
      }
      continue;
    }
    return mimeType;
  }
  return undefined;
}

function extToMime(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return undefined;
  }
}

export function toDataUri(input: ResolvedImageInput): string {
  const b64 = Buffer.from(input.bytes).toString('base64');
  return `data:${input.mimeType};base64,${b64}`;
}

/**
 * Classify a string returned by an image-generation API as either a URL the
 * caller should fetch, or base64 image bytes the caller already has.
 *
 * Different providers / gateways return image output in different shapes:
 *   - http(s):// URL       → fetch it
 *   - `data:image/...;base64,...`  → strip prefix, decode bytes
 *   - bare base64 string (PNG/JPEG/WebP/GIF magic bytes) → decode bytes
 *   - empty / whitespace   → invalid, return null
 *
 * Returning `null` lets adapters skip junk entries (e.g. when a provider's
 * response had `text` parts but no actual image).
 */
export function classifyImageOutput(
  value: string | undefined | null,
): { kind: 'url'; url: string } | { kind: 'base64'; bytes: string; mimeType: string } | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: 'url', url: trimmed };
  }

  const dataMatch = DATA_URI_RE.exec(trimmed);
  if (dataMatch) {
    return {
      kind: 'base64',
      bytes: dataMatch[2]!,
      mimeType: dataMatch[1]!.toLowerCase(),
    };
  }

  // Maybe bare base64 — try to decode and sniff. Bail cheaply on anything that
  // can't possibly be an image (too short, contains non-base64 chars).
  if (trimmed.length < 16 || /[^A-Za-z0-9+/=\s]/.test(trimmed)) return null;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(trimmed, 'base64');
  } catch {
    return null;
  }
  if (decoded.length < 8) return null;
  const mimeType = sniffMime(decoded);
  if (!mimeType) return null;
  return { kind: 'base64', bytes: trimmed, mimeType };
}
