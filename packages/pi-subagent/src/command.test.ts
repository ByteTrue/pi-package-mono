import { describe, it, expect, vi } from "vitest";
import { pickModel, pickThinking } from "./command.js";
import { promptFuzzySelect } from "./tui-picker.js";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

describe("command and tui-picker unit tests", () => {
  it("promptFuzzySelect falls back to ctx.ui.select and handles selection/cancel", async () => {
    const mockCtx = {
      ui: {
        select: vi.fn().mockResolvedValue("Option A (desc A)"),
      },
    } as unknown as ExtensionCommandContext;

    const items = [
      { value: "opt_a", label: "Option A", description: "desc A" },
      { value: "opt_b", label: "Option B", description: "desc B" },
    ];

    const result = await promptFuzzySelect(mockCtx, "Test title", items);
    expect(result).toBe("opt_a");

    // Test cancel
    (mockCtx.ui.select as any).mockResolvedValue(undefined);
    const cancelResult = await promptFuzzySelect(mockCtx, "Test title", items);
    expect(cancelResult).toBeUndefined();
  });

  it("pickThinking returns selected thinking level or undefined on cancel", async () => {
    const mockCtx = {
      ui: {
        select: vi.fn().mockResolvedValue("high"),
      },
    } as unknown as ExtensionCommandContext;

    const res = await pickThinking(mockCtx);
    expect(res).toBe("high");

    // Test clear
    (mockCtx.ui.select as any).mockResolvedValue("Clear thinking override (inherit default thinking level)");
    const clearRes = await pickThinking(mockCtx, "high");
    expect(clearRes).toBeNull();

    // Test cancel (ESC)
    (mockCtx.ui.select as any).mockResolvedValue(undefined);
    const cancelRes = await pickThinking(mockCtx);
    expect(cancelRes).toBeUndefined();
  });

  it("pickModel returns selected model or undefined on cancel", async () => {
    const mockCtx = {
      modelRegistry: {
        getAvailable: vi.fn().mockReturnValue([
          { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
          { provider: "anthropic", id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet" },
        ]),
      },
      ui: {
        select: vi.fn().mockResolvedValue("openai/gpt-4o (GPT-4o)"),
      },
    } as unknown as ExtensionCommandContext;

    const res = await pickModel(mockCtx);
    expect(res).toBe("openai/gpt-4o");

    // Test cancel (ESC)
    (mockCtx.ui.select as any).mockResolvedValue(undefined);
    const cancelRes = await pickModel(mockCtx);
    expect(cancelRes).toBeUndefined();
  });
});
