import { classifyHttpError, describeNetworkError } from '../errors.js';
import { classifyImageOutput, sniffMime } from '../image-input.js';
import type {
  GenerateImageParams,
  ImageProviderAdapter,
  RawImageResult,
  ResolvedImageInput,
  ResolvedProvider,
} from '../types.js';
import { withDefaultPath } from '../url.js';

export function bearerHeaders(provider: ResolvedProvider): Record<string, string> {
  const headers: Record<string, string> = {};
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  if (provider.headers) Object.assign(headers, provider.headers);
  return headers;
}

/**
 * OpenAI-compatible image API. Used for OpenAI directly and any
 * customProvider with `api: 'openai'`.
 *
 * Two endpoints:
 *   - POST /v1/images/generations  (text-to-image, JSON body)
 *   - POST /v1/images/edits        (image-to-image, multipart/form-data)
 *
 * The edit path is selected when the caller passes `inputs` (resolved
 * reference images). Mask is intentionally not exposed to keep scope small.
 *
 * OpenRouter is NOT OpenAI-compatible for images — it uses POST /api/v1/images
 * (no `/generations` suffix). See providers/openrouter.ts.
 */
export const openaiAdapter: ImageProviderAdapter = {
  async generate(
    provider: ResolvedProvider,
    remoteModelId: string,
    params: GenerateImageParams,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
    inputs?: ResolvedImageInput[],
  ): Promise<RawImageResult[]> {
    if (!provider.apiKey) {
      throw new Error(missingKeyMessage(provider));
    }
    const base = withDefaultPath(provider.baseUrl, '/v1');
    if (inputs && inputs.length > 0) {
      return generateWithImages(provider, base, remoteModelId, params, inputs, fetchImpl, signal);
    }
    return generateFromText(provider, base, remoteModelId, params, fetchImpl, signal);
  },
};

async function generateFromText(
  provider: ResolvedProvider,
  base: string,
  remoteModelId: string,
  params: { prompt: string; n?: number; size?: string },
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<RawImageResult[]> {
  const url = `${base}/images/generations`;
  const body: Record<string, unknown> = {
    model: remoteModelId,
    prompt: params.prompt,
    n: params.n ?? 1,
  };
  if (params.size) body.size = params.size;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { ...bearerHeaders(provider), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (error) {
    throw new Error(describeNetworkError(error, provider));
  }
  return parseImagesResponse(res, url, provider);
}

async function generateWithImages(
  provider: ResolvedProvider,
  base: string,
  remoteModelId: string,
  params: { prompt: string; n?: number; size?: string },
  inputs: ResolvedImageInput[],
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<RawImageResult[]> {
  const url = `${base}/images/edits`;
  const form = new FormData();
  form.append('model', remoteModelId);
  form.append('prompt', params.prompt);
  form.append('n', String(params.n ?? 1));
  if (params.size) form.append('size', params.size);
  // OpenAI accepts repeated `image[]` for multi-image edits on gpt-image-2.
  const fieldName = inputs.length > 1 ? 'image[]' : 'image';
  for (const [i, input] of inputs.entries()) {
    const ext = input.mimeType.split('/')[1] ?? 'png';
    const blob = new Blob([Buffer.from(input.bytes)], { type: input.mimeType });
    form.append(fieldName, blob, `image-${i}.${ext}`);
  }

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: bearerHeaders(provider),
      body: form,
      signal: signal ?? null,
    });
  } catch (error) {
    throw new Error(describeNetworkError(error, provider));
  }
  return parseImagesResponse(res, url, provider);
}

export async function parseImagesResponse(
  res: Response,
  url: string,
  provider: ResolvedProvider,
): Promise<RawImageResult[]> {
  const text = await safeText(res);
  if (!res.ok) {
    throw new Error(classifyHttpError(res, text, provider));
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    const preview = text.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(
      `${provider.name} returned ${contentType || 'non-JSON'} from ${url}. The endpoint probably doesn't expose the OpenAI-compatible images API at this path. Body: ${preview}`,
    );
  }
  let json: {
    data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string; media_type?: string }>;
  };
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${provider.name} returned invalid JSON: ${(error as Error).message}`);
  }
  const data = json.data ?? [];
  const out: RawImageResult[] = [];
  for (const entry of data) {
    // Prefer explicit b64_json field (OpenAI shape). If absent, classify the
    // `url` field — some gateways return a `data:` URI or even raw base64
    // there instead of a real URL.
    let payload: RawImageResult['data'] | null = null;
    if (entry.b64_json) {
      const decoded = Buffer.from(entry.b64_json, 'base64');
      const mimeType = sniffMime(decoded) ?? entry.media_type ?? 'image/png';
      payload = { kind: 'base64', bytes: entry.b64_json, mimeType };
    } else {
      const classified = classifyImageOutput(entry.url);
      if (classified) payload = classified;
    }
    if (!payload) continue;
    const item: RawImageResult = { data: payload };
    if (entry.revised_prompt) item.revisedPrompt = entry.revised_prompt;
    out.push(item);
  }
  if (out.length === 0) {
    throw new Error(
      `${provider.name} returned no usable images. Response had ${data.length} entries but none had b64_json or a valid url. Raw: ${text.slice(0, 300).replace(/\s+/g, ' ')}`,
    );
  }
  return out;
}

export function missingKeyMessage(provider: ResolvedProvider): string {
  if (provider.builtIn) {
    return `Provider "${provider.id}" has no API key. Tell the user to set OPENAI_API_KEY (or pi-image-gen.providers.${provider.id}.apiKey in settings.json).`;
  }
  return `Provider "${provider.id}" has no API key. Tell the user to set pi-image-gen.customProviders.${provider.id}.apiKey in settings.json.`;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable response body>';
  }
}
