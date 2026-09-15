import { describe, it, expect } from "vitest";
import { guardMcpOutput, resolveMcpOutputGuardOptions, DEFAULT_MCP_OUTPUT_MAX_BYTES } from "./mcp-output-guard.js";
import { readFileSync, statSync, existsSync, rmSync } from "node:fs";
import type { ContentBlock } from "./types.js";

function textBlock(text: string): ContentBlock {
  return { type: "text", text };
}

describe("resolveMcpOutputGuardOptions", () => {
  it("defaults to Pi's bash-guard values (50 KiB / 2000 lines / 16 KiB details)", () => {
    const o = resolveMcpOutputGuardOptions(undefined);
    expect(o.enabled).toBe(true);
    expect(o.maxBytes).toBe(51200);
    expect(o.maxLines).toBe(2000);
    expect(o.detailsMaxBytes).toBe(16384);
  });

  it("honors the settings object form", () => {
    const o = resolveMcpOutputGuardOptions({ outputGuard: { maxBytes: 1000, maxLines: 50, detailsMaxBytes: 200 } });
    expect(o.maxBytes).toBe(1000);
    expect(o.maxLines).toBe(50);
    expect(o.detailsMaxBytes).toBe(200);
  });

  it("honors false and the env kill switch", () => {
    expect(resolveMcpOutputGuardOptions({ outputGuard: false }).enabled).toBe(false);
    process.env.MCP_OUTPUT_GUARD = "0";
    try {
      expect(resolveMcpOutputGuardOptions(undefined).enabled).toBe(false);
    } finally {
      delete process.env.MCP_OUTPUT_GUARD;
    }
  });
});

describe("guardMcpOutput (ported upstream behavior)", () => {
  it("passes small text through unchanged", async () => {
    const r = await guardMcpOutput([textBlock("hello")]);
    expect(r.outputGuard).toBeUndefined();
    expect(r.content).toEqual([textBlock("hello")]);
  });

  it("passes image blocks through untouched even when large", async () => {
    const image = { type: "image", data: "A".repeat(200 * 1024), mimeType: "image/png" } as ContentBlock;
    const r = await guardMcpOutput([image]);
    expect(r.content[0]).toEqual(image);
  });

  it("truncates oversized text, spills to a 0600 file, and reports guard details", async () => {
    const huge = "x".repeat(DEFAULT_MCP_OUTPUT_MAX_BYTES + 1024);
    const r = await guardMcpOutput([textBlock(huge)]);
    expect(r.outputGuard?.truncated).toBe(true);
    expect(r.outputGuard?.fullOutputPath).toBeDefined();
    const path = r.outputGuard!.fullOutputPath!;
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf-8").length).toBe(DEFAULT_MCP_OUTPUT_MAX_BYTES + 1024);
    const inline = r.content.find((b) => b.type === "text") as { text: string };
    expect(inline.text).toContain("[MCP text output truncated:");
    expect(inline.text).toContain("Full text saved to:");
    rmSync(path);
  });

  it("truncates on the line cap even under the byte cap", async () => {
    const manyLines = Array.from({ length: 2001 }, (_, i) => `line ${i}`).join("\n");
    const r = await guardMcpOutput([textBlock(manyLines)]);
    expect(r.outputGuard?.truncated).toBe(true);
    rmSync(r.outputGuard!.fullOutputPath!);
  });

  it("keeps small raw MCP results in details.mcpResult and summarizes large ones", async () => {
    const small = await guardMcpOutput([textBlock("ok")], { rawMcpResult: { content: [], isError: false } });
    expect(small.mcpResult).toEqual({ content: [], isError: false });

    const bigPayload = { content: [{ type: "text", text: "y".repeat(64 * 1024) }] };
    const big = await guardMcpOutput([textBlock("ok")], { rawMcpResult: bigPayload });
    const summarized = big.mcpResult as { omitted: boolean; rawResultBytes: number; fullResultPath?: string };
    expect(summarized.omitted).toBe(true);
    expect(summarized.rawResultBytes).toBeGreaterThan(16384);
    expect(summarized.fullResultPath).toBeDefined();
    if (summarized.fullResultPath) rmSync(summarized.fullResultPath);
  });

  it("returns raw content untouched when disabled", async () => {
    const huge = "x".repeat(DEFAULT_MCP_OUTPUT_MAX_BYTES + 1024);
    const r = await guardMcpOutput([textBlock(huge)], { enabled: false });
    expect(r.outputGuard).toBeUndefined();
    expect((r.content[0] as { text: string }).text.length).toBe(DEFAULT_MCP_OUTPUT_MAX_BYTES + 1024);
  });

  it("falls back to empty-text placeholder for empty content", async () => {
    const r = await guardMcpOutput([], { emptyTextFallback: "(no output)" });
    expect((r.content[0] as { text: string }).text).toBe("(no output)");
  });
});
