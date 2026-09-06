import { withDefaultPath } from './url.js';
import type { ApiStyle } from './types.js';

const IMAGE_MODEL_KEYWORDS = [
  'image',
  'flux',
  'dall-e',
  'dalle',
  'recraft',
  'seedream',
  'doubao-seedream',
  'sd-',
  'sd_',
  'sdxl',
  'stable-diffusion',
  'stablediffusion',
  'midjourney',
  'ideogram',
  'imagen',
  'wanx',
  'qwen-image',
  'cogview',
  'kling',
  'sora',
  'luma',
  'runway',
  'gen-',
  'nano-banana',
  'gpt-image',
  'kolors',
  'hidream',
  'auraflow',
  'canvas',
];

export function isLikelyImageModel(id: string): boolean {
  const lower = id.toLowerCase();
  return IMAGE_MODEL_KEYWORDS.some((kw) => lower.includes(kw));
}

export interface DiscoverOptions {
  api: ApiStyle;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export async function discoverRemoteModels(options: DiscoverOptions): Promise<string[]> {
  const { api, baseUrl, apiKey, headers, timeoutMs = 5000, fetchFn = globalThis.fetch } = options;
  if (!baseUrl || !fetchFn) return [];

  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(timeoutMs)
    : undefined;

  try {
    if (api === 'openai' || api === 'openrouter') {
      const targetUrl = `${withDefaultPath(baseUrl, '/v1').replace(/\/+$/, '')}/models`;
      const reqHeaders: Record<string, string> = {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(headers ?? {}),
      };

      const response = await fetchFn(targetUrl, {
        method: 'GET',
        headers: reqHeaders,
        signal,
      });

      if (!response.ok) return [];
      const json: unknown = await response.json();
      const rawList = extractModelList(json);
      return sortAndDedupeModels(rawList);
    }

    if (api === 'gemini') {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      const url = new URL(`${cleanBase}/models`);
      if (apiKey) {
        url.searchParams.set('key', apiKey);
      }
      const reqHeaders: Record<string, string> = {
        ...(apiKey ? { 'x-goog-api-key': apiKey } : {}),
        ...(headers ?? {}),
      };

      const response = await fetchFn(url.toString(), {
        method: 'GET',
        headers: reqHeaders,
        signal,
      });

      if (!response.ok) return [];
      const json: unknown = await response.json();
      const rawList = extractGeminiModels(json);
      return sortAndDedupeModels(rawList);
    }
  } catch {
    // Fail-soft: network failure, timeout, non-JSON or auth rejection returns empty list.
    return [];
  }

  return [];
}

function extractModelList(json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const list = Array.isArray(json)
    ? json
    : Array.isArray((json as Record<string, unknown>).data)
      ? (json as { data: unknown[] }).data
      : Array.isArray((json as Record<string, unknown>).models)
        ? (json as { models: unknown[] }).models
        : [];

  const ids: string[] = [];
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) {
      ids.push(item.trim());
    } else if (item && typeof item === 'object') {
      const id = (item as Record<string, unknown>).id ?? (item as Record<string, unknown>).name;
      if (typeof id === 'string' && id.trim()) {
        ids.push(id.trim());
      }
    }
  }
  return ids;
}

function extractGeminiModels(json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const list = Array.isArray((json as Record<string, unknown>).models)
    ? (json as { models: unknown[] }).models
    : [];

  const ids: string[] = [];
  for (const item of list) {
    if (item && typeof item === 'object') {
      const name = (item as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) {
        // e.g. "models/gemini-2.5-flash-image" -> "gemini-2.5-flash-image"
        ids.push(name.replace(/^models\//, '').trim());
      }
    }
  }
  return ids;
}

function sortAndDedupeModels(ids: string[]): string[] {
  const unique = Array.from(new Set(ids));
  const likelyImages: string[] = [];
  const others: string[] = [];

  for (const id of unique) {
    if (isLikelyImageModel(id)) {
      likelyImages.push(id);
    } else {
      others.push(id);
    }
  }

  // Return likely image models first, followed by other discovered models
  return [...likelyImages, ...others];
}
