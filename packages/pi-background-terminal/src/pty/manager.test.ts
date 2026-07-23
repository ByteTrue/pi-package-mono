import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PTYManager } from "./manager.js";

const EXIT_WAIT_MS = 8_000;
const TEST_SESSION_ID = "test-session";

describe("PTYManager", () => {
  const managers = new Set<PTYManager>();

  afterEach(() => {
    for (const manager of managers) manager.clearAllSessions(TEST_SESSION_ID);
    managers.clear();
  });

  it("spawns a process, captures output, and notifies on exit", async () => {
    const sendMessage = vi.fn();
    const manager = createManager(sendMessage);
    const session = manager.spawn({
      command: process.execPath,
      args: ["-e", 'console.log("hello from pty")'],
      description: "print hello",
      parentSessionId: TEST_SESSION_ID,
      notifyOnExit: true,
    });

    await waitFor(() => {
      const info = manager.get(session.id, TEST_SESSION_ID);
      return info?.status === "exited" || info?.status === "killed";
    });

    const output = manager.read(session.id, TEST_SESSION_ID, 0, 20);
    expect(output?.lines.join("\n")).toContain("hello from pty");
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("writes stdin to a running PTY session", async () => {
    const manager = createManager();
    const session = manager.spawn({
      command: process.execPath,
      args: [
        "-e",
        [
          'process.stdin.setEncoding("utf8")',
          'process.stdout.write("ready\\n")',
          'process.stdin.on("data", (chunk) => {',
          '  const text = String(chunk).trim()',
          '  if (text === "quit") process.exit(0)',
          '  else process.stdout.write(`echo:${text}\\n`)',
          '})',
          'setInterval(() => {}, 1000)',
        ].join(";"),
      ],
      description: "echo stdin",
      parentSessionId: TEST_SESSION_ID,
    });

    await waitFor(() => manager.read(session.id, TEST_SESSION_ID, 0, 20)?.lines.some((line) => line.includes("ready")) === true);
    expect(manager.write(session.id, TEST_SESSION_ID, "hello\n")).toBe(true);
    await waitFor(() => manager.read(session.id, TEST_SESSION_ID, 0, 50)?.lines.some((line) => line.includes("echo:hello")) === true);

    const output = manager.read(session.id, TEST_SESSION_ID, 0, 50);
    expect(output?.lines.join("\n")).toContain("echo:hello");

    expect(manager.write(session.id, TEST_SESSION_ID, "quit\n")).toBe(true);
    await waitFor(() => {
      const info = manager.get(session.id, TEST_SESSION_ID);
      return info?.status === "exited" || info?.status === "killed";
    });
  });

  it("kills a long-running process when timeoutSeconds elapses", async () => {
    const manager = createManager();
    const session = manager.spawn({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      description: "timeout test",
      parentSessionId: TEST_SESSION_ID,
      timeoutSeconds: 1,
    });

    await waitFor(() => manager.get(session.id, TEST_SESSION_ID)?.status === "killed", { timeoutMs: EXIT_WAIT_MS });

    const info = manager.get(session.id, TEST_SESSION_ID);
    expect(info?.timedOut).toBe(true);
  });

  function createManager(sendMessage = vi.fn()): PTYManager {
    const manager = new PTYManager();
    manager.init({ sendMessage } as unknown as ExtensionAPI);
    manager.setCurrentSessionId(TEST_SESSION_ID);
    managers.add(manager);
    return manager;
  }
});

async function waitFor(predicate: () => boolean, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? EXIT_WAIT_MS;
  const intervalMs = options.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for PTY condition");
}
