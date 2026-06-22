/**
 * Tests for the Task tool + /agents command registration and dispatch.
 *
 * Sibling modules (model/runner) are mocked so these tests exercise tools.ts in
 * isolation — they do not depend on those modules' real implementations.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "./types.js";

// --- Mocks for sibling modules ---------------------------------------------

vi.mock("./model.js", () => ({
	resolveModel: vi.fn(() => ({ model: undefined, modelId: "sonnet-test", provider: "anthropic" })),
}));

vi.mock("./runner.js", () => ({
	runSubagent: vi.fn(async (opts: { prompt: string; onProgress?: (progress: any) => void }) => {
		opts.onProgress?.({
			status: "running",
			activity: "read packages/foo.ts",
			modelId: "sonnet-test",
			provider: "anthropic",
			thinkingLevel: "high",
		});
		return {
			text: `ran: ${opts.prompt}`,
			modelId: "sonnet-test",
			provider: "anthropic",
			thinkingLevel: "high",
		};
	}),
}));

vi.mock("./config.js", () => ({
	readConfig: vi.fn(() => ({})),
	applyConfigOverrides: vi.fn((profile: AgentProfile) => profile),
	setAgentModel: vi.fn((_cfg: unknown, name: string, model: string) => ({ agents: { [name]: { model } } })),
	writeConfig: vi.fn(() => true),
	getConfigPath: vi.fn(() => "/cfg/byte-pi-subagent/config.json"),
}));

import { applyConfigOverrides, readConfig, setAgentModel, writeConfig } from "./config.js";
import { resolveModel } from "./model.js";
import { runSubagent } from "./runner.js";
import { type AgentsDeps, registerSubagentCommand, registerAgentTool } from "./tools.js";

// --- Fixtures ---------------------------------------------------------------

const PROFILES: AgentProfile[] = [
	{
		name: "explore",
		description: "Read-only explorer.\nSecond line ignored in listings.",
		systemPrompt: "You are an exploration subagent.",
		tools: ["read", "grep"],
		model: "inherit",
		source: "builtin",
	},
	{
		name: "custom",
		description: "A project agent.",
		systemPrompt: "x".repeat(900),
		model: "openai/gpt-test",
		thinking: "low",
		source: "project",
		filePath: "/proj/.pi/agents/custom.md",
	},
];

function makeDeps(): AgentsDeps {
	return {
		loadProfiles: vi.fn(() => ({
			profiles: new Map(PROFILES.map((p) => [p.name, p])),
			diagnostics: [],
		})),
	};
}

interface FakePi {
	tools: Map<string, any>;
	commands: Map<string, any>;
	registerTool(def: any): void;
	registerCommand(name: string, opts: any): void;
	getThinkingLevel(): string;
}

function makePi(): FakePi {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	return {
		tools,
		commands,
		registerTool: (def) => tools.set(def.name, def),
		registerCommand: (name, opts) => commands.set(name, opts),
		getThinkingLevel: () => "xhigh",
	};
}

function makeCtx() {
	return {
		cwd: "/proj",
		modelRegistry: {} as any,
		model: undefined,
		ui: { notify: vi.fn() },
	};
}

function plainTheme() {
	return {
		fg: (_name: string, value: string) => value,
		bold: (value: string) => value,
	};
}

function renderText(component: { render(width: number): string[] }): string {
	return component.render(200).join("\n");
}

/** Interactive ctx with a UI: `select` resolves to the option matching each predicate in order. */
function makeInteractiveCtx(picks: ((opts: string[]) => string | undefined)[]) {
	const select = vi.fn();
	for (const pick of picks) {
		select.mockImplementationOnce(async (_title: string, opts: string[]) => pick(opts));
	}
	return {
		cwd: "/proj",
		hasUI: true,
		model: undefined,
		modelRegistry: { getAvailable: () => [{ provider: "bytetrueapi", id: "deepseek-v4-flash" }] } as any,
		ui: { notify: vi.fn(), select },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

// --- Tests ------------------------------------------------------------------

describe("registerAgentTool", () => {
	it("registers a tool named 'task' with guidelines listing the agent types", () => {
		const pi = makePi();
		registerAgentTool(pi as any, makeDeps());
		const def = pi.tools.get("Agent");
		expect(def).toBeDefined();
		expect(def.promptGuidelines.join("\n")).toMatch(/explore/);
		// subagent_type description should enumerate discovered agents.
		expect(def.parameters.properties.subagent_type.description).toMatch(/explore/);
		// It must carry the FULL description (flattened), not just the first line,
		// so multi-line "use proactively"-style descriptions drive delegation.
		expect(def.parameters.properties.subagent_type.description).toMatch(/Second line ignored in listings\./);
	});

	it("runs the subagent and returns its final text + model details", async () => {
		const pi = makePi();
		registerAgentTool(pi as any, makeDeps());
		const def = pi.tools.get("Agent");
		const onUpdate = vi.fn();
		const res = await def.execute("id", { subagent_type: "explore", prompt: "find foo" }, undefined, onUpdate, makeCtx());
		expect(res.content[0].text).toBe("ran: find foo");
		expect(res.details).toMatchObject({ subagent_type: "explore", model: "sonnet-test", provider: "anthropic", thinking: "high" });
		expect(runSubagent).toHaveBeenCalledOnce();
		expect(applyConfigOverrides).toHaveBeenCalled();
		expect(readConfig).toHaveBeenCalled();
		expect(onUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				details: expect.objectContaining({
					activity: "read packages/foo.ts",
					model: "sonnet-test",
					provider: "anthropic",
					thinking: "high",
				}),
			}),
		);
		expect(vi.mocked(runSubagent).mock.calls[0]?.[0]).toMatchObject({ inheritedThinkingLevel: "xhigh" });
	});

	it("returns a clear error for an unknown subagent_type", async () => {
		const pi = makePi();
		registerAgentTool(pi as any, makeDeps());
		const def = pi.tools.get("Agent");
		const res = await def.execute("id", { subagent_type: "nope", prompt: "x" }, undefined, undefined, makeCtx());
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toMatch(/Unknown subagent_type "nope"/);
		expect(res.content[0].text).toMatch(/explore/);
		expect(runSubagent).not.toHaveBeenCalled();
	});
});

	it("renders partial progress with model, thinking, and latest activity", () => {
		const pi = makePi();
		registerAgentTool(pi as any, makeDeps());
		const def = pi.tools.get("Agent");
		const out = renderText(
			def.renderResult(
				{ details: { subagent_type: "explore", model: "sonnet-test", provider: "anthropic", thinking: "high", activity: "read packages/foo.ts" } },
				{ isPartial: true },
				plainTheme(),
				{},
			),
		);
		expect(out).toContain("explore");
		expect(out).toContain("anthropic/sonnet-test");
		expect(out).toContain("thinking high");
		expect(out).toContain("read packages/foo.ts");
		expect(out).not.toContain("Running subagent");
	});

	it("renders final result with model, thinking, and warnings", () => {
		const pi = makePi();
		registerAgentTool(pi as any, makeDeps());
		const def = pi.tools.get("Agent");
		const out = renderText(
			def.renderResult(
				{ details: { subagent_type: "explore", model: "sonnet-test", provider: "anthropic", thinking: "high", warning: "fallback" } },
				{ isPartial: false },
				plainTheme(),
				{},
			),
		);
		expect(out).toContain("Subagent finished");
		expect(out).toContain("anthropic/sonnet-test · thinking high");
		expect(out).toContain("fallback");
	});

describe("registerSubagentCommand", () => {
	it("lists all profiles via notify with --list", async () => {
		const pi = makePi();
		registerSubagentCommand(pi as any, makeDeps());
		const cmd = pi.commands.get("subagent");
		const ctx = makeCtx();
		await cmd.handler("--list", ctx);
		const out = (ctx.ui.notify as any).mock.calls[0][0] as string;
		expect(out).toMatch(/explore/);
		expect(out).toMatch(/custom/);
		expect(out).toMatch(/anthropic\/sonnet-test/);
		expect(resolveModel).toHaveBeenCalled();
		expect(out).toMatch(/thinking: inherit/);
	});

	it("explains how to list when run with no args and no UI", async () => {
		const pi = makePi();
		registerSubagentCommand(pi as any, makeDeps());
		const cmd = pi.commands.get("subagent");
		const ctx = makeCtx(); // no hasUI -> non-interactive
		await cmd.handler("", ctx);
		const out = (ctx.ui.notify as any).mock.calls[0][0] as string;
		expect(out).toMatch(/interactive/i);
		expect(out).toMatch(/--list/);
		expect(writeConfig).not.toHaveBeenCalled();
	});

	it("configures a subagent model interactively on no args", async () => {
		const pi = makePi();
		registerSubagentCommand(pi as any, makeDeps());
		const cmd = pi.commands.get("subagent");
		// 1st select: pick the explore profile; 2nd select: pick the deepseek model.
		const ctx = makeInteractiveCtx([
			(opts) => opts.find((o) => o.startsWith("explore")),
			(opts) => opts.find((o) => o.includes("deepseek")),
		]);
		await cmd.handler("", ctx);
		expect(setAgentModel).toHaveBeenCalledWith(expect.anything(), "explore", "bytetrueapi/deepseek-v4-flash");
		expect(writeConfig).toHaveBeenCalledOnce();
		const lastNotify = (ctx.ui.notify as any).mock.calls.at(-1)[0] as string;
		expect(lastNotify).toMatch(/deepseek-v4-flash/);
	});

	it("does not write when the model picker is cancelled", async () => {
		const pi = makePi();
		registerSubagentCommand(pi as any, makeDeps());
		const cmd = pi.commands.get("subagent");
		const ctx = makeInteractiveCtx([
			(opts) => opts.find((o) => o.startsWith("explore")),
			() => undefined, // cancel the model picker
		]);
		await cmd.handler("", ctx);
		expect(writeConfig).not.toHaveBeenCalled();
	});

	it("shows a single profile with --show <name>", async () => {
		const pi = makePi();
		registerSubagentCommand(pi as any, makeDeps());
		const cmd = pi.commands.get("subagent");
		const ctx = makeCtx();
		await cmd.handler("--show custom", ctx);
		const out = (ctx.ui.notify as any).mock.calls[0][0] as string;
		expect(out).toMatch(/Subagent: custom/);
		expect(out).toMatch(/\/proj\/\.pi\/agents\/custom\.md/);
		// long system prompt should be truncated with an ellipsis.
		expect(out).toMatch(/…/);
		expect(out).toMatch(/thinking: low/);
	});

	it("reports unknown name on --show", async () => {
		const pi = makePi();
		registerSubagentCommand(pi as any, makeDeps());
		const cmd = pi.commands.get("subagent");
		const ctx = makeCtx();
		await cmd.handler("--show ghost", ctx);
		const out = (ctx.ui.notify as any).mock.calls[0][0] as string;
		expect(out).toMatch(/No subagent named "ghost"/);
	});
});
