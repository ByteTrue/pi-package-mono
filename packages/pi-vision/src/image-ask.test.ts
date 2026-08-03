import type { AssistantMessage } from "@earendil-works/pi-ai";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runImageAsk, type CompleteFn } from "./image-ask.js";
import { makeCtx, makeModel, makeSettingsSandbox } from "./test-helpers.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x02]);

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

function reply(text: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "openai-completions",
    provider: "vendor",
    model: "qwen-plus",
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  } as AssistantMessage;
}

/** Configured vision model + one readable PNG named shot.png in cwd. */
function scenario(auth?: { ok: false; error: string }) {
  const { cwd } = makeSettingsSandbox({ model: "vendor/qwen-plus" });
  writeFileSync(join(cwd, "shot.png"), PNG);
  writeFileSync(join(cwd, "mock.jpg"), JPEG);
  const ctx = makeCtx({
    cwd,
    models: [makeModel("vendor", "qwen-plus")],
    auth: auth ?? { ok: true, apiKey: "sk-test-abcdef123456" },
  });
  return { cwd, ctx };
}

describe("runImageAsk", () => {
  it("sends the images plus the question and returns the text answer", async () => {
    const { ctx } = scenario();
    const complete = vi.fn().mockResolvedValue(reply("The button is 12px off.")) as unknown as CompleteFn;

    const result = await runImageAsk(
      { paths: ["shot.png"], question: "Where is the button?" },
      ctx,
      undefined,
      complete,
    );

    expect(result.content).toEqual([{ type: "text", text: "The button is 12px off." }]);
    expect(result.details).toEqual({ model: "vendor/qwen-plus", imageCount: 1 });

    const [model, context, options] = vi.mocked(complete).mock.calls[0]!;
    expect(model.id).toBe("qwen-plus");
    expect(context.messages[0]!.content).toEqual([
      { type: "image", data: PNG.toString("base64"), mimeType: "image/png" },
      { type: "text", text: "Where is the button?" },
    ]);
    expect(options?.apiKey).toBe("sk-test-abcdef123456");
  });

  it("keeps multiple images in the order given, before the question", async () => {
    const { ctx } = scenario();
    const complete = vi.fn().mockResolvedValue(reply("They differ in padding.")) as unknown as CompleteFn;

    const result = await runImageAsk(
      { paths: ["mock.jpg", "shot.png"], question: "Compare them." },
      ctx,
      undefined,
      complete,
    );

    expect(result.details.imageCount).toBe(2);
    const [, context] = vi.mocked(complete).mock.calls[0]!;
    expect(context.messages[0]!.content).toEqual([
      { type: "image", data: JPEG.toString("base64"), mimeType: "image/jpeg" },
      { type: "image", data: PNG.toString("base64"), mimeType: "image/png" },
      { type: "text", text: "Compare them." },
    ]);
  });

  it("forwards the abort signal so Esc can cancel the nested call", async () => {
    const { ctx } = scenario();
    const complete = vi.fn().mockResolvedValue(reply("ok")) as unknown as CompleteFn;
    const controller = new AbortController();

    await runImageAsk({ paths: ["shot.png"], question: "q" }, ctx, controller.signal, complete);

    expect(vi.mocked(complete).mock.calls[0]![2]?.signal).toBe(controller.signal);
  });

  it("refuses empty input without calling the model", async () => {
    const { ctx } = scenario();
    const complete = vi.fn() as unknown as CompleteFn;

    await expect(runImageAsk({ paths: [], question: "q" }, ctx, undefined, complete)).rejects.toThrow(
      /No image paths/,
    );
    await expect(
      runImageAsk({ paths: ["shot.png"], question: "  " }, ctx, undefined, complete),
    ).rejects.toThrow(/No question/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("fails before any network call when no vision model is configured", async () => {
    const { cwd } = makeSettingsSandbox();
    writeFileSync(join(cwd, "shot.png"), PNG);
    const ctx = makeCtx({ cwd, models: [makeModel("vendor", "qwen-plus")] });
    const complete = vi.fn() as unknown as CompleteFn;

    await expect(
      runImageAsk({ paths: ["shot.png"], question: "q" }, ctx, undefined, complete),
    ).rejects.toThrow(/No vision model configured/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("fails before any network call when credentials cannot be resolved", async () => {
    const { ctx } = scenario({ ok: false, error: "missing" });
    const complete = vi.fn() as unknown as CompleteFn;

    await expect(
      runImageAsk({ paths: ["shot.png"], question: "q" }, ctx, undefined, complete),
    ).rejects.toThrow(/Credentials for provider/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("fails before any network call when an image cannot be read", async () => {
    const { ctx } = scenario();
    const complete = vi.fn() as unknown as CompleteFn;

    await expect(
      runImageAsk({ paths: ["shot.png", "missing.png"], question: "q" }, ctx, undefined, complete),
    ).rejects.toThrow(/missing\.png/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("reports an upstream error response", async () => {
    const { ctx } = scenario();
    const complete = vi
      .fn()
      .mockResolvedValue(
        reply("", { stopReason: "error", errorMessage: "402 insufficient quota" }),
      ) as unknown as CompleteFn;

    await expect(
      runImageAsk({ paths: ["shot.png"], question: "q" }, ctx, undefined, complete),
    ).rejects.toThrow(/402 insufficient quota/);
  });

  it("withholds an upstream message that echoes the api key", async () => {
    const { ctx } = scenario();
    const complete = vi.fn().mockResolvedValue(
      reply("", {
        stopReason: "error",
        errorMessage: 'invalid header Authorization: Bearer sk-test-abcdef123456',
      }),
    ) as unknown as CompleteFn;

    await expect(
      runImageAsk({ paths: ["shot.png"], question: "q" }, ctx, undefined, complete),
    ).rejects.toThrow(/echoed the API key/);
    await expect(
      runImageAsk({ paths: ["shot.png"], question: "q" }, ctx, undefined, complete),
    ).rejects.not.toThrow(/sk-test-abcdef123456/);
  });

  it("withholds a thrown transport error that echoes the api key", async () => {
    const { ctx } = scenario();
    const complete = vi
      .fn()
      .mockRejectedValue(new Error("connect failed with key sk-test-abcdef123456")) as unknown as CompleteFn;

    await expect(
      runImageAsk({ paths: ["shot.png"], question: "q" }, ctx, undefined, complete),
    ).rejects.toThrow(/echoed the API key/);
  });

  it("reports an empty answer instead of returning nothing", async () => {
    const { ctx } = scenario();
    const complete = vi.fn().mockResolvedValue(reply("")) as unknown as CompleteFn;

    await expect(
      runImageAsk({ paths: ["shot.png"], question: "q" }, ctx, undefined, complete),
    ).rejects.toThrow(/returned no text/);
  });

  it("rejects direct calls when the current model already supports images", async () => {
    const { ctx: base } = scenario();
    const ctx = { ...base, model: makeModel("vendor", "main", true) };
    const complete = vi.fn() as unknown as CompleteFn;

    await expect(runImageAsk({ paths: ["shot.png"], question: "q" }, ctx, undefined, complete)).rejects.toThrow(
      /already supports images/,
    );
    expect(complete).not.toHaveBeenCalled();
  });
});
