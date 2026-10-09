import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { resolveDefaultRoute } from './config.js';
import { resolveImageInputs } from './image-input.js';
import { getAdapter } from './providers/index.js';
import type {
  GeneratedImage,
  GenerateImageParams,
  ImageGenResult,
  ImageGenSettings,
  RawImageResult,
  ResolvedProvider,
} from './types.js';

export type GenerateImageOptions = {
  cwd: string;
  settings: ImageGenSettings;
  fetchImpl?: typeof fetch;
  /** Cancellation signal — propagated to every fetch and the DashScope poll loop. */
  signal?: AbortSignal;
};

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function generateImage(
  params: GenerateImageParams,
  options: GenerateImageOptions,
): Promise<ImageGenResult> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const resolved = resolveDefaultRoute(options.settings);
  if ('error' in resolved) throw new Error(resolved.error);

  const adapter = getAdapter(resolved.provider.api);
  const inputs = await resolveImageInputs(params.image, options.cwd, fetchImpl, options.signal);
  const raws = await adapter.generate(
    resolved.provider,
    resolved.remoteId,
    params,
    fetchImpl,
    options.signal,
    inputs,
  );

  options.signal?.throwIfAborted();

  const outDir = resolveOutputDir(params.outputDir ?? options.settings.outputDir, options.cwd);
  await mkdir(outDir, { recursive: true });

  const stamp = formatStamp(new Date());
  const baseFilename = sanitizeFilename(params.filename ?? `${resolved.requestedId}-${stamp}`);
  const images: GeneratedImage[] = [];
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i]!;
    const fetched = await materialize(raw, fetchImpl, options.signal);
    const ext = MIME_TO_EXT[fetched.mimeType] ?? 'png';
    const suffix = raws.length > 1 ? `-${i + 1}` : '';
    // Exclusive write: two generations in the same second, parallel calls, or
    // a user-fixed filename reused across runs must never overwrite an image
    // already on disk (BYTE-5 #3).
    const path = await writeExclusively(resolve(outDir, `${baseFilename}${suffix}.${ext}`), fetched.bytes);
    const image: GeneratedImage = { path, mimeType: fetched.mimeType };
    if (raw.revisedPrompt) image.revisedPrompt = raw.revisedPrompt;
    images.push(image);
  }

  return {
    model: resolved.requestedId,
    provider: providerLabel(resolved.provider),
    images,
  };
}

function providerLabel(provider: ResolvedProvider): string {
  return provider.builtIn ? provider.id : `${provider.id} (custom)`;
}

/**
 * Writes with `wx` so an existing image is never overwritten; on EEXIST the
 * next free `-2`, `-3`, … candidate name is tried and its path returned, so
 * the markdown output always points at the file that actually holds this
 * generation.
 */
async function writeExclusively(path: string, bytes: Uint8Array): Promise<string> {
  const dir = dirname(path);
  const ext = extname(path);
  const stem = basename(path, ext);
  let candidate = path;
  for (let n = 2; n <= 99; n++) {
    try {
      await writeFile(candidate, bytes, { flag: 'wx' });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      candidate = join(dir, `${stem}-${n}${ext}`);
    }
  }
  throw new Error(`Could not write ${path}: every candidate name already exists.`);
}

function resolveOutputDir(configured: string | undefined, cwd: string): string {
  const target = configured && configured.trim().length > 0 ? configured : '.pi/images';
  return isAbsolute(target) ? target : resolve(cwd, target);
}

function formatStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function sanitizeFilename(name: string): string {
  const trimmed = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_');
  return trimmed.length > 0 ? trimmed.slice(0, 100) : 'image';
}

async function materialize(
  raw: RawImageResult,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (raw.data.kind === 'base64') {
    return {
      bytes: Buffer.from(raw.data.bytes, 'base64'),
      mimeType: raw.data.mimeType ?? 'image/png',
    };
  }
  if (!raw.data.url || !/^https?:\/\//i.test(raw.data.url)) {
    throw new Error(
      `Provider returned a non-URL image reference (${raw.data.url ? raw.data.url.slice(0, 60) : 'empty'}). The response shape may have changed.`,
    );
  }
  const res = await fetchImpl(raw.data.url, { signal: signal ?? null });
  if (!res.ok) {
    throw new Error(`Failed to download generated image (${res.status} ${res.statusText}).`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
  return { bytes: buf, mimeType };
}
