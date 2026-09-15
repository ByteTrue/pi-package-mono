import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ExecFn } from "./env.js";
import { setAgentBrowserCliOverride } from "./cli.js";

beforeEach(() => setAgentBrowserCliOverride({ command: "agent-browser" }));
afterEach(() => setAgentBrowserCliOverride(undefined));
import {
  cleanStaleAgentBrowserState,
  closeAgentBrowserSession,
  closeAllAgentBrowserSessions,
  collectAgentBrowserSessions,
  describeSession,
  listAgentBrowserSessions,
  notifyLeftoverSessions,
  parseSessionInfo,
  parseSessionNames,
} from "./sessions.js";

const configPath = "/tmp/agent-browser-config.json";
const json = (value: unknown): { stdout: string; stderr: string; code: number } => ({
  stdout: JSON.stringify(value),
  stderr: "",
  code: 0,
});

describe("session JSON parsing", () => {
  it("reads current and forward-compatible session list shapes", () => {
    expect(parseSessionNames({ success: true, data: { sessions: ["pi-browser", "other"] } })).toEqual([
      "pi-browser",
      "other",
    ]);
    expect(parseSessionNames({ data: { sessions: [{ name: "one" }, {}, "one"] } })).toEqual(["one"]);
    expect(parseSessionNames(null)).toEqual([]);
  });

  it("reads useful runtime details", () => {
    expect(
      parseSessionInfo(
        {
          success: true,
          data: {
            active: true,
            session: "pi-browser",
            pid: 123,
            version: "0.37.1",
            runtime: { pageCount: 2, effectiveLaunch: { engine: "chrome" } },
          },
        },
        "fallback",
      ),
    ).toEqual({
      name: "pi-browser",
      active: true,
      pid: 123,
      pageCount: 2,
      engine: "chrome",
      version: "0.37.1",
    });
  });
});

describe("session management", () => {
  it("lists the managed namespace and collects per-session info", async () => {
    const exec: ExecFn = async (_command, args) => {
      if (args.includes("list")) return json({ success: true, data: { sessions: ["pi-browser"] } });
      return json({ success: true, data: { active: true, session: "pi-browser", pid: 42 } });
    };
    await expect(listAgentBrowserSessions(exec, configPath)).resolves.toEqual({
      ok: true,
      value: ["pi-browser"],
    });
    await expect(collectAgentBrowserSessions(exec, configPath)).resolves.toEqual({
      ok: true,
      value: [{ name: "pi-browser", active: true, pid: 42 }],
    });
  });

  it("uses the explicit managed config for close and stale cleanup", async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (_command, args) => {
      calls.push(args);
      return json({ success: true, data: {} });
    };
    expect((await closeAgentBrowserSession(exec, configPath, "one")).ok).toBe(true);
    expect((await closeAllAgentBrowserSessions(exec, configPath)).ok).toBe(true);
    expect((await cleanStaleAgentBrowserState(exec, configPath)).ok).toBe(true);
    expect(calls).toEqual([
      ["--config", configPath, "--session", "one", "close", "--json"],
      ["--config", configPath, "close", "--all", "--json"],
      ["--config", configPath, "doctor", "--offline", "--quick", "--json"],
    ]);
  });

  it("reports command, JSON and envelope failures", async () => {
    const commandFailure: ExecFn = async () => ({ stdout: "", stderr: "boom", code: 1 });
    await expect(listAgentBrowserSessions(commandFailure, configPath)).resolves.toEqual({
      ok: false,
      error: "boom",
    });
    const junk: ExecFn = async () => ({ stdout: "not-json", stderr: "", code: 0 });
    expect((await listAgentBrowserSessions(junk, configPath)).ok).toBe(false);
    const envelopeFailure: ExecFn = async () => json({ success: false, error: "bad config" });
    await expect(listAgentBrowserSessions(envelopeFailure, configPath)).resolves.toEqual({
      ok: false,
      error: "bad config",
    });
  });

  it("describes and warns about forgotten sessions", async () => {
    expect(describeSession({ name: "pi-browser", active: true, pid: 42, pageCount: 1 })).toBe(
      "pi-browser — running — 1 page(s) — pid 42",
    );
    const exec: ExecFn = async () => json({ success: true, data: { sessions: ["one", "two"] } });
    const notify = vi.fn();
    await notifyLeftoverSessions(exec, configPath, notify);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("2 agent-browser session(s)"), "warning");
  });

  it("stays quiet when there are no sessions or the CLI is unavailable", async () => {
    const notify = vi.fn();
    await notifyLeftoverSessions(
      async () => json({ success: true, data: { sessions: [] } }),
      configPath,
      notify,
    );
    await notifyLeftoverSessions(
      async () => {
        throw new Error("missing");
      },
      configPath,
      notify,
    );
    expect(notify).not.toHaveBeenCalled();
  });
});
