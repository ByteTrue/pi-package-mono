import { describe, it, expect } from "vitest";
import {
  parseJsonEvent,
  applyEvent,
  resolveRunCfg,
  buildPiArgs,
  parseAgentFile,
  findAgentDefinition,
  resolvePiCli,
  type RunState,
  type JsonObject,
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

  it("resolves run config with thinking and model overrides", () => {
    const cfg = resolveRunCfg(
      { model: "openai/gpt-4o:low", tools: ["read", "grep"] },
      { model: "claude-3-5-sonnet", thinking: "high" },
      "medium",
      "inherited-model",
    );
    expect(cfg.model).toBe("openai/gpt-4o:low");
    expect(cfg.thinking).toBe("low");
    expect(cfg.tools).toEqual(["read", "grep"]);

    const args = buildPiArgs(cfg);
    expect(args).toContain("--mode");
    expect(args).toContain("json");
    expect(args).toContain("-p");
    expect(args).toContain("--no-session");
    expect(args).toContain("--model");
    expect(args).toContain("openai/gpt-4o:low");
    expect(args).toContain("--tools");
    expect(args).toContain("read,grep");
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

    // 3. Direct tool call parameter takes highest precedence
    const directCfg = resolveRunCfg(
      { agent: "researcher", model: "custom-model:low", thinking: "off" },
      {},
      "high",
      "parent-model",
      settings,
    );
    expect(directCfg.model).toBe("custom-model");
    expect(directCfg.thinking).toBe("off");
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

  it("resolves pi cli executable cleanly", () => {
    const cli = resolvePiCli();
    expect(cli.command).toBeDefined();
    expect(Array.isArray(cli.args)).toBe(true);
  });
});
