import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import codemodeOnly, {
  onlyModeActive,
  onlyModeBlockReason,
  registerCodemodeOnly,
  rewritePromptSections,
  SKILLS_SENTENCE,
  SKILLS_VIA_CODEMODE,
  TOOLS_INSTRUCTION,
  TOOLS_TAIL,
} from "./pi-codemode-only.js";

type OnlyPi = Parameters<typeof onlyModeActive>[0];
type ToolCallEvent = { toolName: string; parentToolCallId?: string };
type BlockResult = { block: boolean; reason: string };
type BeforeStartEvent = { systemPrompt: string; systemPromptOptions: { sections: Record<string, string> } };

function onlyPi(mode?: string, activeTools: string[] = ["codemode", "bash", "read"]): OnlyPi {
	return {
		getSettings: () => ({ codemode: { mode } }),
		getActiveTools: () => activeTools,
	};
}

function harness(mode?: string) {
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	const pi = {
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			handlers[event] = handler;
		},
		getSettings: () => ({ codemode: { mode } }),
		getActiveTools: () => ["codemode", "bash", "read"],
	} as unknown as ExtensionAPI;
	registerCodemodeOnly(pi);
	return handlers;
}

const toolCall = (toolName: string, parentToolCallId?: string): ToolCallEvent =>
	({ toolName, parentToolCallId });

const promptEvent = (): BeforeStartEvent => ({
	systemPrompt: [
		"<tools>",
		"read, bash, edit, write",
		TOOLS_TAIL,
		"</tools>",
		"<skills>",
		"Use the read tool to load a skill's file when the task matches its description.",
		"</skills>",
	].join("\n"),
	systemPromptOptions: { sections: {} },
});

describe("onlyModeActive", () => {
	it("is on only when mode is only and codemode is active", () => {
		expect(onlyModeActive(onlyPi("only"))).toBe(true);
		expect(onlyModeActive(onlyPi(undefined))).toBe(false);
		expect(onlyModeActive(onlyPi("default"))).toBe(false);
		expect(onlyModeActive(onlyPi("only", ["bash", "read"]))).toBe(false);
		expect(onlyModeActive({})).toBe(false);
	});
});

describe("onlyModeBlockReason", () => {
	it("blocks top-level non-codemode calls with the codemode form", () => {
		const reason = onlyModeBlockReason("bash", {});
		expect(reason).toContain("bash is not directly callable");
		expect(reason).toContain("await tools.bash({ ... })");
	});

	it("lets codemode itself and nested script calls through", () => {
		expect(onlyModeBlockReason("codemode", {})).toBeUndefined();
		expect(onlyModeBlockReason("bash", { parentToolCallId: "t0" })).toBeUndefined();
	});
});

describe("tool_call hook", () => {
	it("blocks direct calls in only-mode", () => {
		const handlers = harness("only");
		const result = handlers["tool_call"]?.(toolCall("bash"), {}) as BlockResult;
		expect(result.block).toBe(true);
		expect(result.reason).toContain("codemode-only mode");
	});

	it("passes nested calls and codemode, and is inert outside only-mode", () => {
		const handlers = harness("only");
		expect(handlers["tool_call"]?.(toolCall("read", "t0"), {})).toBeUndefined();
		expect(handlers["tool_call"]?.(toolCall("codemode"), {})).toBeUndefined();
		const off = harness("default");
		expect(off["tool_call"]?.(toolCall("bash"), {})).toBeUndefined();
	});
});

describe("before_agent_start hook", () => {
	it("rewrites the tools tail and the skills line in only-mode", () => {
		const handlers = harness("only");
		const event = promptEvent();
		handlers["before_agent_start"]?.(event, {});
		expect(event.systemPromptOptions.sections.tools).toBe([
			"read, bash, edit, write",
			TOOLS_INSTRUCTION,
		].join("\n"));
		expect(event.systemPromptOptions.sections.skills).toBe(SKILLS_VIA_CODEMODE);
	});

	it("leaves sections alone when markers are absent or mode is off", () => {
		const handlers = harness("only");
		const bare = { systemPrompt: "no tags here", systemPromptOptions: { sections: {} as Record<string, string> } };
		handlers["before_agent_start"]?.(bare, {});
		expect(bare.systemPromptOptions.sections.tools).toBeUndefined();
		expect(bare.systemPromptOptions.sections.skills).toBeUndefined();
		const off = harness("default");
		const event = promptEvent();
		off["before_agent_start"]?.(event, {});
		expect(event.systemPromptOptions.sections.tools).toBeUndefined();
	});
});

describe("rewritePromptSections", () => {
	it("replaces only the tail line inside <tools>", () => {
		const sections: Record<string, string> = {};
		rewritePromptSections(promptEvent().systemPrompt, sections);
		expect(sections.tools).toContain("read, bash, edit, write");
		expect(sections.tools).not.toContain(TOOLS_TAIL);
	});

	it("SKILLS_SENTENCE matches both known wordings only", () => {
		expect(SKILLS_SENTENCE.test("Load a skill's file when the task matches its description.")).toBe(true);
		expect(SKILLS_SENTENCE.test("Use the read tool to load a skill's file when the task matches its description.")).toBe(true);
		expect(SKILLS_SENTENCE.test("Load skill files through the codemode tool.")).toBe(false);
	});
});

describe("module surface", () => {
	it("default export registers both hooks", () => {
		const handlers: Record<string, unknown> = {};
		const pi = { on: (e: string, h: unknown) => { handlers[e] = h; } } as unknown as ExtensionAPI;
		codemodeOnly(pi);
		expect(Object.keys(handlers).sort()).toEqual(["before_agent_start", "tool_call"]);
	});
});
