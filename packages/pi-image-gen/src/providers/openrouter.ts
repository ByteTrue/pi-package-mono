import { describeNetworkError } from '../errors.js';
import { toDataUri } from '../image-input.js';
import type {
  GenerateImageParams,
  ImageProviderAdapter,
  RawImageResult,
  ResolvedImageInput,
  ResolvedProvider,
} from '../types.js';
import { withDefaultPath } from '../url.js';
import { bearerHeaders, missingKeyMessage, parseImagesResponse } from './openai.js';

/**
 * OpenRouter image API. Looks OpenAI-shaped but the endpoint differs:
 *   - OpenAI:     POST /v1/images/generations  (text)  /  /v1/images/edits (multipart)
 *   - OpenRouter: POST /api/v1/images          (text)  /  same path + `input_references` JSON (edits)
 *
 * Response body uses `data[].b64_json` like OpenAI, so we reuse parseImagesResponse.
 * See https://openrouter.ai/blog/announcements/image-api/.
 */
export const openrouterAdapter: ImageProviderAdapter = {
  async generate(
    provider: ResolvedProvider,
    remoteModelId: string,
    params: GenerateImageParams,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
    inputs?: ResolvedImageInput[],
  ): Promise<RawImageResult[]> {
    if (!provider.apiKey) throw new Error(missingKeyMessage(provider));
    const base = withDefaultPath(provider.baseUrl, '/api/v1');
    const url = `${base}/images`;
    const body: Record<string, unknown> = {
      model: remoteModelId,
      prompt: params.prompt,
      n: params.n ?? 1,
    };
    if (params.size) body.size = params.size;
    if (inputs && inputs.length > 0) {
      body.input_references = inputs.map((input) => ({
        image_url: { url: toDataUri(input) },
      }));
    }

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
  },
};
