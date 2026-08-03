import { fauxAssistantMessage, type ImageContent } from "@earendil-works/pi-ai";
import type { BeforeAgentStartEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_ANALYZE_TIMEOUT_MS,
  MAX_AUTO_IMAGE_BYTES,
  MAX_AUTO_IMAGES,
  runAutoAnalyze,
} from "./auto-analyze.js";
import type { CompleteFn } from "./image-ask.js";
import { makeCtx, makeModel, makeSettingsSandbox } from "./test-helpers.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x02]);
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  vi.useRealTimers();
});

function image(bytes: Buffer, mimeType: string): ImageContent {
  return { type: "image", data: bytes.toString("base64"), mimeType };
}
function event(images: ImageContent[], prompt = "Compare the screenshots and fix the regression."): BeforeAgentStartEvent {
  return {
    type: "before_agent_start",
    prompt,
    images,
    systemPrompt: "system",
    systemPromptOptions: { cwd: "/tmp" },
  };
}

function scenario(autoAnalyzeAttachments: boolean, mainVision = false) {
  const { cwd } = makeSettingsSandbox({
    model: "vendor/qwen-plus",
    autoAnalyzeAttachments,
  });
  const notifications: Array<{ message: string; type?: string }> = [];
  const ctx = {
    ...makeCtx({
      cwd,
      model: makeModel("vendor", "main", mainVision),
      models: [makeModel("vendor", "qwen-plus")],
    }),
    hasUI: true,
    ui: {
      notify: (message: string, type?: string) => notifications.push({ message, type }),
    },
  } as unknown as ExtensionContext;
  return { ctx, notifications };
}

describe("runAutoAnalyze", () => {
  it("batches every attached image into one focused vision request and injects the answer", async () => {
    const { ctx, notifications } = scenario(true);
    const complete = vi
      .fn()
      .mockResolvedValue(fauxAssistantMessage("The second screenshot has 12px extra padding.")) as unknown as CompleteFn;
    const images = [image(PNG, "image/png"), image(JPEG, "image/jpeg")];

    const result = await runAutoAnalyze(event(images), ctx, complete);

    expect(complete).toHaveBeenCalledOnce();
    const [, context] = vi.mocked(complete).mock.calls[0]!;
    expect(context.messages[0]!.content).toEqual([
      ...images,
      {
        type: "text",
        text: expect.stringContaining("Compare the screenshots and fix the regression."),
      },
    ]);
    expect(result?.message).toMatchObject({
      customType: "pi-vision-auto-analysis",
      display: false,
      details: { model: "vendor/qwen-plus", imageCount: 2 },
    });
    expect(result?.message?.content).toContain("12px extra padding");
    expect(notifications).toContainEqual({
      message: "Analyzed 2 attached images with vendor/qwen-plus.",
      type: "info",
    });
  });

  it("does nothing unless auto mode is enabled and the main model is text-only", async () => {
    const disabled = scenario(false);
    const complete = vi.fn() as unknown as CompleteFn;

    await expect(runAutoAnalyze(event([image(PNG, "image/png")]), disabled.ctx, complete)).resolves.toBeUndefined();

    const multimodal = scenario(true, true);
    await expect(runAutoAnalyze(event([image(PNG, "image/png")]), multimodal.ctx, complete)).resolves.toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
  });

  it("ignores project-local opt-in when the project is not trusted", async () => {
    const { cwd } = makeSettingsSandbox();
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({
        "pi-vision": { model: "vendor/qwen-plus", autoAnalyzeAttachments: true },
      }),
    );
    const ctx = makeCtx({
      cwd,
      projectTrusted: false,
      model: makeModel("vendor", "main", false),
      models: [makeModel("vendor", "qwen-plus")],
    });
    const complete = vi.fn() as unknown as CompleteFn;

    await expect(runAutoAnalyze(event([image(PNG, "image/png")]), ctx, complete)).resolves.toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects oversized batches without silently dropping images", async () => {
    const { ctx, notifications } = scenario(true);
    const bytes = Buffer.alloc(MAX_AUTO_IMAGE_BYTES + 1);
    PNG.copy(bytes);
    const complete = vi.fn() as unknown as CompleteFn;

    const result = await runAutoAnalyze(event([image(bytes, "image/png")]), ctx, complete);

    expect(complete).not.toHaveBeenCalled();
    expect(result?.message?.content).toContain("was not analyzed");
    expect(result?.message?.content).toContain("20MB total limit");
    expect(notifications.at(-1)).toMatchObject({ type: "warning" });
  });

  it("rejects encoded data larger than the budget before decoding it", async () => {
    const { ctx } = scenario(true);
    const oversized: ImageContent = {
      type: "image",
      data: "A".repeat(Math.ceil(MAX_AUTO_IMAGE_BYTES / 3) * 4 + 1),
      mimeType: "image/png",
    };
    const decode = vi.spyOn(Buffer, "from");

    try {
      const result = await runAutoAnalyze(event([oversized]), ctx, vi.fn() as unknown as CompleteFn);

      expect(decode).not.toHaveBeenCalled();
      expect(result?.message?.content).toContain("20MB total limit");
    } finally {
      decode.mockRestore();
    }
  });

  it("rejects malformed base64 before calling the provider", async () => {
    const { ctx } = scenario(true);
    const complete = vi.fn() as unknown as CompleteFn;
    const malformed: ImageContent = {
      type: "image",
      data: `${PNG.toString("base64")}!`,
      mimeType: "image/png",
    };

    const result = await runAutoAnalyze(event([malformed]), ctx, complete);

    expect(complete).not.toHaveBeenCalled();
    expect(result?.message?.content).toContain("invalid base64");
  });

  it("rejects too many or falsely labelled images before calling the provider", async () => {
    const { ctx } = scenario(true);
    const complete = vi.fn() as unknown as CompleteFn;

    const tooMany = await runAutoAnalyze(
      event(Array.from({ length: MAX_AUTO_IMAGES + 1 }, () => image(PNG, "image/png"))),
      ctx,
      complete,
    );
    const badMime = await runAutoAnalyze(
      event([image(Buffer.from("not an image"), "image/png")]),
      ctx,
      complete,
    );

    expect(complete).not.toHaveBeenCalled();
    expect(tooMany?.message?.content).toContain(`at most ${MAX_AUTO_IMAGES}`);
    expect(badMime?.message?.content).toContain("does not match its declared MIME type");
  });

  it("stops a hung automatic request at the local deadline", async () => {
    vi.useFakeTimers();
    const { ctx } = scenario(true);
    const complete = vi.fn(
      (_model: unknown, _context: unknown, options: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        }),
    ) as unknown as CompleteFn;

    const pending = runAutoAnalyze(event([image(PNG, "image/png")]), ctx, complete);
    await vi.advanceTimersByTimeAsync(AUTO_ANALYZE_TIMEOUT_MS);
    const result = await pending;

    expect(complete).toHaveBeenCalledOnce();
    expect(result?.message?.content).toContain("timed out");
  });

  it("injects an explicit failure so the main model cannot claim it saw the images", async () => {
    const { ctx, notifications } = scenario(true);
    const complete = vi.fn().mockRejectedValue(new Error("network down")) as unknown as CompleteFn;

    const result = await runAutoAnalyze(event([image(PNG, "image/png")]), ctx, complete);

    expect(result?.message?.content).toContain("was not analyzed");
    expect(result?.message?.content).toContain("Use image_ask");
    expect(notifications.at(-1)).toMatchObject({ type: "warning" });
  });
});
