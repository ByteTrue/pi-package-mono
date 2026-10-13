import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import contextGuardDefault, {
	COMPACT_AT_TOKENS,
	registerContextGuard,
	sessionFileSection,
	shouldCompact,
} from "./pi-context-guard.js";

type Usage = { tokens: number | null; contextWindow: number };
type CompactCall = { onError?: (error: Error) => void };

function harness(opts: { usage?: Usage; sessionFile?: string } = {}) {
	const handlers: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
	const compactCalls: CompactCall[] = [];
	const pi = {
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			handlers[event] = handler;
		},
	} as unknown as ExtensionAPI;
	registerContextGuard(pi);
	const ctx = {
		getContextUsage: () => opts.usage,
		compact: (call: CompactCall) => compactCalls.push(call),
		sessionManager: { getSessionFile: () => opts.sessionFile },
	};
	return { handlers, compactCalls, ctx };
}

function beforeAgentStartEvent() {
	return {
		type: "before_agent_start" as const,
		prompt: "hi",
		images: undefined,
		systemPrompt: "system",
		systemPromptOptions: {
			cwd: "/tmp",
			selectedTools: [],
			hiddenTools: [],
			toolSnippets: {},
			toolGuidelines: {},
			promptGuidelines: [],
			appendSystemPrompt: "",
			sections: {} as Record<string, string>,
			contextFiles: [],
			skills: [],
		},
	};
}

describe("shouldCompact", () => {
	it("compacts past the threshold only for large-window models", () => {
		expect(shouldCompact({ tokens: COMPACT_AT_TOKENS + 1, contextWindow: COMPACT_AT_TOKENS + 1 })).toBe(true);
	});

	it("leaves small-window models on Pi's own policy", () => {
		expect(shouldCompact({ tokens: COMPACT_AT_TOKENS + 1, contextWindow: COMPACT_AT_TOKENS })).toBe(false);
		expect(shouldCompact({ tokens: COMPACT_AT_TOKENS + 1, contextWindow: 200_000 })).toBe(false);
	});

	it("does not compact at or below the threshold", () => {
		expect(shouldCompact({ tokens: COMPACT_AT_TOKENS, contextWindow: 1_000_000 })).toBe(false);
		expect(shouldCompact({ tokens: 1_000, contextWindow: 1_000_000 })).toBe(false);
	});

	it("treats unknown token counts as no signal", () => {
		expect(shouldCompact({ tokens: null, contextWindow: 1_000_000 })).toBe(false);
	});
});

describe("agent_settled", () => {
	it("compacts once usage passes the threshold on a large-window model", () => {
		const { handlers, compactCalls, ctx } = harness({ usage: { tokens: COMPACT_AT_TOKENS + 5_000, contextWindow: 1_000_000 } });
		handlers["agent_settled"]?.({}, ctx);
		expect(compactCalls).toHaveLength(1);
		expect(typeof compactCalls[0]?.onError).toBe("function");
	});

	it("does not compact below the threshold, on small windows, or without usage", () => {
		const below = harness({ usage: { tokens: 1_000, contextWindow: 1_000_000 } });
		below.handlers["agent_settled"]?.({}, below.ctx);
		expect(below.compactCalls).toHaveLength(0);

		const small = harness({ usage: { tokens: COMPACT_AT_TOKENS + 5_000, contextWindow: 200_000 } });
		small.handlers["agent_settled"]?.({}, small.ctx);
		expect(small.compactCalls).toHaveLength(0);

		const none = harness({});
		none.handlers["agent_settled"]?.({}, none.ctx);
		expect(none.compactCalls).toHaveLength(0);
	});
});

describe("before_agent_start", () => {
	it("points the system prompt at the session file", () => {
		const { handlers, ctx } = harness({ sessionFile: "/s/abc.jsonl" });
		const event = beforeAgentStartEvent();
		handlers["before_agent_start"]?.(event, ctx);
		expect(event.systemPromptOptions.sections.session_file).toBe(sessionFileSection("/s/abc.jsonl"));
		expect(event.systemPromptOptions.sections.session_file).toContain("/s/abc.jsonl");
	});

	it("leaves the prompt alone for ephemeral sessions without a file", () => {
		const { handlers, ctx } = harness({});
		const event = beforeAgentStartEvent();
		handlers["before_agent_start"]?.(event, ctx);
		expect(event.systemPromptOptions.sections.session_file).toBeUndefined();
	});
});

describe("module surface", () => {
	it("default export registers the same hooks", () => {
		const handlers: Record<string, unknown> = {};
		const pi = { on: (e: string, h: unknown) => { handlers[e] = h; } } as unknown as ExtensionAPI;
		contextGuardDefault(pi);
		expect(Object.keys(handlers).sort()).toEqual(["agent_settled", "before_agent_start"]);
	});
});
