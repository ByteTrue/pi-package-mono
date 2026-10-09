import type { ImageContent } from "@earendil-works/pi-ai";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

/** Formats every mainstream vision API accepts. */
const MAGIC: Array<{ mimeType: string; bytes: number[] }> = [
  { mimeType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mimeType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mimeType: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },
  { mimeType: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
  // WebP: "RIFF" at 0..3 and "WEBP" at 8..11
  { mimeType: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46] },
];

/** Guards against handing a multi-hundred-MB file to an HTTP request. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Shared attachment cap for both the image_ask tool and auto analysis
 * (BYTE-6 A3): the tool path had no count limit, so one model call could
 * attach dozens of images — an oversized request and a huge base64 blob
 * held in memory. One rule, two paths.
 */
export const MAX_ATTACHMENT_COUNT = 4;

/**
 * Decoded length of a base64 string, or undefined when it is not valid
 * base64 (wrong padding/length or illegal characters).
 */
export function decodedBase64Length(data: string): number | undefined {
  if (!data || data.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const contentLength = data.length - padding;
  if (padding && (data.length % 4 !== 0 || contentLength % 4 !== 4 - padding)) return;
  return Math.floor((contentLength * 6) / 8);
}

/**
 * Declared-MIME normalization (BYTE-6 A4): upstream pipelines commonly label
 * JPEG as the non-standard image/jpg; sniffed values must still win, but the
 * benign alias must not fail the whole batch.
 */
const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
};

export function normalizeDeclaredMime(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  return MIME_ALIASES[lower] ?? lower;
}

export function sniffMime(bytes: Uint8Array): string | undefined {
  for (const { mimeType, bytes: magic } of MAGIC) {
    if (bytes.length < magic.length) continue;
    if (magic.some((b, i) => bytes[i] !== b)) continue;
    if (mimeType === "image/webp") {
      const isWebp =
        bytes.length >= 12 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50;
      if (!isWebp) continue;
    }
    return mimeType;
  }
  return undefined;
}

/** Read one image path (absolute, or relative to the session cwd) into an ImageContent part. */
export async function readImageFile(path: string, cwd: string): Promise<ImageContent> {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("Empty image path.");
  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error(
      `image_ask takes local file paths, not URLs ("${trimmed}"). Download it first, then pass the file path.`,
    );
  }

  const absolute = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);

  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(absolute);
  } catch (error) {
    throw new Error(`Cannot read "${absolute}": ${(error as NodeJS.ErrnoException).code ?? "unreadable"}.`);
  }
  if (!info.isFile()) throw new Error(`"${absolute}" is not a file.`);
  if (info.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `"${absolute}" is ${Math.round(info.size / 1024 / 1024)}MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024}MB limit. Downscale it first.`,
    );
  }

  const bytes = await readFile(absolute);
  const mimeType = sniffMime(bytes);
  if (!mimeType) {
    throw new Error(
      `"${absolute}" is not a PNG, JPEG, GIF or WebP image (checked the file header, not the extension).`,
    );
  }

  return { type: "image", data: bytes.toString("base64"), mimeType };
}
