import { describe, it, expect, beforeEach, afterEach } from "vitest";
import subagentExtension from "./index.js";
import {
  parseJsonEvent,
  applyEvent,
  resolveRunCfg,
  buildPiArgs,
  buildChildEnv,
  parseAgentFile,
  findAgentDefinition,
  resolveAgentRole,
  resolvePiCli,
  runPi,
  normalizeTask,
  SubagentTaskManager,
  SubagentBackgroundManager,
  toMessageDetails,
  subagentManager,
  describeTask,
  formatSubagentStatus,
  formatSubagentTaskStatus,
  sessionLogPath,
  type ProgressDetails,
  type RunState,
  type JsonObject,
  type SubagentInput,
  type SubagentTaskItem,
  type SubagentTaskRecord,
} from "./index.js";
import {
  loadSubagentSettings,
  updateSubagentSettings,
  listDiscoveredAgentNames,
} from "./settings.js";
import { writeFileSync, unlinkSync, mkdirSync, existsSync, rmSync, readFileSync, mkdtempSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";

// The global settings layer is the user's real ~/.pi/agent/settings.json unless
// PI_CODING_AGENT_DIR points elsewhere. Every test runs against an empty temp
// agent dir so a developer's live config can never leak into assertions —
// without this, a test that reads the global layer passes or fails by machine.
const ORIGINAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
const ORIGINAL_PKG_CFG_DIR = process.env.PI_PKG_CFG_DIR;
let hermeticAgentDir: string;

beforeEach(() => {
  hermeticAgentDir = join(tmpdir(), `pi-subagent-global-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(hermeticAgentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = hermeticAgentDir;
  delete process.env.PI_PKG_CFG_DIR;
});

afterEach(() => {
  if (ORIGINAL_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = ORIGINAL_AGENT_DIR;
  if (ORIGINAL_PKG_CFG_DIR === undefined) delete process.env.PI_PKG_CFG_DIR;
  else process.env.PI_PKG_CFG_DIR = ORIGINAL_PKG_CFG_DIR;
  rmSync(hermeticAgentDir, { recursive: true, force: true });
});

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

  it("resolves built-in roles from the package's agent documents", () => {
    const explore = findAgentDefinition(process.cwd(), "explore");
    expect(explore.found).toBe(true);
    expect(explore.config.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
    expect(explore.config.thinking).toBe("minimal");
    expect(explore.config.systemPrompt).toContain("file search specialist");

    const plan = findAgentDefinition(process.cwd(), "plan");
    expect(plan.found).toBe(true);
    expect(plan.config.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
    expect(plan.config.thinking).toBeUndefined();
    expect(plan.config.systemPrompt).toContain("Critical Files for Implementation");
    // The read-only roles must not be able to modify the tree.
    expect(plan.config.tools).not.toContain("edit");
    expect(explore.config.tools).not.toContain("write");

    const gp = findAgentDefinition(process.cwd(), "general-purpose");
    expect(gp.found).toBe(true);
    // No `tools:` line: the child inherits pi's full default set.
    expect(gp.config.tools).toBeUndefined();
    // Nor model/thinking: omitting `agent` must stay full inheritance, so an
    // edit that pins these in the document would silently retune every
    // agentless call. The document is a prompt template, nothing more.
    expect(gp.config.model).toBeUndefined();
    expect(gp.config.thinking).toBeUndefined();
    expect(gp.config.systemPrompt).toContain("do not re-delegate");
  });

  it("uses the general-purpose document as the template when no role is named", () => {
    const omitted = resolveAgentRole(process.cwd(), undefined, {});
    const gp = findAgentDefinition(process.cwd(), "general-purpose");
    expect(omitted).toEqual(gp.config);
    // The default template must not narrow the toolset or pin model/thinking.
    expect(omitted.tools).toBeUndefined();
    expect(omitted.model).toBeUndefined();
    expect(omitted.thinking).toBeUndefined();
    expect(omitted.systemPrompt).toBeTruthy();
    // Blank/whitespace names take the same path rather than erroring.
    expect(resolveAgentRole(process.cwd(), "   ", {})).toEqual(gp.config);
  });

  it("lets a user agent document shadow a same-named built-in role", () => {
    const dir = join(tmpdir(), `pi-subagent-agents-${Date.now()}`);
    mkdirSync(join(dir, ".pi", "agents"), { recursive: true });
    writeFileSync(
      join(dir, ".pi", "agents", "explore.md"),
      "---\nmodel: cheap/model\nthinking: low\ntools: read, grep\n---\n\nCustom explore prompt.\n",
    );
    try {
      const explore = findAgentDefinition(dir, "explore");
      expect(explore.found).toBe(true);
      expect(explore.config.model).toBe("cheap/model");
      expect(explore.config.thinking).toBe("low");
      expect(explore.config.tools).toEqual(["read", "grep"]);
      expect(explore.config.systemPrompt).toBe("Custom explore prompt.");

      // Sibling built-ins stay untouched.
      const plan = findAgentDefinition(dir, "plan");
      expect(plan.config.thinking).toBeUndefined();
      expect(plan.config.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("inherits the parent session's thinking level, off included", () => {
    const { config } = findAgentDefinition(process.cwd(), "plan");
    for (const level of ["minimal", "medium", "max", "off"]) {
      const cfg = resolveRunCfg({ agent: "plan" }, config, level, "p/m", {});
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

  it("passes settings subagent.env through to children, project winning over global", () => {
    const testDir = join(tmpdir(), `pi-subagent-env-${Date.now()}`);
    mkdirSync(join(testDir, ".pi"), { recursive: true });
    const agentDir = process.env.PI_CODING_AGENT_DIR;
    const globalDir = join(tmpdir(), `pi-subagent-env-global-${Date.now()}`);
    mkdirSync(globalDir, { recursive: true });

    try {
      writeFileSync(
        join(globalDir, "settings.json"),
        JSON.stringify({
          subagent: {
            env: { SHARED: "global", GLOBAL_ONLY: "1", KEPT: "yes" },
          },
        }),
      );
      process.env.PI_CODING_AGENT_DIR = globalDir;
      writeFileSync(
        join(testDir, ".pi", "settings.json"),
        JSON.stringify({
          subagent: {
            env: { SHARED: "project", PROJECT_ONLY: "2", BAD_NUMBER: 3, BAD_NULL: null, "": "dropped" },
          },
        }),
      );

      const loaded = loadSubagentSettings(testDir, true);
      expect(loaded.env).toEqual({
        SHARED: "project",
        GLOBAL_ONLY: "1",
        KEPT: "yes",
        PROJECT_ONLY: "2",
      });

      // The env reaches the child process and cannot be shadowed by anything else
      // in the run config.
      const cfg = resolveRunCfg({}, {}, undefined, undefined, loaded);
      const childEnv = buildChildEnv(cfg);
      expect(childEnv.PROJECT_ONLY).toBe("2");
      expect(childEnv.SHARED).toBe("project");
      expect(childEnv.PI_SUBAGENT_CHILD).toBe("1");
    } finally {
      if (agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = agentDir;
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
      if (existsSync(globalDir)) rmSync(globalDir, { recursive: true, force: true });
    }
  });

  it("keeps subagent.env when the /subagent menu rewrites settings", () => {
    const testDir = join(tmpdir(), `pi-subagent-env-keep-${Date.now()}`);
    mkdirSync(join(testDir, ".pi"), { recursive: true });
    const agentDir = process.env.PI_CODING_AGENT_DIR;
    const globalDir = join(tmpdir(), `pi-subagent-env-keep-global-${Date.now()}`);
    mkdirSync(globalDir, { recursive: true });

    try {
      // Isolate the global layer: the real one may carry subagent.env too.
      process.env.PI_CODING_AGENT_DIR = globalDir;
      writeFileSync(
        join(testDir, ".pi", "settings.json"),
        JSON.stringify({ subagent: { env: { MY_SWITCH: "0" }, defaultModel: "m1" } }),
      );
      // The menu's updater spreads `current`, so a role edit must not drop env.
      updateSubagentSettings(testDir, "project", (cur) => ({
        ...cur,
        agents: { explore: { model: "explore-model" } },
      }));

      const loaded = loadSubagentSettings(testDir, true);
      expect(loaded.env).toEqual({ MY_SWITCH: "0" });
      expect(loaded.defaultModel).toBe("m1");
      expect(loaded.agents?.explore?.model).toBe("explore-model");
    } finally {
      if (agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = agentDir;
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
      if (existsSync(globalDir)) rmSync(globalDir, { recursive: true, force: true });
    }
  });

  it("lets settings env shadow the parent but never the recursion guard", () => {
    const cfg = resolveRunCfg(
      {},
      {},
      undefined,
      undefined,
      // A user pointing the guard at "0" would let children load this extension
      // and recurse; the guard is set after the settings spread for that reason.
      { env: { PI_SUBAGENT_CHILD: "0", BILLION_CONTEXT_PLUGIN: "0" } },
    );
    const childEnv = buildChildEnv(cfg);
    expect(childEnv.BILLION_CONTEXT_PLUGIN).toBe("0");
    expect(childEnv.PI_SUBAGENT_CHILD).toBe("1");
  });

  it("drops project subagent.env entirely when the project is not trusted", () => {
    const testDir = join(tmpdir(), `pi-subagent-env-untrusted-${Date.now()}`);
    mkdirSync(join(testDir, ".pi"), { recursive: true });
    const agentDir = process.env.PI_CODING_AGENT_DIR;
    const globalDir = join(tmpdir(), `pi-subagent-env-untrusted-global-${Date.now()}`);
    mkdirSync(globalDir, { recursive: true });

    try {
      writeFileSync(
        join(globalDir, "settings.json"),
        JSON.stringify({ subagent: { env: { FROM_GLOBAL: "1" } } }),
      );
      process.env.PI_CODING_AGENT_DIR = globalDir;
      // A repo-supplied NODE_OPTIONS is the exact injection this gate must stop.
      writeFileSync(
        join(testDir, ".pi", "settings.json"),
        JSON.stringify({ subagent: { env: { NODE_OPTIONS: "--require /tmp/evil.js" } } }),
      );

      // Same files, only the trust bit differs.
      expect(loadSubagentSettings(testDir, true).env).toEqual({
        FROM_GLOBAL: "1",
        NODE_OPTIONS: "--require /tmp/evil.js",
      });
      expect(loadSubagentSettings(testDir, false).env).toEqual({ FROM_GLOBAL: "1" });
    } finally {
      if (agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = agentDir;
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
      if (existsSync(globalDir)) rmSync(globalDir, { recursive: true, force: true });
    }
  });

  it("does not let an empty project env map clear the global one", () => {
    const testDir = join(tmpdir(), `pi-subagent-env-empty-${Date.now()}`);
    mkdirSync(join(testDir, ".pi"), { recursive: true });
    const agentDir = process.env.PI_CODING_AGENT_DIR;
    const globalDir = join(tmpdir(), `pi-subagent-env-empty-global-${Date.now()}`);
    mkdirSync(globalDir, { recursive: true });

    try {
      writeFileSync(
        join(globalDir, "settings.json"),
        JSON.stringify({ subagent: { env: { FROM_GLOBAL: "1" } } }),
      );
      process.env.PI_CODING_AGENT_DIR = globalDir;
      // `{}` parses to undefined (no opinion), it is not an explicit wipe.
      writeFileSync(
        join(testDir, ".pi", "settings.json"),
        JSON.stringify({ subagent: { env: {} } }),
      );

      expect(loadSubagentSettings(testDir, true).env).toEqual({ FROM_GLOBAL: "1" });
    } finally {
      if (agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = agentDir;
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
      if (existsSync(globalDir)) rmSync(globalDir, { recursive: true, force: true });
    }
  });

  it("carries subagent.env on both resolveRunCfg return paths", () => {
    const settings = { env: { SWITCH: "0" } };
    // Branch 1: a model plus a thinking level bakes into `${model}:${thinking}`.
    expect(resolveRunCfg({}, { model: "p/m", thinking: "high" }, "low", undefined, settings).env).toEqual({
      SWITCH: "0",
    });
    // Branch 2: the plain fallback return.
    expect(resolveRunCfg({}, { model: "p/m" }, undefined, undefined, settings).env).toEqual({ SWITCH: "0" });
    // No configured env stays absent rather than becoming {}.
    expect(resolveRunCfg({}, {}, undefined, undefined, undefined).env).toBeUndefined();
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
                tools: ["read", "grep", "find", "bash", "compress", "decompress", "search_context", "acp_status"],
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
      // billion-context-pi's `/acp-subagents` writes a tools override here. It must
      // survive parsing: role tools beat the agent document's own `tools:` line.
      expect(loaded.agents?.reviewer?.tools).toContain("compress");
      expect(loaded.agents?.reviewer?.tools).toContain("bash");
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

  it("resolves a known role and rejects an unknown one with the available list (issue 097)", () => {
    // Omitting `agent` uses the general-purpose document as the default template.
    const defaultCfg = resolveAgentRole(process.cwd(), undefined);
    expect(defaultCfg.systemPrompt).toContain("do not re-delegate");
    expect(defaultCfg.tools).toBeUndefined();
    // Whitespace-only is treated the same as omitted.
    expect(resolveAgentRole(process.cwd(), "   ").systemPrompt).toContain("do not re-delegate");
    expect(resolveAgentRole(process.cwd(), "explore").tools).toEqual([
      "read",
      "grep",
      "find",
      "ls",
      "bash",
    ]);
    expect(() => resolveAgentRole(process.cwd(), "definitely-not-a-role")).toThrow(
      /Unknown agent role "definitely-not-a-role"/,
    );
    expect(() => resolveAgentRole(process.cwd(), "definitely-not-a-role")).toThrow(
      /Omit 'agent' for the default general-purpose child/,
    );
  });

  it("fails a subagent call with an unknown agent role before starting a task (issue 097)", async () => {
    const registered = new Map<string, JsonObject>();
    const prevChildEnv = process.env.PI_SUBAGENT_CHILD;
    delete process.env.PI_SUBAGENT_CHILD;
    try {
      subagentExtension({
        registerTool: (tool: JsonObject) => registered.set(String(tool.name), tool),
      });
    } finally {
      if (prevChildEnv !== undefined) process.env.PI_SUBAGENT_CHILD = prevChildEnv;
    }
    const execute = registered.get("subagent")!.execute as (
      id: string,
      input: unknown,
      signal: undefined,
      onUpdate: undefined,
      ctx: { sessionManager: { getSessionId: () => string } },
    ) => Promise<unknown>;
    await expect(
      execute("call_1", { task: "x", agent: "no-such-role" }, undefined, undefined, {
        sessionManager: { getSessionId: () => "sess-err" },
      }),
    ).rejects.toThrow(/Unknown agent role "no-such-role"/);
  });

  it("normalizes a single task input, dropping unknown fields (issue 095)", () => {
    const item = normalizeTask({ task: "  test task  " });
    expect(item).toEqual({ task: "test task" });

    // model/thinking never pass through (082 invariant) — not in SubagentInput, but models send junk
    const junk = normalizeTask({
      task: "x",
      model: "gpt-5",
      thinking: "off",
    } as unknown as SubagentInput);
    expect(junk).toEqual({ task: "x" });

    expect(() => normalizeTask({ task: "   " })).toThrow(/No task specified/);
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
      progress: { kind: "pi-subagent-progress", agent: "scout", startedAt: 1, updatedAt: 2, final: true, runs: [] },
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

  it("exposes a flat single-task schema with no model/thinking controls (issue 095)", () => {
    const registered = new Map<string, JsonObject>();
    const prevChildEnv = process.env.PI_SUBAGENT_CHILD;
    delete process.env.PI_SUBAGENT_CHILD;
    try {
      subagentExtension({
        registerTool: (tool: JsonObject) => {
          registered.set(String(tool.name), tool);
        },
      });
    } finally {
      if (prevChildEnv !== undefined) process.env.PI_SUBAGENT_CHILD = prevChildEnv;
    }

    // All three tools registered; assertions below target the main subagent tool.
    expect([...registered.keys()].sort()).toEqual(["subagent", "subagent_status", "subagent_stop"]);
    const main = registered.get("subagent")!;
    const parameters = main.parameters as JsonObject;
    const props = parameters.properties as JsonObject;
    // Flat single-task surface: task required; batch/chain gone (issue 095).
    expect(props).toHaveProperty("task");
    expect(props).toHaveProperty("agent");
    expect(parameters.required).toEqual(["task"]);
    expect(props).not.toHaveProperty("tasks");
    expect(props).not.toHaveProperty("chain");
    expect(props).not.toHaveProperty("mode");
    expect(props).not.toHaveProperty("prompts");
    expect(props).not.toHaveProperty("model");
    expect(props).not.toHaveProperty("thinking");
    // Pure background (issue 088): there is no foreground mode to opt out of.
    expect(props).not.toHaveProperty("async");
    expect(registered).not.toHaveProperty("renderResult");

    // The omit-agent default path must stay visible on every model-facing surface,
    // or models only ever fill `agent` with a role (issue 096). Nothing may gate
    // custom roles behind the built-in ones, and the model must see the actual
    // role choices, not just the built-ins (issue 105).
    expect(String(main.description)).toContain("Omit 'agent' for a general-purpose default child");
    expect(String(main.promptSnippet)).toContain("omit 'agent' for the general-purpose default child");
    const guidelines = (main.promptGuidelines as string[]).join("\n");
    expect(guidelines).toContain("Delegate any self-contained job");
    expect(guidelines).not.toContain("pass 'agent' only when");
    const agentParam = props.agent as JsonObject;
    const agentParamText = String(agentParam.description);
    expect(agentParamText).toContain("Omit it for a general-purpose default child");
    // Dynamic role list (issue 105): built-ins are always discovered, so they must
    // be listed; the default role itself stays out of the list.
    expect(agentParamText).toContain("Roles available: ");
    expect(agentParamText).toMatch(/\bexplore\b/);
    expect(agentParamText).toMatch(/\bplan\b/);
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
    expect(formatSubagentStatus(tasks, 100_000)).toBe("sub:2 · reviewer 1m30s · subagent 30s");
    expect(formatSubagentStatus(tasks.filter((t) => t.status !== "running"), 100_000)).toBeUndefined();
  });

  it("caps the footer at 3 tasks with a +N more suffix", () => {
    const base = {
      parentSessionId: "s",
      output: "",
      controller: new AbortController(),
      notifyOnExit: true,
    };
    const running = (id: string, agent: string | undefined, startedAt: number): SubagentTaskRecord => ({
      ...base,
      id,
      description: id,
      agent,
      status: "running",
      startedAt,
    });
    const tasks = [
      running("a", "scout", 99_000),
      running("b", "reviewer", 98_000),
      running("c", undefined, 97_000),
      running("d", "researcher", 96_000),
    ];
    // Oldest first; the 4th collapses into +1 more.
    expect(formatSubagentStatus(tasks, 100_000)).toBe("sub:4 · researcher 4s · subagent 3s · reviewer 2s · +1 more");
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
    const progress: ProgressDetails = { kind: "pi-subagent-progress", agent: "scout", startedAt: 0, updatedAt: 1, final: false, runs: [] };
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
    const cwd = join(tmpdir(), `pi-subagent-cwd ${Date.now()}`);
    // Mirror pi's getDefaultSessionDirPath encoding (not exported by pi), with
    // resolve() first: on Windows a POSIX-style path resolves to a drive path.
    const safe = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    const dir = join(agentDir, "sessions", safe);
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

  it("describes a task as plain text with role prefix (no ANSI)", () => {
    expect(describeTask({ task: "  Review\n  the diff  ", agent: "reviewer" })).toBe("reviewer: Review the diff");
    expect(describeTask({ task: "Just a task" })).toBe("Just a task");
  });

  it("formats subagent_status output per state and hides output text (issue 095)", () => {
    const base = {
      id: "sub_x",
      parentSessionId: "s",
      description: "reviewer: Review the diff",
      agent: "reviewer",
      controller: new AbortController(),
      notifyOnExit: false,
    };
    const run: RunState = {
      id: "run-1",
      agent: "reviewer",
      prompt: "review",
      sessionId: "sub_x",
      status: "running",
      startedAt: 0,
      finalText: "",
      textTail: "",
      thinkingTail: "",
      stderrTail: "",
      tools: [],
      model: "glm-5.3-flash:max",
      usage: { input: 42000, output: 900, cacheRead: 0, cacheWrite: 0, cost: 0.31, ctxTokens: 42300, turns: 6 },
    };
    run.tools.push(
      { id: "t1", name: "read", args: '{"path":"src/index.ts"}', status: "succeeded", startedAt: 1, finishedAt: 2 },
      { id: "t2", name: "bash", args: '{"command":"npm test"}', status: "running", startedAt: 3 },
    );
    const running: SubagentTaskRecord = {
      ...base,
      status: "running",
      output: "",
      startedAt: 60_000,
      progress: { kind: "pi-subagent-progress", agent: "reviewer", startedAt: 0, updatedAt: 5, final: false, runs: [run] },
    };
    const text = formatSubagentTaskStatus(running, 126_000);
    expect(text).toContain("[sub_x] reviewer · running · 1m6s");
    expect(text).toContain("Task: reviewer: Review the diff");
    expect(text).toContain("current: bash: npm test");
    expect(text).toContain("turn 6");
    expect(text).toContain("$0.31");
    expect(text).toContain("read: src/index.ts");
    // The output text is delivered by the exit notification, never here.
    expect(text).not.toContain("SECRET-OUTPUT");

    const done: SubagentTaskRecord = { ...base, status: "succeeded", output: "SECRET-OUTPUT", startedAt: 0, finishedAt: 30_000 };
    const doneText = formatSubagentTaskStatus(done, 30_000);
    expect(doneText).toContain("succeeded · 30s");
    expect(doneText).not.toContain("SECRET-OUTPUT");
    expect(doneText).toContain("(no progress yet)");
  });

  it("subagent_status and subagent_stop are session-scoped and stop is idempotent (issue 095)", async () => {
    let registered = new Map<string, JsonObject>();
    const handlers = new Map<string, (event: unknown, ctx?: unknown) => unknown>();
    const prevChildEnv = process.env.PI_SUBAGENT_CHILD;
    delete process.env.PI_SUBAGENT_CHILD;
    try {
      subagentExtension({
        registerTool: (tool: JsonObject) => registered.set(String(tool.name), tool),
        on: (event: string, handler: (event: unknown, ctx?: unknown) => unknown) => {
          handlers.set(event, handler);
        },
      } as Parameters<typeof subagentExtension>[0]);
    } finally {
      if (prevChildEnv !== undefined) process.env.PI_SUBAGENT_CHILD = prevChildEnv;
    }
    handlers.get("session_start")?.({}, { sessionManager: { getSessionId: () => "sess-1" } });

    const controller = new AbortController();
    const task: SubagentTaskRecord = {
      id: "sub_ctl",
      parentSessionId: "sess-1",
      description: "scout: recon",
      agent: "scout",
      status: "running",
      output: "",
      startedAt: Date.now(),
      controller,
      notifyOnExit: false,
    };
    subagentManager.register(task);
    try {
      const runTool = async (name: string, args: unknown, sessionId?: string) => {
        const tool = registered.get(name)!;
        const execute = tool.execute as (
          id: string,
          input: unknown,
          signal: undefined,
          onUpdate: undefined,
          ctx: { sessionManager: { getSessionId: () => string } },
        ) => Promise<{ content: { type: string; text: string }[] }>;
        return execute("call_1", args, undefined, undefined, { sessionManager: { getSessionId: () => sessionId ?? "sess-1" } });
      };

      // Other session must not see or stop it.
      await expect(runTool("subagent_status", { id: "sub_ctl" }, "other")).rejects.toThrow(/No subagent task/);
      await expect(runTool("subagent_stop", { id: "sub_ctl" }, "other")).rejects.toThrow(/No subagent task/);

      const statusText = (await runTool("subagent_status", { id: "sub_ctl" })).content[0]!.text;
      expect(statusText).toContain("running");

      // Stop: aborts the controller, marks cancelled, idempotent afterwards.
      const stopText = (await runTool("subagent_stop", { id: "sub_ctl" })).content[0]!.text;
      expect(stopText).toContain("Stopped sub_ctl");
      expect(controller.signal.aborted).toBe(true);
      expect(task.status).toBe("cancelled");
      const again = (await runTool("subagent_stop", { id: "sub_ctl" })).content[0]!.text;
      expect(again).toContain("already cancelled");
    } finally {
      await subagentManager.clearSession("sess-1");
    }
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

// A stand-in pi CLI: emits one assistant message_end every 120ms (one "turn"),
// spawns a long-lived grandchild, and logs everything so tests can verify the
// process tree actually died after abort.
const FAKE_PI_CJS = [
  'const fs = require("node:fs");',
  'const { spawn } = require("node:child_process");',
  'const logFile = process.env.FAKE_PI_LOG;',
  'const log = (line) => fs.appendFileSync(logFile, line + "\\n");',
  'log("start pid=" + process.pid);',
  'const gc = spawn(process.execPath, ["-e", "setInterval(function(){}, 1000)"], { stdio: "ignore" });',
  'log("grandchild " + gc.pid);',
  'let n = 0;',
  'process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\\n");',
  'setInterval(() => {',
  '  n += 1;',
  '  log("turn " + n);',
  '  process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "turn " + n }], usage: { input: 1, output: 1, cost: { total: 0 }, totalTokens: 2 } } }) + "\\n");',
  '}, 120);',
  'process.on("SIGTERM", () => { log("sigterm"); try { process.kill(gc.pid); } catch {} process.exit(0); });',
  'setTimeout(() => { try { process.kill(gc.pid); } catch {} process.exit(0); }, 60000);',
].join("\n");

function newRunState(id: string): RunState {
  return {
    id,
    agent: "tester",
    prompt: "keep running",
    sessionId: "session-" + id,
    status: "pending",
    finalText: "",
    textTail: "",
    thinkingTail: "",
    stderrTail: "",
    tools: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, ctxTokens: 0, turns: 0 },
  };
}

describe("runPi kill semantics (fake pi cli)", () => {
  it("aborts at maxTurns, kills the whole process tree, and reports paused exactly once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagent-fake-pi-"));
    const fake = join(dir, "fake-pi.cjs");
    const logFile = join(dir, "fake-pi.log");
    writeFileSync(fake, FAKE_PI_CJS);
    const prev = process.env.PI_CLI_JS;
    process.env.PI_CLI_JS = fake;
    try {
      const state = newRunState("max-turns");
      const t0 = Date.now();
      const r = await runPi(
        dir,
        "run 8 turns of bash",
        { maxTurns: 2, env: { FAKE_PI_LOG: logFile } },
        state,
        () => {},
      );
      const elapsed = Date.now() - t0;

      // Paused is reported immediately (not after the child happens to exit).
      expect(r.paused).toBe(true);
      expect(r.failed).toBe(false);
      expect(state.status).toBe("paused");
      expect(state.usage.turns).toBe(2);
      expect(elapsed).toBeLessThan(10_000);
      // Real turn count in the message, not the configured limit.
      expect(r.output).toContain("reached maximum limit of 2 turns (turns: 2)");
      expect(r.output).toContain('resume: "' + state.sessionId + '"');
      // Exactly one paused notification, no duplicate from close.
      expect(r.output.split("paused:").length - 1).toBe(1);

      // The child is really dead: log must stop growing.
      await new Promise((s) => setTimeout(s, 500));
      const snap = readFileSync(logFile, "utf-8");
      await new Promise((s) => setTimeout(s, 300));
      expect(readFileSync(logFile, "utf-8")).toBe(snap);
      expect(snap).toContain("turn 2");

      // Tree kill: the grandchild spawned by the fake CLI must be gone too.
      const gcLine = snap.split("\n").find((l) => l.startsWith("grandchild "));
      expect(gcLine).toBeDefined();
      const gcPid = Number(gcLine!.split(" ")[1]);
      expect(Number.isFinite(gcPid)).toBe(true);
      expect(() => process.kill(gcPid, 0)).toThrow();
    } finally {
      if (prev === undefined) delete process.env.PI_CLI_JS;
      else process.env.PI_CLI_JS = prev;
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }, 20000);

  it("times out after timeoutMs and reports paused with the elapsed duration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagent-fake-pi-"));
    const fake = join(dir, "fake-pi.cjs");
    const logFile = join(dir, "fake-pi.log");
    writeFileSync(fake, FAKE_PI_CJS);
    const prev = process.env.PI_CLI_JS;
    process.env.PI_CLI_JS = fake;
    try {
      const state = newRunState("timeout");
      const r = await runPi(
        dir,
        "long task",
        { timeoutMs: 400, env: { FAKE_PI_LOG: logFile } },
        state,
        () => {},
      );
      expect(r.paused).toBe(true);
      expect(state.status).toBe("paused");
      expect(state.pauseReason).toBe("timeout");
      // New text: actual elapsed (>= limit) plus the configured limit.
      expect(r.output).toMatch(/timed out after \d+ms \(limit: 400ms, turns: \d+\)/);
      expect(r.output.split("paused:").length - 1).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.PI_CLI_JS;
      else process.env.PI_CLI_JS = prev;
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }, 20000);

  // Regression (ff 108): on some Windows hosts the one-shot unref'd timeout
  // timer fires minutes-to-an-hour late. Simulate a lost timer by swallowing
  // every setTimeout >= 300ms while a subagent runs; the activity check and
  // the 1s watchdog interval must still enforce the deadline.
  it("enforces the timeout deadline even when the timeout timer never fires", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagent-fake-pi-"));
    const fake = join(dir, "fake-pi.cjs");
    const logFile = join(dir, "fake-pi.log");
    writeFileSync(fake, FAKE_PI_CJS);
    const prev = process.env.PI_CLI_JS;
    process.env.PI_CLI_JS = fake;

    const origSetTimeout = globalThis.setTimeout;
    // Wrapper that drops any one-shot timer with a delay >= 300ms — the 400ms
    // timeout timer never registers. Short timers (kill grace etc.) survive.
    const droppedSetTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
      if (ms !== undefined && ms >= 300) return origSetTimeout(() => {}, 0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (origSetTimeout as any)(fn, ms, ...rest);
    }) as typeof globalThis.setTimeout;
    globalThis.setTimeout = droppedSetTimeout as unknown as typeof setTimeout;
    try {
      const state = newRunState("timer-loss");
      const t0 = Date.now();
      const r = await runPi(
        dir,
        "long task with a lost timer",
        { timeoutMs: 400, env: { FAKE_PI_LOG: logFile } },
        state,
        () => {},
      );
      const elapsed = Date.now() - t0;

      expect(r.paused).toBe(true);
      expect(state.pauseReason).toBe("timeout");
      expect(state.status).toBe("paused");
      // Deadline enforced within watchdog granularity — not by child exit.
      expect(elapsed).toBeLessThan(10_000);
      expect(r.output).toMatch(/timed out after \d+ms \(limit: 400ms, turns: \d+\)/);
    } finally {
      globalThis.setTimeout = origSetTimeout;
      if (prev === undefined) delete process.env.PI_CLI_JS;
      else process.env.PI_CLI_JS = prev;
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }, 20000);
});

describe("resolvePiCli resolution paths", () => {
  let tmp = "";
  let savedArgv: string[] = [];
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedArgv = [...process.argv];
    savedEnv = { ...process.env };
    tmp = mkdtempSync(join(tmpdir(), "pi-subagent-cli-"));
  });

  afterEach(() => {
    process.argv = savedArgv;
    for (const k of ["PI_CLI_JS", "npm_config_prefix", "NPM_CONFIG_PREFIX", "APPDATA", "PATH", "Path"]) {
      delete process.env[k];
    }
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v !== undefined) process.env[k] = v;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  const disableLookupEnv = () => {
    delete process.env.PI_CLI_JS;
    process.env.npm_config_prefix = "";
    process.env.NPM_CONFIG_PREFIX = "";
    process.env.APPDATA = "";
    process.env.PATH = "";
  };

  it("matches the running argv even when pi runs from dist/bundle/cli.js", () => {
    const cliPath = join(tmp, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
    mkdirSync(dirname(cliPath), { recursive: true });
    writeFileSync(cliPath, "");
    disableLookupEnv();
    process.argv = [process.execPath, cliPath];
    const cli = resolvePiCli();
    expect(cli.command).toBe(process.execPath);
    expect(cli.args).toEqual([resolve(cliPath)]);
  });

  it("resolves version-manager PATH entries ending in .bin (mise-style layouts)", () => {
    const install = join(tmp, "installs", "npm-earendil-works-pi-coding-agent", "1.0.0");
    const cliPath = join(install, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
    mkdirSync(dirname(cliPath), { recursive: true });
    writeFileSync(cliPath, "");
    disableLookupEnv();
    process.argv = [process.execPath, "vitest"];
    process.env.PATH = join(install, "node_modules", ".bin");
    const cli = resolvePiCli();
    expect(cli.command).toBe(process.execPath);
    expect(cli.args).toEqual([resolve(cliPath)]);
  });

  it("still resolves the legacy dist/cli.js segment via APPDATA/npm", () => {
    const npmRoot = join(tmp, "npm");
    const cliPath = join(npmRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    mkdirSync(dirname(cliPath), { recursive: true });
    writeFileSync(cliPath, "");
    disableLookupEnv();
    process.argv = [process.execPath, "vitest"];
    process.env.APPDATA = tmp;
    const cli = resolvePiCli();
    expect(cli.command).toBe(process.execPath);
    expect(cli.args).toEqual([resolve(cliPath)]);
  });

  it("falls back to a bare pi command when nothing resolves", () => {
    disableLookupEnv();
    process.argv = [process.execPath, "vitest"];
    const cli = resolvePiCli();
    expect(cli).toEqual({ command: "pi", args: [] });
  });

  it("throws when PI_CLI_JS points at a missing file", () => {
    process.env.PI_CLI_JS = join(tmp, "nope.js");
    expect(() => resolvePiCli()).toThrow(/PI_CLI_JS missing/);
  });
});
