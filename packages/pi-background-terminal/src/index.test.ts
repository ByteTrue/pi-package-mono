import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { manager } from "./background/manager.js";
import registerBackgroundTerminal from "./index.js";

type Handler = (event: unknown, ctx: unknown) => Promise<void>;

interface SentMessage {
  message: { customType?: string; content?: string; details?: unknown };
  options?: { deliverAs?: string; triggerTurn?: boolean };
}

function harness() {
  const toolNames: string[] = [];
  const commandNames: string[] = [];
  const events: string[] = [];
  const rendererTypes: string[] = [];
  const sent: SentMessage[] = [];
  const handlers: Record<string, Handler> = {};
  const pi = {
    registerTool(tool: { name: string }) {
      toolNames.push(tool.name);
    },
    registerCommand(name: string) {
      commandNames.push(name);
    },
    registerMessageRenderer(type: string) {
      rendererTypes.push(type);
    },
    sendMessage(message: SentMessage["message"], options?: SentMessage["options"]) {
      sent.push({ message, options });
    },
    on(event: string, handler: Handler) {
      events.push(event);
      handlers[event] = handler;
    },
  } as unknown as ExtensionAPI;

  registerBackgroundTerminal(pi);
  return { toolNames, commandNames, events, rendererTypes, sent, handlers };
}

const ctxFor = (sessionId: string, setStatus = vi.fn()) => ({
  sessionManager: { getSessionId: () => sessionId },
  ui: { setStatus },
});

describe("pi-background-terminal extension", () => {
  it("registers the three background tools and the /background command without touching native tools", () => {
    const { toolNames, commandNames, events, rendererTypes } = harness();
    expect(toolNames.sort()).toEqual(["background_kill", "background_run", "background_status"]);
    expect(commandNames).toEqual(["background"]);
    expect(events.sort()).toEqual(["session_shutdown", "session_start"]);
    // No renderer: Pi's default custom-message rendering already labels and boxes the content.
    expect(rendererTypes).toEqual([]);
    expect(toolNames).not.toContain("bash");
  });

  it("wakes the agent on completion with followUp + triggerTurn, which is what replaces polling", async () => {
    const { sent, handlers } = harness();
    const sessionId = "notify-session";
    await handlers.session_start?.({ type: "session_start", reason: "startup" }, ctxFor(sessionId));

    manager.start('node -e "console.log(\'notify-payload\')"', process.cwd(), sessionId);
    await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 8000 });

    expect(sent[0]?.options).toEqual({ deliverAs: "followUp", triggerTurn: true });
    expect(sent[0]?.message.customType).toBe("background-exit");
    expect(sent[0]?.message.content).toContain("exited with code 0");
    expect(sent[0]?.message.content).toContain("notify-payload");

    await manager.clearSession(sessionId);
  });

  it("does not deliver another session's completion into this session", async () => {
    const { sent, handlers } = harness();
    await handlers.session_start?.({ type: "session_start", reason: "startup" }, ctxFor("mine"));

    const foreign = manager.start('node -e "console.log(\'other\')"', process.cwd(), "someone-else");
    // Wait for it to genuinely finish, so "nothing was sent" means filtered, not merely not-yet-done.
    await vi.waitFor(() => expect(manager.get(foreign.id, "someone-else")?.status).toBe("exited"), { timeout: 8000 });

    expect(sent).toEqual([]);
    await manager.clearSession("someone-else");
  });

  it("shows the running count in the footer and hides it again at zero", async () => {
    const { handlers } = harness();
    const sessionId = "status-session";
    const setStatus = vi.fn();
    const ctx = ctxFor(sessionId, setStatus);
    await handlers.session_start?.({ type: "session_start", reason: "startup" }, ctx);

    const first = manager.start('node -e "setInterval(() => {}, 1000)"', process.cwd(), sessionId);
    const second = manager.start('node -e "setInterval(() => {}, 1000)"', process.cwd(), sessionId);
    expect(setStatus).toHaveBeenLastCalledWith("background-terminal", "bg:2");

    manager.kill(first.id, sessionId);
    await vi.waitFor(() => expect(setStatus).toHaveBeenLastCalledWith("background-terminal", "bg:1"), { timeout: 8000 });

    manager.kill(second.id, sessionId);
    await vi.waitFor(() => expect(setStatus).toHaveBeenLastCalledWith("background-terminal", undefined), {
      timeout: 8000,
    });
    await manager.clearSession(sessionId);
  });

  it("survives /reload but clears tasks and their output files on a real session end", async () => {
    const { handlers } = harness();
    const sessionId = "reload-test-session";
    const ctx = ctxFor(sessionId);
    await handlers.session_start?.({ type: "session_start", reason: "startup" }, ctx);

    const task = manager.start('node -e "setInterval(() => {}, 1000)"', process.cwd(), sessionId);

    await handlers.session_shutdown?.({ type: "session_shutdown", reason: "reload" }, ctx);
    expect(manager.get(task.id, sessionId)?.status).toBe("running");
    expect(existsSync(task.outputPath)).toBe(true);

    await handlers.session_start?.({ type: "session_start", reason: "reload" }, ctx);
    await handlers.session_shutdown?.({ type: "session_shutdown", reason: "quit" }, ctx);

    expect(manager.get(task.id, sessionId)).toBeNull();
    await vi.waitFor(() => expect(existsSync(task.outputPath)).toBe(false), { timeout: 8000 });
  });
});
