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

describe("registerBashDefaultTimeout", () => {
  it("injects a 600s default timeout into bash calls that did not pass one", async () => {
    const handlers = harness();
    const call = event("bash", { command: "find /" });
    await handlers["tool_call"]?.(call, {});
    expect(call.input).toEqual({ command: "find /", timeout: 600 });
  });

  it("leaves an explicitly passed timeout untouched", async () => {
    const handlers = harness();
    const call = event("bash", { command: "npm test", timeout: 1800 });
    await handlers["tool_call"]?.(call, {});
    expect(call.input.timeout).toBe(1800);
  });

  it("covers the powershell tool (same schema, same hang risk on Windows)", async () => {
    const handlers = harness();
    const call = event("powershell", { command: "Get-ChildItem" });
    await handlers["tool_call"]?.(call, {});
    expect(call.input.timeout).toBe(600);
  });

  it("ignores non-shell tool calls", async () => {
    const handlers = harness();
    const call = event("read", { path: "/tmp/x" });
    await handlers["tool_call"]?.(call, {});
    expect(call.input).toEqual({ path: "/tmp/x" });
  });

  it("ignores background_run calls — background tasks are meant to run long", async () => {
    const handlers = harness();
    const call = event("background_run", { command: "npm run dev" });
    await handlers["tool_call"]?.(call, {});
    expect(call.input).toEqual({ command: "npm run dev" });
  });
});
