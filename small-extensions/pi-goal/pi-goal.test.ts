import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import piGoalExtension, {
  CONTINUE_MESSAGE,
  GOAL_DONE_TOOL,
  GOAL_ENTRY,
  GOAL_START_TOOL,
  RESUME_MESSAGE,
  describeGoal,
  parseGoalCommand,
  readGoalRecord,
  settleDecision,
  statusText,
  type GoalRecord,
} from "./pi-goal.js";

type Handler = (event: any, ctx: any) => any;

function goal(overrides: Partial<GoalRecord> = {}): GoalRecord {
  return {
    objective: "Make the suite green",
    status: "active",
    runs: 0,
    updatedAt: 1,
    ...overrides,
  };
}

function harness(entries: any[] = []) {
  const handlers: Record<string, Handler> = {};
  const commands: Record<string, (args: string, ctx: any) => Promise<void>> = {};
  const tools: Record<string, any> = {};
  const sent: { text: string; options?: unknown }[] = [];
  const notices: { text: string; level?: string }[] = [];
  const setStatusCalls: (string | undefined)[] = [];
  let active = new Set<string>(["read", "bash"]);

  const pi = {
    on(event: string, handler: Handler) {
      handlers[event] = handler;
    },
    registerCommand(name: string, options: { handler: (args: string, ctx: any) => Promise<void> }) {
      commands[name] = options.handler;
    },
    registerTool(tool: any) {
      tools[tool.name] = tool;
    },
    appendEntry(customType: string, data?: unknown) {
      entries.push({ type: "custom", customType, data });
    },
    sendUserMessage(text: string, options?: unknown) {
      sent.push({ text, options });
    },
    getActiveTools() {
      return [...active];
    },
    setActiveTools(names: string[]) {
      active = new Set(names);
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getBranch: () => entries },
    ui: {
      notify(text: string, level?: string) {
        notices.push({ text, level });
      },
      setStatus(_key: string, text?: string) {
        setStatusCalls.push(text);
      },
    },
  } as unknown as ExtensionContext;

  piGoalExtension(pi);
  return {
    handlers,
    commands,
    tools,
    entries,
    sent,
    notices,
    setStatusCalls,
    ctx,
    activeTools: () => [...active],
  };
}

function command(h: ReturnType<typeof harness>, args: string) {
  return h.commands.goal!(args, h.ctx);
}

function settle(h: ReturnType<typeof harness>, event: Record<string, unknown> = {}) {
  return h.handlers.agent_before_settle!(
    {
      type: "agent_before_settle",
      outcome: "completed",
      entries: [],
      continue: false,
      context: {},
      ...event,
    },
    h.ctx,
  );
}

function runTurn(h: ReturnType<typeof harness>, usedTools: boolean) {
  h.handlers.agent_start!({ type: "agent_start" }, h.ctx);
  if (usedTools) h.handlers.tool_call!({ toolName: "bash" }, h.ctx);
}

/** Pi emits agent_start for each continuation run, exactly as for a user prompt. */
function continueRun(h: ReturnType<typeof harness>, usedTools: boolean) {
  runTurn(h, usedTools);
}

function lastGoalEntry(entries: any[]): GoalRecord | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.customType === GOAL_ENTRY) return (entry.data ?? null) as GoalRecord | null;
  }
  return null;
}

describe("parseGoalCommand", () => {
  it("treats bare and keyword forms as control commands", () => {
    expect(parseGoalCommand("")).toEqual({ kind: "status" });
    expect(parseGoalCommand("   ")).toEqual({ kind: "status" });
    expect(parseGoalCommand("status")).toEqual({ kind: "status" });
    expect(parseGoalCommand("Pause")).toEqual({ kind: "pause" });
    expect(parseGoalCommand("resume")).toEqual({ kind: "resume" });
    expect(parseGoalCommand("clear")).toEqual({ kind: "clear" });
  });

  it("keeps anything else as the objective, keywords included when embedded", () => {
    expect(parseGoalCommand("clear the legacy cache")).toEqual({
      kind: "start",
      objective: "clear the legacy cache",
    });
    expect(parseGoalCommand("Fix the flaky test")).toEqual({ kind: "start", objective: "Fix the flaky test" });
  });
});

describe("settleDecision", () => {
  const healthy = {
    outcome: "completed" as const,
    isContinuation: true,
    runUsedTools: true,
    hasQueuedInput: false,
  };

  it("continues only for an active goal on a healthy, working run", () => {
    expect(settleDecision(goal(), healthy)).toEqual({ action: "continue" });
  });

  it("holds when there is no goal or it is not active", () => {
    expect(settleDecision(null, healthy).action).toBe("hold");
    expect(settleDecision(goal({ status: "paused" }), healthy).action).toBe("hold");
    expect(settleDecision(goal({ status: "done" }), healthy).action).toBe("hold");
  });

  it("pauses instead of spinning when a continuation produced only text", () => {
    expect(settleDecision(goal(), { ...healthy, runUsedTools: false })).toEqual({
      action: "pause",
      reason: "the continuation called no tools",
    });
  });

  it("still continues after a user-started run that used no tools", () => {
    expect(settleDecision(goal(), { ...healthy, isContinuation: false, runUsedTools: false })).toEqual({
      action: "continue",
    });
  });

  it("pauses on interruption and provider failure", () => {
    expect(settleDecision(goal(), { ...healthy, outcome: "aborted" }).action).toBe("pause");
    expect(settleDecision(goal(), { ...healthy, outcome: "error" }).action).toBe("pause");
  });

  it("gets out of the way when user input is already queued", () => {
    expect(settleDecision(goal(), { ...healthy, hasQueuedInput: true })).toEqual({
      action: "hold",
      reason: "user input is already queued",
    });
  });
});

describe("readGoalRecord", () => {
  it("takes the last goal entry and lets a null entry clear it", () => {
    const entries: any[] = [
      { type: "custom", customType: GOAL_ENTRY, data: goal({ runs: 3 }) },
      { type: "message" },
      { type: "custom", customType: GOAL_ENTRY, data: goal({ runs: 7 }) },
    ];
    expect(readGoalRecord(entries)?.runs).toBe(7);

    entries.push({ type: "custom", customType: GOAL_ENTRY, data: null });
    expect(readGoalRecord(entries)).toBeNull();
  });

  it("ignores unrelated entries and malformed data", () => {
    expect(readGoalRecord([{ type: "custom", customType: "other", data: goal() }])).toBeNull();
    expect(readGoalRecord([{ type: "custom", customType: GOAL_ENTRY, data: { objective: "" } }])).toBeNull();
    expect(readGoalRecord([])).toBeNull();
  });
});

describe("goal command", () => {
  it("activates the goal, activates goal_done, and kicks off a turn", async () => {
    const h = harness();
    await command(h, "Fix the failing checkout test");

    expect(lastGoalEntry(h.entries)).toMatchObject({
      objective: "Fix the failing checkout test",
      status: "active",
      runs: 0,
    });
    expect(h.activeTools()).toContain(GOAL_DONE_TOOL);
    expect(h.sent).toEqual([{ text: "Fix the failing checkout test", options: undefined }]);
    expect(h.setStatusCalls.at(-1)).toBe("goal:active(0)");
  });

  it("queues the kickoff instead of throwing while the agent is streaming", async () => {
    const h = harness();
    (h.ctx as any).isIdle = () => false;
    await command(h, "Ship it");
    expect(h.sent).toEqual([{ text: "Ship it", options: { deliverAs: "followUp" } }]);
  });

  it("pauses, resumes, and clears", async () => {
    const h = harness();
    await command(h, "Do the thing");

    await command(h, "pause");
    expect(lastGoalEntry(h.entries)).toMatchObject({ status: "paused" });
    expect(h.activeTools()).not.toContain(GOAL_DONE_TOOL);
    expect(h.setStatusCalls.at(-1)).toBe("goal:paused");

    await command(h, "resume");
    expect(lastGoalEntry(h.entries)).toMatchObject({ status: "active" });
    expect(h.activeTools()).toContain(GOAL_DONE_TOOL);
    expect(h.sent.at(-1)).toEqual({ text: RESUME_MESSAGE, options: undefined });

    await command(h, "clear");
    expect(lastGoalEntry(h.entries)).toBeNull();
    expect(h.activeTools()).not.toContain(GOAL_DONE_TOOL);
    expect(h.setStatusCalls.at(-1)).toBeUndefined();
  });

  it("reports instead of failing when there is nothing to control", async () => {
    const h = harness();
    await command(h, "pause");
    await command(h, "resume");
    await command(h, "clear");
    expect(h.notices.every((notice) => notice.level === "warning")).toBe(true);
    await command(h, "status");
    expect(h.notices.at(-1)?.text).toContain("No goal in this session");
  });
});

describe("continuation loop", () => {
  it("appends one hidden continuation and asks Pi to continue", async () => {
    const h = harness();
    await command(h, "Migrate the auth flow");
    runTurn(h, true);

    const result = (await settle(h)) as { continue: boolean; entries: any[] };

    expect(result.continue).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      type: "custom_message",
      customType: GOAL_ENTRY,
      content: CONTINUE_MESSAGE,
      display: false,
    });
    expect(lastGoalEntry(h.entries)?.runs).toBe(1);
    expect(h.setStatusCalls.at(-1)).toBe("goal:active(1)");
  });

  it("keeps entries proposed by other boundary handlers", async () => {
    const h = harness();
    await command(h, "Do the thing");
    runTurn(h, true);
    const existing = { type: "custom", customType: "someone-else", data: {} };

    const result = (await settle(h, { entries: [existing] })) as { entries: any[] };

    expect(result.entries[0]).toBe(existing);
    expect(result.entries).toHaveLength(2);
  });

  it("pauses when a continuation does nothing but talk", async () => {
    const h = harness();
    await command(h, "Do the thing");
    runTurn(h, true);
    await settle(h);

    continueRun(h, false);
    const result = await settle(h);

    expect(result).toBeUndefined();
    expect(lastGoalEntry(h.entries)).toMatchObject({ status: "paused", runs: 1 });
    expect(h.notices.at(-1)?.text).toContain("the continuation called no tools");
    expect(h.activeTools()).not.toContain(GOAL_DONE_TOOL);
  });

  it("continues after the kickoff run even when it only answers in text", async () => {
    const h = harness();
    await command(h, "Explain the failing test");
    runTurn(h, false);

    expect(await settle(h)).toMatchObject({ continue: true });
    expect(lastGoalEntry(h.entries)).toMatchObject({ status: "active", runs: 1 });
  });

  it("pauses when the user interrupted the run", async () => {
    const h = harness();
    await command(h, "Do the thing");
    runTurn(h, true);

    await settle(h, { outcome: "aborted" });

    expect(lastGoalEntry(h.entries)).toMatchObject({ status: "paused" });
  });

  it("stays out of the way when user input is already queued", async () => {
    const h = harness();
    await command(h, "Do the thing");
    runTurn(h, true);
    (h.ctx as any).hasPendingMessages = () => true;

    expect(await settle(h)).toBeUndefined();
    expect(lastGoalEntry(h.entries)).toMatchObject({ status: "active", runs: 0 });
  });

  it("does nothing for a paused or cleared goal", async () => {
    const h = harness();
    await command(h, "Do the thing");
    await command(h, "pause");
    runTurn(h, true);
    expect(await settle(h)).toBeUndefined();

    await command(h, "clear");
    expect(await settle(h)).toBeUndefined();
  });
});

describe("goal_start tool", () => {
  it("is the tool offered while no goal runs", async () => {
    const h = harness();
    await h.handlers.session_start!({ type: "session_start" }, h.ctx);
    expect(h.activeTools()).toContain(GOAL_START_TOOL);
    expect(h.activeTools()).not.toContain(GOAL_DONE_TOOL);
  });

  it("starts a goal the model drafted, and the loop takes over", async () => {
    const h = harness();
    const result = await h.tools[GOAL_START_TOOL]!.execute(
      "call-1",
      { objective: "Cut p95 latency below 100 ms, verified by the bench, without failing tests" },
      undefined,
      undefined,
      h.ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Goal started:");
    expect(lastGoalEntry(h.entries)).toMatchObject({
      objective: "Cut p95 latency below 100 ms, verified by the bench, without failing tests",
      status: "active",
      runs: 0,
    });
    expect(h.notices.at(-1)?.text).toContain("Goal active:");

    // The tool swap happens at the settle boundary, where the loop also continues.
    const options: { sections: Record<string, string> } = { sections: {} };
    await h.handlers.before_agent_start!({ systemPromptOptions: options }, h.ctx);
    expect(options.sections.goal).toContain("Cut p95 latency below 100 ms");

    runTurn(h, false);
    expect(await settle(h)).toMatchObject({ continue: true });
    expect(h.activeTools()).toContain(GOAL_DONE_TOOL);
    expect(h.activeTools()).not.toContain(GOAL_START_TOOL);
  });

  it("refuses to replace a running goal", async () => {
    const h = harness();
    await command(h, "Original goal");
    const result = await h.tools[GOAL_START_TOOL]!.execute("call-1", { objective: "Another goal" }, undefined, undefined, h.ctx);
    expect(result.isError).toBe(true);
    expect(lastGoalEntry(h.entries)).toMatchObject({ objective: "Original goal", status: "active" });
  });

  it("replaces a finished goal and rejects an empty objective", async () => {
    const h = harness();
    const empty = await h.tools[GOAL_START_TOOL]!.execute("call-1", { objective: "  " }, undefined, undefined, h.ctx);
    expect(empty.isError).toBe(true);

    await command(h, "First goal");
    await h.tools[GOAL_DONE_TOOL]!.execute("c", { summary: "s", evidence: "e" }, undefined, undefined, h.ctx);
    const second = await h.tools[GOAL_START_TOOL]!.execute("c2", { objective: "Second goal" }, undefined, undefined, h.ctx);
    expect(second.isError).toBeUndefined();
    expect(lastGoalEntry(h.entries)).toMatchObject({ objective: "Second goal", status: "active", runs: 0 });
  });
});

describe("goal_done tool", () => {
  it("records completion and stops the loop", async () => {
    const h = harness();
    await command(h, "Make the suite green");
    runTurn(h, true);

    const result = await h.tools[GOAL_DONE_TOOL]!.execute(
      "call-1",
      { summary: "All tests pass", evidence: "npm test -> 214 passed" },
      undefined,
      undefined,
      h.ctx,
    );

    expect(result.content[0].text).toContain("Goal marked complete.");
    expect(lastGoalEntry(h.entries)).toMatchObject({
      status: "done",
      summary: "All tests pass",
      evidence: "npm test -> 214 passed",
    });
    expect(await settle(h)).toBeUndefined();
    expect(h.setStatusCalls.at(-1)).toBeUndefined();
  });

  it("allows a second goal after one completed", async () => {
    const h = harness();
    await command(h, "First goal");
    await h.tools[GOAL_DONE_TOOL]!.execute("c1", { summary: "one", evidence: "check one" }, undefined, undefined, h.ctx);
    // The withdrawal happens at the settle boundary, never mid-batch.
    expect(h.activeTools()).toContain(GOAL_DONE_TOOL);
    expect(await settle(h)).toBeUndefined();
    expect(h.activeTools()).not.toContain(GOAL_DONE_TOOL);

    await command(h, "Second goal");
    expect(lastGoalEntry(h.entries)).toMatchObject({ objective: "Second goal", status: "active", runs: 0 });

    runTurn(h, true);
    const result = (await settle(h)) as { continue: boolean };
    expect(result.continue).toBe(true);
  });

  it("refuses without a goal or without evidence", async () => {
    const h = harness();
    const rejected = await h.tools[GOAL_DONE_TOOL]!.execute("call-1", { summary: "x", evidence: "y" }, undefined, undefined, h.ctx);
    expect(rejected.isError).toBe(true);

    await command(h, "Do the thing");
    const incomplete = await h.tools[GOAL_DONE_TOOL]!.execute(
      "call-2",
      { summary: "done", evidence: "   " },
      undefined,
      undefined,
      h.ctx,
    );
    expect(incomplete.isError).toBe(true);
    expect(lastGoalEntry(h.entries)).toMatchObject({ status: "active" });
  });
});

describe("session wiring", () => {
  it("leaves goal_done out of the tool set when a session starts without a goal", async () => {
    const h = harness();
    await h.handlers.session_start!({ type: "session_start" }, h.ctx);
    expect(h.activeTools()).not.toContain(GOAL_DONE_TOOL);
    expect(h.setStatusCalls.at(-1)).toBeUndefined();
  });

  it("restores an active goal and its tool on session start", async () => {
    const h = harness([
      { type: "custom", customType: GOAL_ENTRY, data: goal({ objective: "Resume me", runs: 4 }) },
    ]);
    await h.handlers.session_start!({ type: "session_start" }, h.ctx);

    expect(h.activeTools()).toContain(GOAL_DONE_TOOL);
    expect(h.setStatusCalls.at(-1)).toBe("goal:active(4)");
    const options: { sections: Record<string, string> } = { sections: {} };
    await h.handlers.before_agent_start!({ systemPromptOptions: options }, h.ctx);
    expect(options.sections.goal).toBeDefined();
  });

  it("injects the objective as a system section only while active", async () => {
    const h = harness();
    await command(h, "Cut p95 below 100ms");

    const options: { sections: Record<string, string> } = { sections: {} };
    await h.handlers.before_agent_start!({ systemPromptOptions: options }, h.ctx);
    expect(options.sections.goal).toContain("Cut p95 below 100ms");
    expect(options.sections.goal).toContain("goal_done");

    await command(h, "pause");
    const paused: { sections: Record<string, string> } = { sections: {} };
    await h.handlers.before_agent_start!({ systemPromptOptions: paused }, h.ctx);
    expect(paused.sections.goal).toBeUndefined();
  });

  it("follows the active branch after tree navigation", async () => {
    const h = harness();
    await command(h, "Branch A goal");
    await command(h, "clear");
    (h.ctx as any).sessionManager.getBranch = () => [
      { type: "custom", customType: GOAL_ENTRY, data: goal({ objective: "Branch A goal", runs: 2 }) },
    ];

    await h.handlers.session_tree!({ type: "session_tree" }, h.ctx);

    expect(h.activeTools()).toContain(GOAL_DONE_TOOL);
    expect(h.setStatusCalls.at(-1)).toBe("goal:active(2)");
  });
});

describe("status text", () => {
  it("renders the three states", () => {
    expect(statusText(null)).toBeUndefined();
    expect(statusText(goal({ runs: 2 }))).toBe("goal:active(2)");
    expect(statusText(goal({ status: "paused" }))).toBe("goal:paused");
    expect(statusText(goal({ status: "done" }))).toBeUndefined();
  });

  it("describes the goal with its evidence", () => {
    const text = describeGoal(goal({ summary: "done", evidence: "tests pass", runs: 3 }));
    expect(text).toContain("Automatic continuations: 3");
    expect(text).toContain("Evidence: tests pass");
  });
});
