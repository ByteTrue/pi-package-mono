import { describe, it, expect } from "vitest";
import subagentExtension from "./index.js";
import {
  parseJsonEvent,
  applyEvent,
  resolveRunCfg,
  buildPiArgs,
  parseAgentFile,
  findAgentDefinition,
  resolvePiCli,
  normalizeTasks,
  SubagentTaskManager,
  SubagentBackgroundManager,
  toMessageDetails,
  subagentManager,
  describeTasks,
  formatSubagentStatus,
  sessionLogPath,
  type ProgressDetails,
  type RunState,
  type JsonObject,
  type SubagentTaskItem,
  type SubagentTaskRecord,
} from "./index.js";
import {
  loadSubagentSettings,
  updateSubagentSettings,
  listDiscoveredAgentNames,
} from "./settings.js";
import { writeFileSync, unlinkSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("pi-subagent unit tests", () => {
  it("parses json events correctly", () => {
    const raw = '{"type":"agent_start"}';
    const evt = parseJsonEvent(raw);
    expect(evt).toEqual({ type: "agent_start" });

    const invalid = "some log line without json";
    expect(parseJsonEvent(invalid)).toBeNull();
  });

  it("applies streaming events to RunState", () => {
    const state: RunState = {
      id: "test-1",
      agent: "tester",
      prompt: "do something",
      sessionId: "session-1",
      status: "pending",
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

    // agent_start
    applyEvent(state, { type: "agent_start" });
    expect(state.status).toBe("running");
    expect(state.startedAt).toBeDefined();

    // message_update thinking_delta
    applyEvent(state, {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "Thinking about plan..." },
    });
    expect(state.thinkingTail).toBe("Thinking about plan...");

    // message_update text_delta
    applyEvent(state, {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello world" },
    });
    expect(state.textTail).toBe("Hello world");

    // tool_execution_start
    applyEvent(state, {
      type: "tool_execution_start",
      toolCallId: "call_1",
      toolName: "read",
      args: { path: "src/index.ts" },
    });
    expect(state.tools.length).toBe(1);
    expect(state.tools[0]?.name).toBe("read");
    expect(state.tools[0]?.status).toBe("running");

    // tool_execution_end
    applyEvent(state, {
      type: "tool_execution_end",
      toolCallId: "call_1",
      isError: false,
    });
    expect(state.tools[0]?.status).toBe("succeeded");

    // message_end
    applyEvent(state, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Final answer" }],
        usage: { input: 100, output: 50, cost: { total: 0.002 }, totalTokens: 150 },
        model: "gpt-4o",
      },
    });
    expect(state.finalText).toBe("Final answer");
    expect(state.usage.input).toBe(100);
    expect(state.usage.output).toBe(50);
    expect(state.usage.cost).toBe(0.002);
    expect(state.usage.turns).toBe(1);

    // agent_end
    applyEvent(state, { type: "agent_end" });
    expect(state.status).toBe("succeeded");
    expect(state.finishedAt).toBeDefined();
  });

  it("resolves user-configured agent model and thinking", () => {
    const cfg = resolveRunCfg(
      { tools: ["read", "grep"] },
      { model: "openai/gpt-4o", thinking: "high" },
      "medium",
      "inherited-model",
    );
    expect(cfg.model).toBe("openai/gpt-4o:high");
    expect(cfg.thinking).toBe("high");
    expect(cfg.tools).toEqual(["read", "grep"]);

    const args = buildPiArgs(cfg);
    expect(args).toContain("--mode");
    expect(args).toContain("json");
    expect(args).toContain("-p");
    expect(args).toContain("--model");
    expect(args).toContain("openai/gpt-4o:high");
    expect(args).toContain("--tools");
    expect(args).toContain("read,grep");
  });

  it("builds session args for new session and resume", () => {
    const newSessionArgs = buildPiArgs({ sessionId: "sub_123" });
    expect(newSessionArgs).toContain("--session-id");
    expect(newSessionArgs).toContain("sub_123");
    expect(newSessionArgs).not.toContain("--no-session");

    const resumeSessionArgs = buildPiArgs({ resumeSession: "sub_123" });
    expect(resumeSessionArgs).toContain("--session");
    expect(resumeSessionArgs).toContain("sub_123");
  });

  it("resolves built-in agent presets when no disk file exists", () => {
    const scout = findAgentDefinition(process.cwd(), "scout");
    expect(scout.found).toBe(true);
    expect(scout.config.tools).toEqual(["read", "grep", "find"]);
    expect(scout.config.thinking).toBe("minimal");
    expect(scout.config.systemPrompt).toContain("scouting subagent");

    const researcher = findAgentDefinition(process.cwd(), "researcher");
    expect(researcher.found).toBe(true);
    expect(researcher.config.tools).toEqual(["read", "grep", "find", "web_search", "web_fetch"]);
    // No built-in thinking default: researcher inherits the parent session's level.
    expect(researcher.config.thinking).toBeUndefined();

    const reviewer = findAgentDefinition(process.cwd(), "reviewer");
    expect(reviewer.found).toBe(true);
    expect(reviewer.config.tools).toEqual(["read", "grep", "find", "bash"]);
    expect(reviewer.config.thinking).toBe("max");
  });

  it("inherits the parent session's thinking level, off included", () => {
    const { config } = findAgentDefinition(process.cwd(), "researcher");
    for (const level of ["minimal", "medium", "max", "off"]) {
      const cfg = resolveRunCfg({ agent: "researcher" }, config, level, "p/m", {});
      expect(cfg.thinking).toBe(level);
      expect(cfg.model).toBe(`p/m:${level}`);
      expect(buildPiArgs(cfg)).toContain(`p/m:${level}`);
    }
  });

  it("resolves model and thinking through settings hierarchy", () => {
    const settings = {
      defaultModel: "bytetrueapi/gemini-3.7-flash",
      defaultThinking: "medium",
      agents: {
        researcher: {
          model: "bytetrueapi/gemini-3.7-flash:high",
          tools: ["read", "grep", "find"],
        },
      },
    };

    // 1. Fallback to settings.defaultModel
    const defaultCfg = resolveRunCfg({}, {}, "low", "parent-model", settings);
    expect(defaultCfg.model).toBe("bytetrueapi/gemini-3.7-flash:medium");
    expect(defaultCfg.thinking).toBe("medium");

    // 2. Role override from settings.agents
    const researcherCfg = resolveRunCfg(
      { agent: "researcher" },
      {},
      "low",
      "parent-model",
      settings,
    );
    expect(researcherCfg.model).toBe("bytetrueapi/gemini-3.7-flash:high");
    expect(researcherCfg.thinking).toBe("high");
    expect(researcherCfg.tools).toEqual(["read", "grep", "find"]);

    // 3. No settings default → inherit the parent session's current model
    const inheritCfg = resolveRunCfg({}, {}, "low", "parent-model", { agents: {} });
    expect(inheritCfg.model).toBe("parent-model:low");
    expect(inheritCfg.thinking).toBe("low");

    // 4. Stale/forged tool-call fields cannot override user-controlled settings
    const forgedTask = {
      agent: "researcher",
      model: "openrouter/unauthorized-model:low",
      thinking: "off",
    } as unknown as Parameters<typeof resolveRunCfg>[0];
    const directCfg = resolveRunCfg(forgedTask, {}, "high", "parent-model", settings);
    expect(directCfg.model).toBe("bytetrueapi/gemini-3.7-flash:high");
    expect(directCfg.thinking).toBe("high");
  });

  it("loads and updates subagent settings correctly in project scope", () => {
    const testDir = join(tmpdir(), `pi-subagent-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      updateSubagentSettings(testDir, "project", (cur) => ({
        ...cur,
        defaultModel: "test-model",
        defaultThinking: "low",
        agents: {
          scout: { model: "scout-model", thinking: "high" },
        },
      }));

      const loaded = loadSubagentSettings(testDir, true);
      expect(loaded.defaultModel).toBe("test-model");
      expect(loaded.defaultThinking).toBe("low");
      expect(loaded.agents?.scout?.model).toBe("scout-model");
      expect(loaded.agents?.scout?.thinking).toBe("high");
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("ignores root-level pi defaults but keeps legacy subagents.agentOverrides fallback", () => {
    const testDir = join(tmpdir(), `pi-subagent-fallback-${Date.now()}`);
    mkdirSync(join(testDir, ".pi"), { recursive: true });

    try {
      writeFileSync(
        join(testDir, ".pi", "settings.json"),
        JSON.stringify({
          defaultProvider: "bytetrueapi",
          defaultModel: "gemini-3.7-flash",
          defaultThinkingLevel: "medium",
          subagents: {
            agentOverrides: {
              reviewer: {
                model: "bytetrueapi/qwen3.8-max",
                thinking: "high",
              },
            },
          },
        }),
      );

      const loaded = loadSubagentSettings(testDir, true);
      // Root-level pi defaults must NOT leak into subagent defaults:
      // unset means "inherit parent session model".
      expect(loaded.defaultModel).toBeUndefined();
      expect(loaded.defaultThinking).toBeUndefined();
      expect(loaded.agents?.reviewer?.model).toBe("bytetrueapi/qwen3.8-max");
      expect(loaded.agents?.reviewer?.thinking).toBe("high");
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("parses agent frontmatter markdown file", () => {
    const tmpFile = join(tmpdir(), `test-agent-${Date.now()}.md`);
    writeFileSync(
      tmpFile,
      `---
model: anthropic/claude-3-7-sonnet
thinking: high
tools: read, grep, find
---

You are an expert researcher. Read references carefully.
`,
    );

    try {
      const parsed = parseAgentFile(tmpFile);
      expect(parsed.model).toBe("anthropic/claude-3-7-sonnet");
      expect(parsed.thinking).toBe("high");
      expect(parsed.tools).toEqual(["read", "grep", "find"]);
      expect(parsed.systemPrompt).toContain("You are an expert researcher.");
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  });

  it("sanitizes agent name against path traversal in findAgentDefinition", () => {
    const res = findAgentDefinition(process.cwd(), "../../etc/passwd");
    expect(res.found).toBe(false);
  });

  it("normalizes tasks cleanly from various input shapes", () => {
    // 1. Single task string
    const single = normalizeTasks({ task: "test task" });
    expect(single.tasks).toEqual([{ task: "test task" }]);
    expect(single.isChain).toBe(false);

    // 2. Structured tasks object array with chain
    const chain = normalizeTasks({
      chain: true,
      tasks: [
        { task: "step 1", agent: "scout" },
        {
          task: "step 2",
          agent: "reviewer",
          model: "gpt-5",
          thinking: "off",
        } as unknown as SubagentTaskItem,
      ],
    });
    expect(chain.isChain).toBe(true);
    expect(chain.tasks.length).toBe(2);
    expect(chain.tasks[0]?.agent).toBe("scout");
    expect(chain.tasks[1]).not.toHaveProperty("model");
    expect(chain.tasks[1]).not.toHaveProperty("thinking");

    // 3. String array fallback
    const stringArray = normalizeTasks({
      tasks: ["task a", "task b"],
      agent: "default-agent",
    });
    expect(stringArray.tasks.length).toBe(2);
    expect(stringArray.tasks[0]?.task).toBe("task a");
    expect(stringArray.tasks[0]?.agent).toBe("default-agent");
    expect(stringArray.tasks[1]?.task).toBe("task b");
  });

  it("manages subagent tasks lifecycle including running count and stop", async () => {
    const mgr = new SubagentTaskManager();
    let exitNotified = false;
    mgr.init((t: SubagentTaskRecord) => {
      if (t.id === "sub_1") exitNotified = true;
    });

    const controller = new AbortController();
    mgr.register({
      id: "sub_1",
      parentSessionId: "session_123",
      description: "testing task",
      status: "running",
      output: "",
      startedAt: Date.now(),
      controller,
      notifyOnExit: true,
      done: Promise.resolve(),
    });

    expect(mgr.getRunningCount("session_123")).toBe(1);

    const list = mgr.list("session_123");
    expect(list.length).toBe(1);
    expect(list[0]?.status).toBe("running");

    // Test stop
    const stopped = mgr.stop("sub_1");
    expect(stopped).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(mgr.getRunningCount("session_123")).toBe(0);

    // Complete notification
    mgr.complete("sub_1", "all good", false);
    expect(exitNotified).toBe(true);
    expect(list[0]?.status).toBe("succeeded");
    expect(list[0]?.output).toBe("all good");

    await mgr.clearSession("session_123");
    expect(mgr.list("session_123").length).toBe(0);
  });

  it("resolves pi cli executable cleanly", () => {
    const cli = resolvePiCli();
    expect(cli.command).toBeDefined();
    expect(Array.isArray(cli.args)).toBe(true);
  });

  it("strips live objects from exit-message details so structuredClone cannot throw", () => {
    const task: SubagentTaskRecord = {
      id: "sub_1",
      parentSessionId: "session_123",
      description: "audit task",
      agent: "scout",
      status: "succeeded",
      output: "done",
      startedAt: 1,
      finishedAt: 2,
      controller: new AbortController(),
      notifyOnExit: true,
      done: new Promise(() => {}),
      progress: { kind: "pi-subagent-progress", agent: "scout", mode: "concurrent", startedAt: 1, updatedAt: 2, final: true, runs: [] },
    };

    const details = toMessageDetails(task);
    // Direct snapshot assertions:
    expect(details).not.toHaveProperty("controller");
    expect(details).not.toHaveProperty("done");
    expect(details).not.toHaveProperty("notifyOnExit");
    expect(details).not.toHaveProperty("progress");
    expect(details.id).toBe("sub_1");
    expect(details.status).toBe("succeeded");

    // The real contract: what lands in sendMessage details must survive
    // pi core's structuredClone(messages) before every LLM call.
    expect(() => structuredClone(details)).not.toThrow();
    expect(() => structuredClone([task])).toThrow(); // the bug we just fixed
  });

  it("does not expose model or thinking controls in the Agent tool schema", () => {
    let registered: JsonObject | undefined;
    const prevChildEnv = process.env.PI_SUBAGENT_CHILD;
    delete process.env.PI_SUBAGENT_CHILD;
    try {
      subagentExtension({
        registerTool: (tool: JsonObject) => {
          registered = tool;
        },
      });
    } finally {
      if (prevChildEnv !== undefined) process.env.PI_SUBAGENT_CHILD = prevChildEnv;
    }

    const parameters = registered?.parameters as JsonObject;
    const tasks = (parameters.properties as JsonObject).tasks as JsonObject;
    const items = tasks.items as JsonObject;
    const taskProperties = items.properties as JsonObject;
    expect(taskProperties).not.toHaveProperty("model");
    expect(taskProperties).not.toHaveProperty("thinking");
    expect(taskProperties).toHaveProperty("agent");
    // Pure background (issue 088): there is no foreground mode to opt out of.
    expect(parameters.properties).not.toHaveProperty("async");
    expect(registered).not.toHaveProperty("renderResult");
  });

  it("formats the footer from the oldest running task and clears when idle", () => {
    const base = {
      parentSessionId: "s",
      output: "",
      controller: new AbortController(),
      notifyOnExit: true,
    };
    const tasks: SubagentTaskRecord[] = [
      { ...base, id: "a", description: "x", status: "succeeded", startedAt: 0 },
      { ...base, id: "b", description: "y", agent: "reviewer", status: "running", startedAt: 10_000 },
      { ...base, id: "c", description: "z", status: "running", startedAt: 70_000 },
    ];
    expect(formatSubagentStatus(tasks, 100_000)).toBe("sub:2 · reviewer 1m30s");
    expect(formatSubagentStatus(tasks.filter((t) => t.status !== "running"), 100_000)).toBeUndefined();
  });

  it("stores streamed progress on the running record and stops after completion", () => {
    const mgr = new SubagentTaskManager();
    let changes = 0;
    mgr.init(() => {}, () => changes++);
    mgr.register({
      id: "p",
      parentSessionId: "s",
      description: "d",
      status: "running",
      output: "",
      startedAt: 0,
      controller: new AbortController(),
      notifyOnExit: false,
    });
    const progress: ProgressDetails = { kind: "pi-subagent-progress", agent: "scout", mode: "concurrent", startedAt: 0, updatedAt: 1, final: false, runs: [] };
    mgr.setProgress("p", progress);
    expect(mgr.get("p")?.progress).toBe(progress);
    expect(changes).toBe(2);
    mgr.complete("p", "ok", false);
    mgr.setProgress("p", { ...progress, updatedAt: 2 });
    expect(mgr.get("p")?.progress?.updatedAt).toBe(1);
  });

  it("shares task data across manager instances so a /reload keeps tasks but gets current methods", () => {
    // Simulates two module evaluations pinning the same Map (issue 088 regression).
    const shared = new Map<string, SubagentTaskRecord>();
    const first = new SubagentTaskManager(shared);
    first.register({
      id: "r",
      parentSessionId: "s",
      description: "d",
      status: "running",
      output: "",
      startedAt: 0,
      controller: new AbortController(),
      notifyOnExit: false,
    });
    const second = new SubagentTaskManager(shared);
    expect(second.get("r")?.status).toBe("running");
    expect(typeof second.setProgress).toBe("function");
    second.stop("r");
    expect(first.get("r")?.status).toBe("cancelled");
  });

  it("locates the child's persisted session log under the encoded-cwd sessions dir", () => {
    const agentDir = join(tmpdir(), `pi-subagent-agent-${Date.now()}`);
    const cwd = "/tmp/some project";
    const dir = join(agentDir, "sessions", "--tmp-some project--");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-01-01T00-00-00-000Z_sub_abc.jsonl"), "");
    const prev = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      expect(sessionLogPath({ cwd, sessionId: "sub_abc" })).toBe(join(dir, "2026-01-01T00-00-00-000Z_sub_abc.jsonl"));
      expect(sessionLogPath({ cwd, sessionId: "sub_missing" })).toBeUndefined();
      expect(sessionLogPath({ sessionId: "sub_abc" })).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prev;
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("describes tasks as plain text with role prefix and count", () => {
    expect(describeTasks([{ task: "  Review\n  the diff  ", agent: "reviewer" }], false)).toBe("reviewer: Review the diff");
    expect(describeTasks([{ task: "a" }, { task: "b" }], true)).toBe("2 tasks (chain) · a");
  });

  it("sends exit messages with clone-safe details through the manager wiring", async () => {
    // Reproduces the real crash path end-to-end: SubagentTaskManager.complete →
    // extension onExit → flushPendingExits → pi.sendMessage details. Before the fix
    // the raw record (with a live Promise) was handed to sendMessage and crashed
    // pi core's structuredClone before every subsequent LLM call.
    const sent: { customType?: string; content: string; details?: unknown }[] = [];
    const handlers = new Map<string, (event: unknown, ctx?: unknown) => unknown>();
    const pi = {
      sendMessage: (msg: { customType?: string; content: string; details?: unknown }) => {
        sent.push(msg);
      },
      on: (event: string, handler: (event: unknown, ctx?: unknown) => unknown) => {
        handlers.set(event, handler);
      },
    };
    // subagentExtension early-returns under PI_SUBAGENT_CHILD=1 (e.g. when tests run
    // from inside a pi subagent session) — force the parent path.
    const prevChildEnv = process.env.PI_SUBAGENT_CHILD;
    delete process.env.PI_SUBAGENT_CHILD;
    try {
      subagentExtension(pi as Parameters<typeof subagentExtension>[0]);
    } finally {
      if (prevChildEnv !== undefined) process.env.PI_SUBAGENT_CHILD = prevChildEnv;
    }
    expect(handlers.size).toBeGreaterThan(0);

    // session_start wires currentSessionId; without it the exit callback drops notifications.
    handlers
      .get("session_start")
      ?.({}, { sessionManager: { getSessionId: () => "s-wiring" } });

    const task: SubagentTaskRecord = {
      id: "sub_w",
      parentSessionId: "s-wiring",
      description: "scout run",
      status: "running",
      output: "",
      startedAt: Date.now(),
      controller: new AbortController(),
      notifyOnExit: true,
      done: Promise.resolve(),
    };
    subagentManager.register(task);
    subagentManager.complete("sub_w", "ok", false);

    // The notification went through the real flushPendingExits path.
    expect(sent.length).toBe(1);
    expect(sent[0]?.customType).toBe("subagent-exit");
    const details = sent[0]?.details as Record<string, unknown>;
    expect(details).not.toHaveProperty("controller");
    expect(details).not.toHaveProperty("done");
    expect(details).not.toHaveProperty("notifyOnExit");
    expect(details.id).toBe("sub_w");
    // pi core clones every session message before each LLM call — must never throw.
    expect(() => structuredClone(details)).not.toThrow();

    // Don't leak the task into the process-global singleton for later tests.
    await subagentManager.clearSession("s-wiring");
    expect(subagentManager.list("s-wiring")).toHaveLength(0);
  });
});
