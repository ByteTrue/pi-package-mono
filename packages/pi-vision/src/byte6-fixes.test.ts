import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { BeforeAgentStartEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAutoAnalyze } from "./auto-analyze.js";
import { runImageAsk, type CompleteFn } from "./image-ask.js";
import { makeCtx, makeModel, makeSettingsSandbox } from "./test-helpers.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  vi.useRealTimers();
});

const reply = fauxAssistantMessage;

function imageContent(bytes: Buffer, mimeType: string) {
  return { type: "image" as const, data: bytes.toString("base64"), mimeType };
}

function autoEvent(images: ReturnType<typeof imageContent>[]): BeforeAgentStartEvent {
  return {
    type: "before_agent_start",
    prompt: "look",
    images,
    systemPrompt: "system",
    systemPromptOptions: { cwd: "/tmp" },
  };
}

function autoScenario() {
  const { cwd } = makeSettingsSandbox({ model: "vendor/qwen-plus", autoAnalyzeAttachments: true });
  const notifications: Array<{ message: string; type?: string }> = [];
  const ctx = {
    ...makeCtx({
      cwd,
      model: makeModel("vendor", "main", false),
      models: [makeModel("vendor", "qwen-plus")],
    }),
    hasUI: true,
    ui: {
      notify: (message: string, type?: string) => notifications.push({ message, type }),
    },
  } as unknown as ExtensionContext;
  return { cwd, ctx, notifications };
}

function askScenario() {
  const { cwd } = makeSettingsSandbox({ model: "vendor/qwen-plus" });
  writeFileSync(join(cwd, "shot.png"), PNG);
  writeFileSync(join(cwd, "shot2.png"), PNG);
  writeFileSync(join(cwd, "shot3.png"), PNG);
  writeFileSync(join(cwd, "shot4.png"), PNG);
  writeFileSync(join(cwd, "shot5.png"), PNG);
  const ctx = makeCtx({
    cwd,
    models: [makeModel("vendor", "qwen-plus")],
    auth: { ok: true, apiKey: "sk-test-abcdef123456" },
  });
  return { ctx };
}

describe("image_ask attachment budget (BYTE-6 A3)", () => {
  it("rejects more than four paths without calling the model", async () => {
    const { ctx } = askScenario();
    const complete = vi.fn() as unknown as CompleteFn;
    await expect(
      runImageAsk(
        { paths: ["shot.png", "shot2.png", "shot3.png", "shot4.png", "shot5.png"], question: "q" },
        ctx,
        undefined,
        complete,
      ),
    ).rejects.toThrow(/at most 4 images/);
    expect(vi.mocked(complete)).not.toHaveBeenCalled();
  });
});

describe("auto analysis MIME normalization (BYTE-6 A4)", () => {
  it("accepts image/jpg as a label for JPEG content", async () => {
    const { ctx, notifications } = autoScenario();
    // JPEG sniff (ff d8 ff) declared with the common non-standard label.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x02]);
    const complete = vi.fn().mockResolvedValue(reply("seen")) as unknown as CompleteFn;
    const result = await runAutoAnalyze(
      autoEvent([imageContent(jpeg, "image/jpg")]),
      ctx,
      complete,
    );
    expect(result?.message?.content).toContain("automatically analyzed");
    expect(notifications.some((n) => n.message.includes("does not match"))).toBe(false);
  });

  it("still rejects a real mismatch", async () => {
    const { ctx, notifications } = autoScenario();
    const complete = vi.fn() as unknown as CompleteFn;
    await runAutoAnalyze(autoEvent([imageContent(PNG, "image/gif")]), ctx, complete);
    expect(notifications.some((n) => n.message.includes("does not match"))).toBe(true);
    expect(vi.mocked(complete)).not.toHaveBeenCalled();
  });
});

describe("auto analysis cancel + deadline (BYTE-6 #19)", () => {
  it("returns nothing and does not inject a retry nudge when the caller cancelled", async () => {
    const { ctx } = autoScenario();
    const controller = new AbortController();
    (ctx as { signal?: AbortSignal }).signal = controller.signal;
    controller.abort();
    const complete = vi.fn() as unknown as CompleteFn;
    const result = await runAutoAnalyze(
      autoEvent([imageContent(PNG, "image/png")]),
      ctx,
      complete,
    );
    expect(result).toBeUndefined();
    expect(vi.mocked(complete)).not.toHaveBeenCalled();
  });

  it("enforces the 60s wall clock even when completeFn ignores the signal", async () => {
    vi.useFakeTimers();
    const { ctx, notifications } = autoScenario();
    const complete = vi.fn().mockImplementation(
      () => new Promise(() => {}), // never resolves, ignores the signal entirely
    ) as unknown as CompleteFn;
    const pending = runAutoAnalyze(autoEvent([imageContent(PNG, "image/png")]), ctx, complete);
    await vi.advanceTimersByTimeAsync(60_000 + 1);
    const result = await pending;
    expect(result?.message?.content).toContain("timed out after 60 seconds");
    expect(notifications.length).toBeGreaterThan(0);
  }, 10_000);
});
