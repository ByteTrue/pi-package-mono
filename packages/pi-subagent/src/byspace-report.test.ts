import { afterEach, describe, expect, it, vi } from "vitest";

import { buildByspaceReportRecord, ByspaceReporter } from "./byspace-report.js";
import type { SubagentTaskRecord } from "./index.js";

function makeTask(
  overrides: Partial<SubagentTaskRecord> = {},
): SubagentTaskRecord {
  return {
    id: "sub_abc123",
    parentSessionId: "parent-1",
    description: "review the diff",
    agent: "explore",
    status: "running",
    output: "",
    startedAt: 1000,
    controller: new AbortController(),
    notifyOnExit: false,
    ...overrides,
  };
}

function makeRun(sessionId: string, cwd: string) {
  return {
    id: "run-1",
    agent: "explore",
    prompt: "t",
    sessionId,
    cwd,
    status: "running",
    finalText: "",
    textTail: "",
    thinkingTail: "",
    stderrTail: "",
    tools: [],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      ctxTokens: 0,
      turns: 0,
    },
  };
}

describe("buildByspaceReportRecord", () => {
  it("carries the child session reference from the first run", () => {
    const task = makeTask({
      progress: {
        kind: "pi-subagent-progress",
        agent: "explore",
        runs: [makeRun("child-session", "/repo")],
      } as unknown as SubagentTaskRecord["progress"],
    });
    expect(
      buildByspaceReportRecord(task, (run) => `/logs/${run.sessionId}.jsonl`),
    ).toEqual({
      id: "sub_abc123",
      status: "running",
      sessionId: "child-session",
      cwd: "/repo",
      sessionFile: "/logs/child-session.jsonl",
    });
  });

  it("omits session fields before the child reports its session", () => {
    expect(buildByspaceReportRecord(makeTask())).toEqual({
      id: "sub_abc123",
      status: "running",
    });
  });
});

describe("ByspaceReporter", () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  );

  afterEach(() => {
    fetchMock.mockClear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function reporterWith(env: NodeJS.ProcessEnv) {
    vi.stubGlobal("fetch", fetchMock);
    return new ByspaceReporter(env);
  }

  it("is disabled without the BySpace env pair and never fetches", () => {
    const reporter = reporterWith({ BYSPACE_SUBAGENT_REPORT_URL: "http://x" });
    reporter.report({ id: "sub_1", status: "running" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the token-only envelope to the report URL", () => {
    const reporter = reporterWith({
      BYSPACE_SUBAGENT_REPORT_URL:
        "http://127.0.0.1:6778/api/pi-subagent-report",
      BYSPACE_SUBAGENT_REPORT_TOKEN: "tok",
    });
    reporter.report({ id: "sub_1", status: "failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://127.0.0.1:6778/api/pi-subagent-report");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      token: "tok",
      observations: [{ id: "sub_1", status: "failed" }],
    });
  });

  it("throttles same-status repeats but always sends status changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const reporter = reporterWith({
      BYSPACE_SUBAGENT_REPORT_URL: "http://x/report",
      BYSPACE_SUBAGENT_REPORT_TOKEN: "tok",
    });
    const record = { id: "sub_1", status: "running" } as const;
    reporter.report(record);
    vi.setSystemTime(200);
    reporter.report(record);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(400);
    reporter.report({ id: "sub_1", status: "succeeded" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(1200);
    reporter.report({ id: "sub_1", status: "succeeded" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("swallows fetch rejections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("down"))),
    );
    const reporter = new ByspaceReporter({
      BYSPACE_SUBAGENT_REPORT_URL: "http://x/report",
      BYSPACE_SUBAGENT_REPORT_TOKEN: "tok",
    });
    expect(() =>
      reporter.report({ id: "sub_1", status: "running" }),
    ).not.toThrow();
    await vi.waitFor(() => {}, 0);
  });
});
