import { classifyHttpError, describeNetworkError } from '../errors.js';
import type {
  GenerateImageParams,
  ImageProviderAdapter,
  RawImageResult,
  ResolvedImageInput,
  ResolvedProvider,
} from '../types.js';
import { withDefaultPath } from '../url.js';

/**
 * Google Generative Language API for `gemini-2.5-flash-image` (Nano Banana)
 * and successors.
 *   POST {baseUrl}/models/{model}:generateContent
 *   Header: x-goog-api-key
 * Response: candidates[].content.parts[].inline_data (base64).
 */
export const geminiAdapter: ImageProviderAdapter = {
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
    const base = withDefaultPath(provider.baseUrl, '/v1beta');
    const url = `${base}/models/${encodeURIComponent(remoteModelId)}:generateContent`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-goog-api-key': provider.apiKey,
    };
    if (provider.headers) Object.assign(headers, provider.headers);

    const n = params.n ?? 1;
    // Per https://ai.google.dev/gemini-api/docs/image-generation REST examples,
    // request body uses snake_case (`inline_data`, `mime_type`). Google accepts
    // both; we stay aligned with the docs.
    const userParts: Array<
      { text: string } | { inline_data: { mime_type: string; data: string } }
    > = [];
    for (const input of inputs ?? []) {
      userParts.push({
        inline_data: {
          mime_type: input.mimeType,
          data: Buffer.from(input.bytes).toString('base64'),
        },
      });
    }
    userParts.push({ text: params.prompt });
    const body = {
      contents: [{ role: 'user', parts: userParts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        candidateCount: n,
      },
    };

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: signal ?? null,
      });
    } catch (error) {
      throw new Error(describeNetworkError(error, provider));
    }
    const text = await safeText(res);
    if (!res.ok) {
      throw new Error(classifyHttpError(res, text, provider));
    }
    let json: {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType?: string; data?: string };
            inline_data?: { mime_type?: string; data?: string };
          }>;
        };
      }>;
    };
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error(`${provider.name} returned invalid JSON: ${(error as Error).message}`);
    }

    const out: RawImageResult[] = [];
    for (const candidate of json.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        // Google's REST API returns camelCase `inlineData`; the gRPC/proto form
        // is `inline_data`. Accept both — different gateways may pass either.
        const inline = part.inlineData ?? part.inline_data;
        const data = inline?.data;
        const mimeType =
          (inline as { mimeType?: string; mime_type?: string } | undefined)?.mimeType ??
          (inline as { mimeType?: string; mime_type?: string } | undefined)?.mime_type ??
          'image/png';
        if (data) {
          out.push({
            data: {
              kind: 'base64',
              bytes: data,
              mimeType,
            },
          });
        }
      }
    }
    if (out.length === 0) {
      throw new Error(
        `${provider.name} returned no image data — the model may have refused to generate. Tell the user to rephrase the prompt or try a different model.`,
      );
    }
    return out;
  },
};

function missingKeyMessage(provider: ResolvedProvider): string {
  if (provider.builtIn) {
    return `Provider "${provider.id}" has no API key. Tell the user to set GEMINI_API_KEY (or pi-image-gen.providers.${provider.id}.apiKey in settings.json).`;
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
