import { describe, expect, it } from "vitest";
import { classifyHttpError } from "../errors.js";
import { geminiAdapter } from "../providers/gemini.js";
import { resolveProviderRoute } from "../config.js";
import type { ResolvedProvider } from "../types.js";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function fakeJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("gemini n>1 loops one-image requests (BYTE-6 #14)", () => {
  const provider: ResolvedProvider = {
    id: "gemini",
    api: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    name: "gemini",
    builtIn: true,
    apiKey: "test-key",
  };

  it("sends candidateCount: 1 for the default single image", async () => {
    const calls: Array<{ body: { generationConfig?: { candidateCount?: number } } }> = [];
    const fetchImpl: typeof fetch = (async (_input, init) => {
      calls.push({ body: JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) });
      return fakeJsonResponse({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_BASE64 } }] } }],
      });
    }) as typeof fetch;

    const results = await geminiAdapter.generate(
      provider,
      "gemini-2.5-flash-image",
      { prompt: "a cat" } as Parameters<typeof geminiAdapter.generate>[2],
      fetchImpl,
      undefined,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.generationConfig?.candidateCount).toBe(1);
    expect(results).toHaveLength(1);
  }, 10_000);

  it("honors n=3 with three requests and three images", async () => {
    const calls: Array<{ body: { generationConfig?: { candidateCount?: number } } }> = [];
    const fetchImpl: typeof fetch = (async (_input, init) => {
      calls.push({ body: JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) });
      return fakeJsonResponse({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_BASE64 } }] } }],
      });
    }) as typeof fetch;

    const results = await geminiAdapter.generate(
      provider,
      "gemini-2.5-flash-image",
      { prompt: "a cat", n: 3 } as Parameters<typeof geminiAdapter.generate>[2],
      fetchImpl,
      undefined,
    );

    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.body.generationConfig?.candidateCount).toBe(1);
    expect(results).toHaveLength(3);
  }, 15_000);

  it("propagates an HTTP error from any loop iteration", async () => {
    const fetchImpl: typeof fetch = (async () => new Response("quota", { status: 429 })) as typeof fetch;
    await expect(
      geminiAdapter.generate(
        provider,
        "gemini-2.5-flash-image",
        { prompt: "a cat", n: 2 } as Parameters<typeof geminiAdapter.generate>[2],
        fetchImpl,
        undefined,
      ),
    ).rejects.toThrow(/429/);
  }, 10_000);
});

describe("model discovery probe interpolates env-config routes (BYTE-6 #15 regression)", () => {
  it("resolves env-style baseUrl, apiKey, and headers before the probe receives them", () => {
    process.env.BYTE6_TEST_BASE = "https://relay.example/v1";
    process.env.BYTE6_TEST_TOKEN = "tok-123";
    try {
      const route = resolveProviderRoute("corp", {
        providers: {
          corp: {
            api: "openai",
            baseUrl: '${BYTE6_TEST_BASE}',
            apiKey: '$BYTE6_TEST_TOKEN',
            headers: { 'X-Env': '$BYTE6_TEST_TOKEN' },
          },
        },
      } as Parameters<typeof resolveProviderRoute>[1]);
      expect(route?.baseUrl).toBe("https://relay.example/v1");
      expect(route?.apiKey).toBe("tok-123");
      expect(route?.headers?.["X-Env"]).toBe("tok-123");
    } finally {
      delete process.env.BYTE6_TEST_BASE;
      delete process.env.BYTE6_TEST_TOKEN;
    }
  });
});

describe("401 guidance names the package settings file (BYTE-6 #16)", () => {
  const provider: ResolvedProvider = {
    id: "corp",
    api: "openai",
    baseUrl: "https://relay.example/v1",
    name: "corp",
    builtIn: false,
  };

  it("does not point at the pi settings.json path", () => {
    const message = classifyHttpError(new Response("denied", { status: 401 }), "denied", provider);
    expect(message).toMatch(/pi-image-gen settings\.json/);
    expect(message).not.toMatch(/providers\.corp\.apiKey in settings\.json/);
  });
});
