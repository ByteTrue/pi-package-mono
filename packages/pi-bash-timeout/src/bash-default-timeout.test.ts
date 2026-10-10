import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { registerBashDefaultTimeout } from "./bash-default-timeout.js";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
type FakeToolCall = {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};
type FakeToolResult = {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  content: { type: "text"; text: string }[];
  details: unknown;
  isError: boolean;
  usage?: { inputTokens: number; outputTokens: number };
};

function harness() {
  const handlers: Record<string, Handler> = {};
  const pi = {
    on(event: string, handler: Handler) {
      handlers[event] = handler;
    },
  } as unknown as ExtensionAPI;
  registerBashDefaultTimeout(pi);
  return handlers;
}

const event = (toolName: string, input: Record<string, unknown>): FakeToolCall => ({
  type: "tool_call",
  toolCallId: "t1",
  toolName,
  input,
});

const result = (
  toolName: string,
  text: string,
  isError: boolean,
  details: unknown = undefined,
): FakeToolResult => ({
  type: "tool_result",
  toolCallId: "t1",
  toolName,
  input: { command: "x" },
  content: [{ type: "text", text }],
  details,
  isError,
});

describe("registerBashDefaultTimeout", () => {
  it("injects a 300s default timeout into bash calls that did not pass one", async () => {
    const handlers = harness();
    const call = event("bash", { command: "find /" });
    await handlers["tool_call"]?.(call, {});
    expect(call.input).toEqual({ command: "find /", timeout: 300 });
  });

  it("injects a 300s default timeout into powershell calls that did not pass one", async () => {
    const handlers = harness();
    const call = event("powershell", { command: "Get-ChildItem /" });
    await handlers["tool_call"]?.(call, {});
    expect(call.input).toEqual({ command: "Get-ChildItem /", timeout: 300 });
  });

  it("clamps an explicitly passed timeout above 300s down to 300 (foreground bash must not outlive the cap)", async () => {
    const handlers = harness();
    const call = event("bash", { command: "npm test", timeout: 1800 });
    await handlers["tool_call"]?.(call, {});
    expect(call.input.timeout).toBe(300);
  });

  it("respects an explicit timeout at or below 300s, including exactly the cap", async () => {
    const handlers = harness();
    const below = event("bash", { command: "npm run build", timeout: 120 });
    await handlers["tool_call"]?.(below, {});
    expect(below.input.timeout).toBe(120);
    // Boundary: the cap is inclusive — a value exactly at it is passed through unchanged
    // (documents the `<=` intent even though the clamp itself cannot be mutated to break it).
    const atCap = event("bash", { command: "npm run build", timeout: 300 });
    await handlers["tool_call"]?.(atCap, {});
    expect(atCap.input.timeout).toBe(300);
  });

  it("treats a zero timeout as absent and injects the 300s default", async () => {
    const handlers = harness();
    const call = event("bash", { command: "sleep 5", timeout: 0 });
    await handlers["tool_call"]?.(call, {});
    expect(call.input.timeout).toBe(300);
  });

  it("covers the powershell tool (same schema, same hang risk on Windows)", async () => {
    const handlers = harness();
    const call = event("powershell", { command: "Get-ChildItem" });
    await handlers["tool_call"]?.(call, {});
    expect(call.input.timeout).toBe(300);
  });

  it("ignores non-shell tool calls", async () => {
    const handlers = harness();
    const call = event("read", { path: "/tmp/x" });
    await handlers["tool_call"]?.(call, {});
    expect(call.input).toEqual({ path: "/tmp/x" });
  });

  it("ignores waitSeconds (not a real powershell parameter — the hook keys only on timeout)", async () => {
    const handlers = harness();
    const call = event("powershell", { command: "npm run dev", waitSeconds: 5 });
    await handlers["tool_call"]?.(call, {});
    expect(call.input).toEqual({ command: "npm run dev", timeout: 300, waitSeconds: 5 });
  });

  it("appends steering text to a bash timeout error and echoes all other fields", async () => {
    const handlers = harness();
    const res = result("bash", "Command timed out after 300 seconds", true, {
      truncation: { truncated: true, totalLines: 5000 },
      fullOutputPath: "/tmp/pi-bash-x.log",
    });
    const out = (await handlers["tool_result"]?.(res, {})) as {
      content: { type: string; text: string }[];
      details: unknown;
      isError: boolean;
    };
    expect(out.content).toHaveLength(2);
    expect(out.content[1]?.text).toContain("background_run");
    expect(out.content[0]?.text).toBe("Command timed out after 300 seconds");
    // agent-session REPLACES details/isError/usage from the hook result — dropping them
    // here would lose truncation info, so they must be echoed.
    expect(out.details).toEqual({ truncation: { truncated: true, totalLines: 5000 }, fullOutputPath: "/tmp/pi-bash-x.log" });
    expect(out.isError).toBe(true);
  });

  it("steers powershell timeout errors the same way", async () => {
    const handlers = harness();
    const res = result("powershell", "Command timed out after 300 seconds", true);
    const out = (await handlers["tool_result"]?.(res, {})) as { content: { text: string }[] };
    expect(out.content[1]?.text).toContain("hard-capped at 300s");
  });

  it("does not touch non-error results or non-timeout errors", async () => {
    const handlers = harness();
    const ok = result("bash", "done", false);
    expect(await handlers["tool_result"]?.(ok, {})).toBeUndefined();
    // Timeout-looking text in a NON-error result must not be steered: the isError
    // branch exists so a success result quoting a timeout is left alone.
    const okQuoting = result("bash", "previous attempt: Command timed out after 300 seconds", false);
    expect(await handlers["tool_result"]?.(okQuoting, {})).toBeUndefined();
    const other = result("bash", "Command exited with code 1", true);
    expect(await handlers["tool_result"]?.(other, {})).toBeUndefined();
  });

  it("does not touch timeout errors from other tools", async () => {
    const handlers = harness();
    const res = result("background_run", "Command timed out after 300 seconds", true);
    expect(await handlers["tool_result"]?.(res, {})).toBeUndefined();
  });
});
