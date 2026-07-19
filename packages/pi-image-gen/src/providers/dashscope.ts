import { classifyHttpError, describeNetworkError } from '../errors.js';
import { classifyImageOutput, toDataUri } from '../image-input.js';
import type {
  GenerateImageParams,
  ImageProviderAdapter,
  RawImageResult,
  ResolvedImageInput,
  ResolvedProvider,
} from '../types.js';
import { withDefaultPath } from '../url.js';

/**
 * Alibaba DashScope text-to-image (Qwen-Image series). Sync only:
 *
 *   POST /services/aigc/multimodal-generation/generation
 *   One request, one response, image URLs / bytes inline.
 *
 * The legacy async task endpoint (text2image/image-synthesis) is not used —
 * it doesn't accept reference images and the supported models there are old.
 */
export const dashscopeAdapter: ImageProviderAdapter = {
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
    const base = withDefaultPath(provider.baseUrl, '/api/v1');
    const headers: Record<string, string> = {
      authorization: `Bearer ${provider.apiKey}`,
      'content-type': 'application/json',
    };
    if (provider.headers) Object.assign(headers, provider.headers);

    const userContent: Array<{ text?: string; image?: string }> = [];
    for (const input of inputs ?? []) {
      userContent.push({ image: toDataUri(input) });
    }
    userContent.push({ text: params.prompt });

    let res: Response;
    try {
      res = await fetchImpl(`${base}/services/aigc/multimodal-generation/generation`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: remoteModelId,
          input: { messages: [{ role: 'user', content: userContent }] },
          parameters: {
            n: params.n ?? 1,
            ...(params.size ? { size: params.size } : {}),
          },
        }),
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
      output?: {
        choices?: Array<{
          message?: {
            content?: Array<{
              image?: string;
              image_url?: string | { url?: string };
              text?: string;
            }>;
          };
        }>;
      };
    };
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error(`${provider.name} returned invalid JSON: ${(error as Error).message}`);
    }
    const out: RawImageResult[] = [];
    for (const choice of json.output?.choices ?? []) {
      for (const part of choice.message?.content ?? []) {
        const candidate =
          typeof part.image_url === 'string' ? part.image_url : (part.image_url?.url ?? part.image);
        const classified = classifyImageOutput(candidate);
        if (classified) out.push({ data: classified });
      }
    }
    if (out.length === 0) {
      throw new Error(
        `${provider.name} returned no images. The model may have refused the prompt or the response shape changed. Raw: ${text.slice(0, 300).replace(/\s+/g, ' ')}`,
      );
    }
    return out;
  },
};

function missingKeyMessage(provider: ResolvedProvider): string {
  if (provider.builtIn) {
    return `Provider "${provider.id}" has no API key. Tell the user to set DASHSCOPE_API_KEY (or pi-image-gen.providers.${provider.id}.apiKey in settings.json).`;
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
