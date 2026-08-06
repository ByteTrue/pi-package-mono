import { describe, expect, it } from 'vitest';
import { getAdapter } from '../providers/index.js';
import type { ApiStyle, ResolvedProvider } from '../types.js';

const OPENAI_BODY = { data: [{ b64_json: Buffer.from('image').toString('base64') }] };
const GEMINI_BODY = {
  candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('image').toString('base64') } }] } }],
};
const DASHSCOPE_BODY = {
  output: { choices: [{ message: { content: [{ image: `data:image/png;base64,${Buffer.from('image').toString('base64')}` }] } }] },
};

describe('keyless local image routes', () => {
  for (const [api, body] of [
    ['openai', OPENAI_BODY],
    ['gemini', GEMINI_BODY],
    ['dashscope', DASHSCOPE_BODY],
    ['openrouter', OPENAI_BODY],
    ['ark', OPENAI_BODY],
  ] as const satisfies ReadonlyArray<readonly [ApiStyle, object]>) {
    it(`${api} omits credential headers when none is configured`, async () => {
      let requestHeaders: Headers | undefined;
      const fetchImpl: typeof fetch = async (_input, init) => {
        requestHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };
      const provider: ResolvedProvider = {
        id: `local-${api}`,
        api,
        baseUrl: 'http://127.0.0.1:8188',
        name: `Local ${api}`,
        builtIn: false,
      };

      const result = await getAdapter(api).generate(
        provider,
        'image-model',
        { prompt: 'cat' },
        fetchImpl,
      );

      expect(result).toHaveLength(1);
      expect(requestHeaders?.has('authorization')).toBe(false);
      expect(requestHeaders?.has('x-goog-api-key')).toBe(false);
    });
  }
});
