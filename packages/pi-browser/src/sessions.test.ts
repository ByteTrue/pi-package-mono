import { describe, expect, it, vi } from "vitest";
import type { ExecFn } from "./env.js";
import {
  closeCliSession,
  collectSessionViews,
  killAllCliSessions,
  closeCliSessions,
  describeSession,
  listCliSessions,
  notifyLeftoverSessions,
  parseSessionList,
} from "./sessions.js";

const payload = {
  browsers: [
    { name: "default", workspace: "abc", status: "open", browserType: "msedge", userDataDir: "/tmp/profile", headed: false, attached: false },
    { name: "handoff", status: "open", browserType: "chrome", attached: true },
  ],
};

describe("parseSessionList", () => {
  it("reads playwright-cli list --json output", () => {
    expect(parseSessionList(payload)).toEqual([
      { name: "default", status: "open", browserType: "msedge", userDataDir: "/tmp/profile", headed: false, attached: false, workspace: "abc" },
      { name: "handoff", status: "open", browserType: "chrome", attached: true },
    ]);
  });

  it("tolerates junk", () => {
    expect(parseSessionList(null)).toEqual([]);
    expect(parseSessionList({ browsers: [{}, { name: "" }, 42] })).toEqual([]);
  });
});

describe("describeSession", () => {
  it("summarises a session", () => {
    expect(describeSession({ name: "default", status: "open", browserType: "msedge", attached: false })).toBe("default — open — msedge");
    expect(describeSession({ name: "x", status: "open", browserType: "msedge", attached: true, headed: true })).toBe("x — open — msedge (attached) — headed");
  });
});

describe("session listing and closing", () => {
  it("parses a successful list", async () => {
    const exec: ExecFn = async () => ({ stdout: JSON.stringify(payload), stderr: "", code: 0 });
    const result = await listCliSessions(exec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessions).toHaveLength(2);
  });

  it("reports failures instead of throwing", async () => {
    const failing: ExecFn = async () => ({ stdout: "", stderr: "boom", code: 1 });
    expect(await listCliSessions(failing)).toEqual({ ok: false, error: "boom" });
    const junk: ExecFn = async () => ({ stdout: "not json", stderr: "", code: 0 });
    const parsed = await listCliSessions(junk);
    expect(parsed.ok).toBe(false);
  });

  it("detaches attached sessions and closes launched ones", async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (_command, args) => {
      calls.push(args);
      return { stdout: "done", stderr: "", code: 0 };
    };
    await closeCliSession(exec, { name: "a", status: "open" });
    await closeCliSession(exec, { name: "b", status: "open", attached: true });
    await closeCliSessions(exec);
    expect(calls).toEqual([["-s=a", "close"], ["-s=b", "detach"], ["close-all"]]);
  });
});

describe("collectSessionViews / kill all", () => {
  it("marks sessions from other workspaces", async () => {
    const exec: ExecFn = async (_command, args) => {
      const payload = args.includes("--all")
        ? {
            browsers: [
              { name: "mine", status: "open", workspace: "w1" },
              { name: "theirs", status: "open", workspace: "w2" },
            ],
          }
        : { browsers: [{ name: "mine", status: "open", workspace: "w1" }] };
      return { stdout: JSON.stringify(payload), stderr: "", code: 0 };
    };
    const result = await collectSessionViews(exec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.views.map((view) => [view.name, view.local])).toEqual([
      ["mine", true],
      ["theirs", false],
    ]);
  });

  it("force-kills every session", async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (_command, args) => {
      calls.push(args);
      return { stdout: "killed", stderr: "", code: 0 };
    };
    const result = await killAllCliSessions(exec);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([["kill-all"]]);
  });
});

describe("notifyLeftoverSessions", () => {
  it("warns about sessions it finds", async () => {
    const exec: ExecFn = async () => ({ stdout: JSON.stringify(payload), stderr: "", code: 0 });
    const notify = vi.fn();
    await notifyLeftoverSessions(exec, notify);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("2 playwright-cli session(s)"), "warning");
  });

  it("stays quiet when there is nothing to report", async () => {
    const empty: ExecFn = async () => ({ stdout: JSON.stringify({ browsers: [] }), stderr: "", code: 0 });
    const notify = vi.fn();
    await notifyLeftoverSessions(empty, notify);
    const failing: ExecFn = async () => {
      throw new Error("no cli");
    };
    await notifyLeftoverSessions(failing, notify);
    expect(notify).not.toHaveBeenCalled();
  });
});
