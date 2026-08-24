import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundManager, manager as globalManager, type BackgroundTask } from "./manager.js";

// Passes through to the real implementation; only makes createWriteStream observable so the
// output-stream error listener can be exercised. Transparent to every other test here.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    createWriteStream: vi.fn((...args: Parameters<typeof actual.createWriteStream>) => actual.createWriteStream(...args)),
  };
});
import * as fs from "node:fs";

const SESSION_A = "session-a";
const SESSION_B = "session-b";
const FOREVER = 'node -e "setInterval(() => {}, 1000)"';

describe("BackgroundManager", () => {
  const managers: BackgroundManager[] = [];

  afterEach(async () => {
    // The process-global manager is included: the /reload test uses it, and a failing test must
    // not leave a real child process running.
    for (const manager of [...managers, globalManager]) {
      await manager.clearSession(SESSION_A);
      await manager.clearSession(SESSION_B);
    }
    managers.length = 0;
  });

  function createManager(): BackgroundManager {
    const manager = new BackgroundManager();
    manager.init(() => {});
    managers.push(manager);
    return manager;
  }

  it("runs a command in the background, streams output to a real file, and resolves exit status", async () => {
    const manager = createManager();
    const exits: Array<{ id: string; status: string }> = [];
    manager.init((task) => exits.push({ id: task.id, status: task.status }));

    const started = manager.start('node -e "console.log(\'hello from background\')"', process.cwd(), SESSION_A);
    expect(started.status).toBe("running");
    expect(started.exitCode).toBeNull();

    await vi.waitFor(() => expect(manager.get(started.id, SESSION_A)?.status).toBe("exited"), { timeout: 8000 });

    const finished = manager.get(started.id, SESSION_A);
    expect(finished?.exitCode).toBe(0);
    expect(finished?.tail).toContain("hello from background");
    expect(finished?.lineCount).toBe(1);
    expect(exits).toEqual([{ id: started.id, status: "exited" }]);

    // The output is genuinely on disk, not just in the in-memory tail preview.
    expect(readFileSync(finished!.outputPath, "utf8")).toContain("hello from background");
  });

  it("marks a command that never ran as failed, not as exited with a null code", async () => {
    const manager = createManager();
    const started = manager.start("echo hi", "/definitely/not/a/real/directory", SESSION_A);

    await vi.waitFor(() => expect(manager.get(started.id, SESSION_A)?.status).toBe("failed"), { timeout: 8000 });
    const failed = manager.get(started.id, SESSION_A);
    expect(failed?.exitCode).toBeNull();
    expect(failed?.error).toBeTruthy();
  });

  it("scopes get/list to the owning session", () => {
    const manager = createManager();
    const started = manager.start(FOREVER, process.cwd(), SESSION_A);

    expect(manager.get(started.id, SESSION_B)).toBeNull();
    expect(manager.list(SESSION_B)).toEqual([]);
    expect(manager.list(SESSION_A).map((task) => task.id)).toEqual([started.id]);
    expect(manager.kill(started.id, SESSION_B)).toBe(false);
  });
  it("kill() stops a running task and marks it killed without notifying, and is a no-op afterwards", async () => {
    const manager = createManager();
    const exits: BackgroundTask[] = [];
    manager.init((task) => exits.push(task));
    const started = manager.start(FOREVER, process.cwd(), SESSION_A);

    expect(manager.kill(started.id, SESSION_A)).toBe(true);
    await vi.waitFor(() => expect(manager.get(started.id, SESSION_A)?.status).toBe("killed"), { timeout: 8000 });
    expect(exits).toEqual([]);
    expect(manager.kill(started.id, SESSION_A)).toBe(false);
  });

  it("clearSession aborts and removes only that session's tasks, and deletes their output files", async () => {
    const manager = createManager();
    const exits: BackgroundTask[] = [];
    manager.init((task) => exits.push(task));
    const a = manager.start(FOREVER, process.cwd(), SESSION_A);
    const b = manager.start(FOREVER, process.cwd(), SESSION_B);

    await manager.clearSession(SESSION_A);

    expect(exits).toEqual([]);
    expect(manager.get(a.id, SESSION_A)).toBeNull();
    expect(manager.get(b.id, SESSION_B)?.status).toBe("running");
    await vi.waitFor(() => expect(existsSync(a.outputPath)).toBe(false), { timeout: 8000 });
  });
  it.skipIf(process.platform === "win32")("waits for a command's process tree to die before clearing its session", async () => {
    const manager = createManager();
    const pidDir = mkdtempSync(join(tmpdir(), "pi-background-pid-"));
    const pidPath = join(pidDir, "pid");
    const command = `node -e "require('fs').writeFileSync('${pidPath}', String(process.pid)); setInterval(() => {}, 1000)"`;
    const started = manager.start(command, process.cwd(), SESSION_A);

    try {
      await vi.waitFor(() => expect(existsSync(pidPath)).toBe(true), { timeout: 8000 });
      const pid = Number(readFileSync(pidPath, "utf8"));
      expect(pid).toBeGreaterThan(0);

      await manager.clearSession(SESSION_A);
      expect(manager.get(started.id, SESSION_A)).toBeNull();
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 8000 });
    } finally {
      await manager.clearSession(SESSION_A);
      rmSync(pidDir, { recursive: true, force: true });
    }
  });

  it("does not leak internals into the task snapshot handed to callers", () => {
    const manager = createManager();
    const started = manager.start(FOREVER, process.cwd(), SESSION_A);

    expect(started).not.toHaveProperty("controller");
    expect(started).not.toHaveProperty("done");
    expect(started).not.toHaveProperty("decoder");
    // Snapshots are copies: mutating one must not reach into the manager's own state.
    (started as { status: string }).status = "tampered";
    expect(manager.get(started.id, SESSION_A)?.status).toBe("running");
  });

  it("records a write failure on the task instead of letting the stream error crash the process", async () => {
    const manager = createManager();
    const started = manager.start(FOREVER, process.cwd(), SESSION_A);

    const stream = vi.mocked(fs.createWriteStream).mock.results.at(-1)?.value as ReturnType<typeof fs.createWriteStream>;
    expect(stream.listenerCount("error")).toBeGreaterThan(0);

    // Would be an uncaught exception (killing all of Pi) if the listener were missing or a no-op.
    stream.emit("error", new Error("ENOSPC: simulated disk full"));

    await vi.waitFor(() => expect(manager.get(started.id, SESSION_A)?.error).toMatch(/simulated disk full/), {
      timeout: 8000,
    });
  });

  it("survives Pi's /reload, which re-evaluates this module and would otherwise orphan tasks", async () => {
    const first = await import("./manager.js");
    const task = first.manager.start(FOREVER, process.cwd(), SESSION_A);

    // Reproduces what Pi's loader does on /reload: re-import with the module cache disabled.
    vi.resetModules();
    const second = await import("./manager.js");

    expect(second.BackgroundManager).not.toBe(first.BackgroundManager); // proves a real re-evaluation
    expect(second.manager).toBe(first.manager); // ...yet the same manager, so tasks stay reachable
    expect(second.manager.get(task.id, SESSION_A)?.status).toBe("running");

    await second.manager.clearSession(SESSION_A);
  });
});
