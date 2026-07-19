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
import { bearerHeaders, parseImagesResponse } from './openai.js';

/**
 * Volcengine Ark image generation (ByteDance Seedream series).
 *
 *   POST /api/v3/images/generations
 *
 * OpenAI-shaped request + response (model/prompt/n/size, data[].url|b64_json),
 * with one twist: reference images for image-to-image / multi-image conditioning
 * go into the same JSON body as `image: [<data-uri>, ...]` — NOT a multipart
 * /images/edits call. So we reuse openai's parser but build our own body.
 *
 * Docs: https://www.volcengine.com/docs/82379/1824121
 */
export const arkAdapter: ImageProviderAdapter = {
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
    const base = withDefaultPath(provider.baseUrl, '/api/v3');
    const url = `${base}/images/generations`;
    const body: Record<string, unknown> = {
      model: remoteModelId,
      prompt: params.prompt,
      n: params.n ?? 1,
    };
    if (params.size) body.size = params.size;
    if (inputs && inputs.length > 0) {
      body.image = inputs.map((input) => toDataUri(input));
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

function missingKeyMessage(provider: ResolvedProvider): string {
  if (provider.builtIn) {
    return `Provider "${provider.id}" has no API key. Tell the user to set ARK_API_KEY (or pi-image-gen.providers.${provider.id}.apiKey in settings.json).`;
  }
  return `Provider "${provider.id}" has no API key. Tell the user to set pi-image-gen.customProviders.${provider.id}.apiKey in settings.json.`;
}
