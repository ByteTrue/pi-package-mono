import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { manager } from "../background/manager.js";
import { registerShellOverride } from "./shell-override.js";
import { call, registerOne } from "./test-helpers.js";

const SESSION = "shell-override-session";

const bashTool = () => registerOne((pi) => registerShellOverride(pi));

describe("shell override (bash)", () => {
  it("composes the schema from the built-in definition plus waitSeconds", () => {
    const tool = bashTool();
    expect(tool.name).toBe("bash");
    expect(Object.keys(tool.parameters.properties ?? {}).sort()).toEqual(["command", "timeout", "waitSeconds"]);
  });

  it("without waitSeconds it is pure delegation: output and error shapes match the built-in bash tool", async () => {
    const tool = bashTool();
    const ok = await call(tool, { command: "echo delegation-ok" }, SESSION);
    expect(ok.content[0]?.text.trim()).toBe("delegation-ok");
    // Delegation never touches the background manager: no task may exist afterwards.
    expect(manager.list(SESSION)).toHaveLength(0);

    await expect(call(tool, { command: "exit 3" }, SESSION)).rejects.toThrow("Command exited with code 3");

    await expect(
      call(tool, { command: "sleep 5", timeout: 0.5 }, SESSION),
    ).rejects.toThrow("Command timed out after 0.5 seconds");
  });

  it("waitSeconds=0 starts in the background and returns a task id immediately", async () => {
    const tool = bashTool();
    const startedAt = Date.now();
    const result = await call(tool, { command: "sleep 3", waitSeconds: 0 }, SESSION);
    expect(Date.now() - startedAt).toBeLessThan(2000);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/Started in the background\./);
    expect(text).toMatch(/Task id: bg_[0-9a-f]+/);

    const id = text.match(/Task id: (bg_[0-9a-f]+)/)?.[1];
    expect(id).toBeTruthy();
    expect(manager.get(id!, SESSION)?.status).toBe("running");
    await manager.clearSession(SESSION);
  });

  it("waitSeconds returns the output inline when the command exits in time, leaving no running task behind", async () => {
    const tool = bashTool();
    const result = await call(tool, { command: "echo fast-path", waitSeconds: 5 }, SESSION);
    expect(result.content[0]?.text.trim()).toBe("fast-path");
    // The settled task stays registered until session cleanup (it owns the output file),
    // but it must not surface as a running background task anywhere.
    expect(manager.list(SESSION).filter((task) => task.status === "running")).toHaveLength(0);
    await manager.clearSession(SESSION);
  });

  it("inline results keep the built-in error shape for non-zero exits", async () => {
    const tool = bashTool();
    await expect(call(tool, { command: "echo boom >&2; exit 7", waitSeconds: 5 }, SESSION)).rejects.toThrow(
      "Command exited with code 7",
    );
    expect(manager.list(SESSION).filter((task) => task.status === "running")).toHaveLength(0);
    await manager.clearSession(SESSION);
  });

  it("demotes a still-running command after waitSeconds and reports the task id", async () => {
    const tool = bashTool();
    const result = await call(tool, { command: "sleep 5", waitSeconds: 0.4 }, SESSION);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/Still running after 0.4s; moved to the background/);

    const id = text.match(/Task id: (bg_[0-9a-f]+)/)?.[1];
    expect(manager.get(id!, SESSION)?.status).toBe("running");
    await manager.clearSession(SESSION);
  });

  it("timeout is the hard lifetime cap: a demoted task is killed and reported as timed_out", async () => {
    const tool = bashTool();
    const result = await call(
      tool,
      { command: "node -e \"setInterval(() => {}, 500)\"", waitSeconds: 0.3, timeout: 1.5 },
      SESSION,
    );
    const id = result.content[0]?.text.match(/Task id: (bg_[0-9a-f]+)/)?.[1];
    expect(id).toBeTruthy();

    const exited = await vi.waitFor(
      () => {
        const task = manager.get(id!, SESSION);
        expect(task?.status).toBe("timed_out");
        return task;
      },
      { timeout: 8000 },
    );
    expect(exited?.timeoutSeconds).toBe(1.5);
    await manager.clearSession(SESSION);
  });

  it("aborting the wait kills the task and surfaces Command aborted with partial output", { timeout: 10_000 }, async () => {
    const tool = bashTool();
    const controller = new AbortController();
    const pending = call(tool, { command: "echo pre-abort; sleep 30", waitSeconds: 20 }, SESSION, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 800));
    controller.abort();

    await expect(pending).rejects.toThrow(/Command aborted/);
    // Killed before demotion: no running task, no exit notification later.
    await vi.waitFor(() => {
      const running = manager.list(SESSION).filter((task) => task.status === "running");
      expect(running).toHaveLength(0);
    }, { timeout: 8000 });
    await manager.clearSession(SESSION);
  });

  it("inline truncation mirrors the built-in footer: tail kept, full output path reported", async () => {
    const tool = bashTool();
    // ~2100 lines exceeds the 2000-line default tail limit.
    const result = await call(
      tool,
      { command: "for i in $(seq 1 2100); do echo line-$i; done", waitSeconds: 10 },
      SESSION,
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("line-2100");
    expect(text).not.toContain("line-1\n");
    expect(text).toMatch(/Showing lines \d+-2100 of 2100\. Full output: .+/);
    await manager.clearSession(SESSION);
  });

  it("the demoted task's output file is the same file the inline path would have read", { timeout: 10_000 }, async () => {
    const tool = bashTool();
    const result = await call(tool, { command: "sleep 2; echo late", waitSeconds: 0.3 }, SESSION);
    const text = result.content[0]?.text ?? "";
    const path = text.match(/Output file: (\S+)/)?.[1];
    expect(path).toBeTruthy();
    await vi.waitFor(() => expect(readFileSync(path!, "utf8")).toContain("late"), { timeout: 8000 });
    await manager.clearSession(SESSION);
  });

  it("an inline result must not also fire the exit notification (no duplicate wake-up)", async () => {
    const exits: string[] = [];
    manager.init((task) => exits.push(task.id));
    const tool = bashTool();

    await call(tool, { command: "echo inline-notify", waitSeconds: 5 }, SESSION);

    expect(exits).toEqual([]);
    manager.init(() => {});
    await manager.clearSession(SESSION);
  });

  it("a demoted task fires the exit notification exactly once", { timeout: 10_000 }, async () => {
    const exits: string[] = [];
    manager.init((task) => exits.push(task.id));
    const tool = bashTool();

    const result = await call(tool, { command: "sleep 1; echo demoted-notify", waitSeconds: 0.3 }, SESSION);
    const id = result.content[0]?.text.match(/Task id: (bg_[0-9a-f]+)/)?.[1];
    await vi.waitFor(() => expect(exits).toEqual([id]), { timeout: 8000 });

    expect(exits).toHaveLength(1);
    manager.init(() => {});
    await manager.clearSession(SESSION);
  });

  it("waitSeconds path sees the session environment the tool's guidelines promise (PI_SESSION_ID)", async () => {
    const tool = bashTool();
    const result = await call(tool, { command: "echo $PI_SESSION_ID", waitSeconds: 5 }, SESSION);
    expect(result.content[0]?.text.trim()).toBe(SESSION);
    await manager.clearSession(SESSION);
  });
});
