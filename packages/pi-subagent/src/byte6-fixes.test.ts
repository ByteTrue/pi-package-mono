import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildPiArgs,
  normalizeTask,
  SubagentTaskManager,
  type SubagentInput,
} from "./index.js";

// The fake pi CLI logs its argv and exits with a chosen code after a delay, so
// a real child process exercises the abort-vs-close race (BYTE-6 #17).
function makeFakePi(dir: string, exitCode: number, delayMs: number): string {
  const log = join(dir, "fake-pi-log.json");
  const body =
    'const fs = require("node:fs");\n' +
    'const log = ' + JSON.stringify(log) + ';\n' +
    'const args = process.argv.slice(2);\n' +
    "fs.existsSync(log) || fs.writeFileSync(log, '[]');\n" +
    "const entries = JSON.parse(fs.readFileSync(log, 'utf8'));\n" +
    'entries.push({ args, pid: process.pid });\n' +
    'fs.writeFileSync(log, JSON.stringify(entries));\n' +
    'setTimeout(() => process.exit(' + exitCode + '), ' + delayMs + ');\n';
  const file = join(dir, "fake-pi.cjs");
  writeFileSync(file, body);
  return log;
}

describe("stop vs close race (BYTE-6 #17)", () => {
  it("a stopped task whose child exits non-zero is not reported as failed with child stderr as the result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagent-stop-"));
    const prevCliJs = process.env.PI_CLI_JS;
    const prevChild = process.env.PI_SUBAGENT_CHILD;
    delete process.env.PI_SUBAGENT_CHILD;
    try {
      // Child ignores nothing, just runs long; the stop kill lands mid-run and
      // the process exits non-zero (taskkill /F → 1, SIGTERM default → 143).
      const log = makeFakePi(dir, 3, 60_000);
      process.env.PI_CLI_JS = join(dir, "fake-pi.cjs");

      const { runSubagent } = await import("./index.js");
      const controller = new AbortController();
      const run = runSubagent(dir, { task: "long work" } as SubagentInput, controller.signal);
      // Give the child time to start, then stop it.
      await new Promise((resolve) => setTimeout(resolve, 900));
      controller.abort();
      const result = await run;

      const entries = JSON.parse(readFileSync(log, "utf8")) as Array<{ args: string[] }>;
      expect(entries.length).toBe(1);
      // Whatever the exit code was, the run must read as cancelled — not as a
      // plain failure carrying the child's dying stderr.
      expect(result.failed ? result.output : result.output).toMatch(/cancelled/i);
    } finally {
      if (prevCliJs === undefined) delete process.env.PI_CLI_JS;
      else process.env.PI_CLI_JS = prevCliJs;
      if (prevChild !== undefined) process.env.PI_SUBAGENT_CHILD = prevChild;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("manager-level stop is not overwritten by a later complete", () => {
    const mgr = new SubagentTaskManager();
    mgr.init(() => {}, () => {});
    const controller = new AbortController();
    mgr.register({
      id: "s1",
      parentSessionId: "s",
      description: "d",
      status: "running",
      output: "",
      startedAt: Date.now(),
      controller,
      notifyOnExit: false,
    });
    expect(mgr.stop("s1")).toBe(true);
    expect(mgr.get("s1")?.status).toBe("cancelled");
    // The run then settles through complete() with the cancelled flag; the
    // record must stay cancelled regardless of the failed flag it carries.
    mgr.complete("s1", "child exited with code 3", true, true);
    expect(mgr.get("s1")?.status).toBe("cancelled");
  });
});

describe("session_shutdown reload keeps notifications (BYTE-6 #17)", () => {
  it("flushes pending exit notifications and stops the ticker on /reload", async () => {
    const sent: Array<{ customType?: string }> = [];
    const handlers = new Map<string, (event?: unknown, ctx?: unknown) => unknown>();
    const mod = await import("./index.js");
    const subagentExtension = mod.default;
    const subagentManager = mod.subagentManager;
    const prevChild = process.env.PI_SUBAGENT_CHILD;
    delete process.env.PI_SUBAGENT_CHILD;
    try {
      subagentExtension({
        sendMessage: (msg: { customType?: string }) => {
          sent.push(msg);
        },
        on: (event: string, handler: (event?: unknown, ctx?: unknown) => unknown) => {
          handlers.set(event, handler);
        },
      } as Parameters<typeof subagentExtension>[0]);
    } finally {
      if (prevChild !== undefined) process.env.PI_SUBAGENT_CHILD = prevChild;
    }
    handlers.get("session_start")?.({}, { sessionManager: { getSessionId: () => "s-reload" } });
    handlers.get("agent_start")?.();

    const record: import("./index.js").SubagentTaskRecord = {
      id: "sub_reload_1",
      parentSessionId: "s-reload",
      description: "d",
      status: "running",
      output: "",
      startedAt: Date.now(),
      controller: new AbortController(),
      notifyOnExit: true,
      done: Promise.resolve(),
    };
    subagentManager.register(record);
    // Completing while the agent is busy parks the notification in pendingExits.
    subagentManager.complete("sub_reload_1", "done work", false);
    expect(sent).toHaveLength(0);

    // /reload used to return early here, losing the notification.
    await handlers.get("session_shutdown")?.({ reason: "reload" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.customType).toBe("subagent-exit");
  });
});

describe("resume/id validation (BYTE-6 #18)", () => {
  it("rejects resume values that are not session-id shaped", () => {
    expect(() => normalizeTask({ task: "x", resume: "bad id with spaces" } as SubagentInput)).toThrow(/resume/i);
    expect(() => normalizeTask({ task: "x", resume: "a".repeat(200) } as SubagentInput)).toThrow(/resume/i);
    expect(() => normalizeTask({ task: "x", resume: "../../etc/passwd" } as SubagentInput)).toThrow(/resume/i);
  });

  it("rejects id values that are not session-id shaped", () => {
    expect(() => normalizeTask({ task: "x", id: "bad id" } as SubagentInput)).toThrow(/\bid\b/i);
    expect(() => normalizeTask({ task: "x", id: "x".repeat(200) } as SubagentInput)).toThrow(/\bid\b/i);
  });

  it("keeps accepting well-formed ids and resumes", () => {
    expect(
      normalizeTask({ task: "x", id: "abc12345-6789-4abc-9def-0123456789ab" } as SubagentInput).id,
    ).toBe("abc12345-6789-4abc-9def-0123456789ab");
    expect(normalizeTask({ task: "x", resume: "abc12345" } as SubagentInput).resume).toBe("abc12345");
  });

  it("never forwards a malformed resume into pi argv", () => {
    expect(() => {
      buildPiArgs({ resumeSession: "bad;rm -rf /" } as Parameters<typeof buildPiArgs>[0]);
    }).toThrow(/resume session/i);
  });
});
