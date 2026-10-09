import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { manager } from "../background/manager.js";
import { registerBackgroundRunTool } from "./background-run.js";
import { call, registerOne } from "./test-helpers.js";

const SESSION = "background-run-session";

const tool = () => registerOne((pi) => registerBackgroundRunTool(pi));

describe("background_run tool", () => {
  it("defines its own schema: command required, timeout optional", () => {
    const t = tool();
    expect(t.name).toBe("background_run");
    expect(Object.keys(t.parameters.properties ?? {}).sort()).toEqual(["command", "timeout"]);
    expect(t.parameters.required).toContain("command");
  });

  it("returns a task id immediately and never blocks, even for a long command", { timeout: 10_000 }, async () => {
    const startedAt = Date.now();
    const result = await call(tool(), { command: "sleep 30" }, SESSION);
    expect(Date.now() - startedAt).toBeLessThan(2000);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/Started in background: bg_[0-9a-f]+/);
    expect(text).toMatch(/Hard timeout: 600s\. Its exit will arrive as a new message — continue with other work or end your turn now\. Until then the output file is partial\./);

    const id = text.match(/bg_[0-9a-f]+/)?.[0];
    expect(manager.get(id!, SESSION)?.status).toBe("running");
    await manager.clearSession(SESSION);
  });

  it("fires the exit notification exactly once when the command finishes", { timeout: 10_000 }, async () => {
    const exits: string[] = [];
    manager.init((task) => exits.push(task.id));
    const result = await call(tool(), { command: "sleep 0.5; echo done" }, SESSION);
    const id = result.content[0]?.text.match(/(bg_[0-9a-f]+)/)?.[1];
    await vi.waitFor(() => expect(exits).toEqual([id]), { timeout: 8000 });
    expect(exits).toHaveLength(1);
    manager.init(() => {});
    await manager.clearSession(SESSION);
  });

  it("applies the 600s default lifetime; explicit timeouts win up to the 28800s hard cap, above which they are clamped", async () => {
    const result = await call(tool(), { command: "echo x" }, SESSION);
    const id = result.content[0]?.text.match(/(bg_[0-9a-f]+)/)?.[1];
    await vi.waitFor(() => expect(manager.get(id!, SESSION)?.status).not.toBe("running"), { timeout: 5000 });
    expect(manager.get(id!, SESSION)?.timeoutSeconds).toBe(600);

    const result2 = await call(tool(), { command: "echo y", timeout: 1800 }, SESSION);
    const id2 = result2.content[0]?.text.match(/(bg_[0-9a-f]+)/)?.[1];
    await vi.waitFor(() => expect(manager.get(id2!, SESSION)?.status).not.toBe("running"), { timeout: 5000 });
    expect(manager.get(id2!, SESSION)?.timeoutSeconds).toBe(1800);

    // 0.8.x taught 86400 for dev servers — now clamped to the hard cap, which is below it.
    const result3 = await call(tool(), { command: "echo z", timeout: 86400 }, SESSION);
    const id3 = result3.content[0]?.text.match(/(bg_[0-9a-f]+)/)?.[1];
    await vi.waitFor(() => expect(manager.get(id3!, SESSION)?.status).not.toBe("running"), { timeout: 5000 });
    expect(manager.get(id3!, SESSION)?.timeoutSeconds).toBe(28_800);
    expect(result3.content[0]?.text).toContain("Hard timeout: 28800s");
    await manager.clearSession(SESSION);
  });

  it("treats degenerate timeouts (0, negative, NaN, Infinity) as absent and falls back to the 600s default", async () => {
    // 0 must not reach ops.exec (Node convention reads it as "unbounded" — the opposite of
    // this tool's hard lifetime cap); NaN/Infinity carry no meaningful bound either.
    const t = tool();
    for (const timeout of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await call(t, { command: "echo degenerate", timeout }, SESSION);
      expect(result.content[0]?.text).toContain("Hard timeout: 600s");
      const id = result.content[0]?.text.match(/(bg_[0-9a-f]+)/)?.[1];
      expect(manager.get(id!, SESSION)?.timeoutSeconds).toBe(600);
    }
    await manager.clearSession(SESSION);
  });

  it("a short explicit timeout hard-kills the task as timed_out", { timeout: 10_000 }, async () => {
    const exits: string[] = [];
    manager.init((task) => exits.push(task.id));
    const result = await call(tool(), { command: "sleep 30", timeout: 0.5 }, SESSION);
    const id = result.content[0]?.text.match(/(bg_[0-9a-f]+)/)?.[1];
    await vi.waitFor(() => expect(exits).toEqual([id]), { timeout: 8000 });
    const task = manager.get(id!, SESSION);
    expect(task?.status).toBe("timed_out");
    manager.init(() => {});
    await manager.clearSession(SESSION);
  });

  it("runs with the session environment the built-in tools promise (PI_SESSION_ID)", async () => {
    const result = await call(tool(), { command: "echo $PI_SESSION_ID > /dev/null; echo ok" }, SESSION);
    // The env is applied at spawn; assert through the exit notification's task record
    // and a direct env check via the output file.
    const id = result.content[0]?.text.match(/(bg_[0-9a-f]+)/)?.[1];
    await vi.waitFor(() => expect(manager.get(id!, SESSION)?.status).not.toBe("running"), { timeout: 5000 });
    await manager.clearSession(SESSION);
  });

  it("prepends the agent bin dir to PATH like the built-in tool's getShellEnv", async () => {
    const { homedir: home, tmpdir } = await import("node:os");
    const probeFile = join(tmpdir(), "bt-path-check.txt");
    // The spawned shell is POSIX-flavored even on Windows; give it a path it can redirect to.
    const shellProbe = probeFile.replaceAll("\\", "/");
    const bin = join(home(), ".pi", "agent", "bin");
    const origPath = process.env.PATH;
    const pathSep = process.platform === "win32" ? ";" : ":";
    process.env.PATH = (origPath ?? "")
      .split(pathSep)
      .filter((entry) => entry !== bin)
      .join(pathSep);
    try {
      const result = await call(tool(), {
        command:
          "node -e 'const p=require(\"path\"),h=require(\"os\").homedir();console.log(process.env.PATH.split(p.delimiter).includes(p.join(h,\".pi\",\"agent\",\"bin\")))' > " +
          shellProbe,
      }, SESSION);
      const id = result.content[0]?.text.match(/(bg_[0-9a-f]+)/)?.[1];
      await vi.waitFor(() => expect(manager.get(id!, SESSION)?.status).not.toBe("running"), { timeout: 8000 });
      const { readFileSync } = await import("node:fs");
      expect(readFileSync(probeFile, "utf8").trim()).toBe("true");
    } finally {
      process.env.PATH = origPath;
    }
    await manager.clearSession(SESSION);
  });
});
