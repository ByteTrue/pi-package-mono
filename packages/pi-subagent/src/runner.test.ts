import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "./types.js";

// --- Mock the pi SDK so runSubagent can be exercised without a real session ----
const loaderCtor = vi.fn();
const sessionAbort = vi.fn(async () => {});
let lastSubscribe: ((ev: any) => void) | undefined;
// A gate so a test can keep prompt() in-flight while it fires the abort signal.
let releasePrompt: () => void = () => {};
const sessionPrompt = vi.fn(
	() =>
		new Promise<void>((resolve) => {
			releasePrompt = resolve;
		}),
);

vi.mock("@earendil-works/pi-coding-agent", () => ({
	DefaultResourceLoader: class {
		constructor(opts: unknown) {
			loaderCtor(opts);
		}
		async reload() {}
	},
	SessionManager: { inMemory: () => ({}) },
	createAgentSession: vi.fn(async (opts: { thinkingLevel?: string } = {}) => ({
		session: {
			thinkingLevel: opts.thinkingLevel ?? "medium",
			prompt: sessionPrompt,
			abort: sessionAbort,
			getLastAssistantText: () => "final answer",
			subscribe: (fn: (ev: any) => void) => {
				lastSubscribe = fn;
				return () => {};
			},
		},
	})),
}));

// Model resolution is covered elsewhere; stub it to a fixed result here.
vi.mock("./model.js", () => ({
	resolveModel: () => ({ model: undefined, modelId: "m1", provider: "anthropic" }),
}));

import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { buildToolSelection, runSubagent, type RunProgress } from "./runner.js";

function makeCtx(signal?: AbortSignal) {
	return { cwd: "/repo", modelRegistry: {}, model: undefined, signal } as never;
}

/** Minimal profile factory — only the tool fields matter for buildToolSelection. */
function profile(over: Partial<AgentProfile> = {}): AgentProfile {
	return {
		name: "explore",
		description: "test",
		systemPrompt: "do the thing",
		source: "builtin",
		...over,
	};
}

describe("buildToolSelection", () => {
	it("always excludes the Agent tool to block nested subagents", () => {
		const sel = buildToolSelection(profile());
		expect(sel.excludeTools).toContain("Agent");
	});

	it("leaves tools undefined when the profile names no allowlist", () => {
		const sel = buildToolSelection(profile({ tools: undefined }));
		expect(sel.tools).toBeUndefined();
		expect(sel.excludeTools).toEqual(["Agent"]);
	});

	it("treats an empty allowlist as 'inherit defaults' (tools undefined)", () => {
		const sel = buildToolSelection(profile({ tools: [] }));
		expect(sel.tools).toBeUndefined();
	});

	it("uses a non-empty allowlist as the tools whitelist", () => {
		const sel = buildToolSelection(profile({ tools: ["read", "grep", "find", "ls"] }));
		expect(sel.tools).toEqual(["read", "grep", "find", "ls"]);
		expect(sel.excludeTools).toContain("Agent");
	});

	it("strips the Agent tool from the allowlist defensively", () => {
		const sel = buildToolSelection(profile({ tools: ["read", "Agent", "grep"] }));
		expect(sel.tools).toEqual(["read", "grep"]);
		expect(sel.tools).not.toContain("Agent");
	});

	it("merges disallowedTools into excludeTools (deduped, alongside task)", () => {
		const sel = buildToolSelection(profile({ disallowedTools: ["bash", "write"] }));
		expect(sel.excludeTools).toEqual(expect.arrayContaining(["Agent", "bash", "write"]));
		expect(sel.excludeTools).toHaveLength(3);
	});

	it("dedupes a disallowedTools entry that repeats the Agent tool", () => {
		const sel = buildToolSelection(profile({ disallowedTools: ["Agent", "bash"] }));
		expect(sel.excludeTools).toEqual(["Agent", "bash"]);
	});

	it("trims and drops blank entries in both lists", () => {
		const sel = buildToolSelection(
			profile({ tools: [" read ", "", "  "], disallowedTools: [" bash ", ""] }),
		);
		expect(sel.tools).toEqual(["read"]);
		expect(sel.excludeTools).toEqual(["Agent", "bash"]);
	});
});

describe("runSubagent", () => {
	beforeEach(() => {
		loaderCtor.mockClear();
		sessionAbort.mockClear();
		sessionPrompt.mockClear();
		lastSubscribe = undefined;
		releasePrompt = () => {};
	});
	afterEach(() => vi.clearAllMocks());

	/** Let the microtask queue drain (safeAbort schedules abort() via Promise.resolve). */
	async function flush() {
		await Promise.resolve();
		await Promise.resolve();
	}

	it("builds the loader with the persona as the REPLACE system prompt, loading extensions but not skills", async () => {
		const run = runSubagent({
			profile: profile({ systemPrompt: "You are read-only." }),
			prompt: "do it",
			ctx: makeCtx(),
		});
		await flush();
		releasePrompt();
		await run;

		expect(loaderCtor).toHaveBeenCalledOnce();
		const opts = loaderCtor.mock.calls[0]?.[0] as Record<string, unknown>;
		// Persona must REPLACE pi's base prompt, not be appended to it.
		expect(opts.systemPrompt).toBe("You are read-only.");
		expect(opts.appendSystemPrompt).toBeUndefined();
		// Extensions ARE loaded so subagents can reach other extension tools (e.g. web_search);
		// recursion is blocked via excludeTools, not by disabling extensions. Skills stay off (lean context).
		expect(opts.noExtensions).toBeUndefined();
		expect(opts.noSkills).toBe(true);
	});

	it("returns the subagent's final text and resolved model details", async () => {
		const run = runSubagent({ profile: profile(), prompt: "x", ctx: makeCtx() });
		await flush();
		releasePrompt();
		const res = await run;
		expect(res.text).toBe("final answer");
		expect(res.modelId).toBe("m1");
		expect(res.provider).toBe("anthropic");
		expect(res.thinkingLevel).toBe("medium");
	});

	it("passes profile thinking to createAgentSession and returns it", async () => {
		const run = runSubagent({ profile: profile({ thinking: "low" }), prompt: "x", ctx: makeCtx(), inheritedThinkingLevel: "xhigh" });
		await flush();
		releasePrompt();
		const res = await run;
		const opts = vi.mocked(createAgentSession).mock.calls.at(-1)?.[0] as Record<string, unknown>;
		expect(opts.thinkingLevel).toBe("low");
		expect(res.thinkingLevel).toBe("low");
	});

	it("inherits the parent thinking level when the profile does not set one", async () => {
		const run = runSubagent({ profile: profile(), prompt: "x", ctx: makeCtx(), inheritedThinkingLevel: "xhigh" });
		await flush();
		releasePrompt();
		await run;
		const opts = vi.mocked(createAgentSession).mock.calls.at(-1)?.[0] as Record<string, unknown>;
		expect(opts.thinkingLevel).toBe("xhigh");
	});

	it("emits compact lifecycle and tool progress", async () => {
		const progress: RunProgress[] = [];
		const run = runSubagent({
			profile: profile(),
			prompt: "x",
			ctx: makeCtx(),
			inheritedThinkingLevel: "high",
			onProgress: (p) => progress.push(p),
		});
		await flush();
		lastSubscribe?.({ type: "agent_start" });
		lastSubscribe?.({ type: "turn_start", turnIndex: 0 });
		lastSubscribe?.({ type: "tool_execution_start", toolCallId: "1", toolName: "read", args: { path: "packages/foo.ts" } });
		lastSubscribe?.({ type: "tool_execution_end", toolCallId: "1", toolName: "read", result: {}, isError: false });
		lastSubscribe?.({ type: "turn_end", turnIndex: 0, message: {}, toolResults: [] });
		lastSubscribe?.({ type: "agent_end", messages: [], willRetry: false });
		releasePrompt();
		await run;
		expect(progress.map((p) => p.activity)).toEqual(
			expect.arrayContaining([
				"started",
				"turn 1 started",
				"running read packages/foo.ts",
				"read packages/foo.ts done",
				"turn 1 complete",
				"completed",
			]),
		);
		expect(progress.at(-1)).toMatchObject({ modelId: "m1", provider: "anthropic", thinkingLevel: "high" });
	});

	it("aborts the child session when the signal fires mid-run", async () => {
		const ac = new AbortController();
		const run = runSubagent({ profile: profile(), prompt: "x", ctx: makeCtx(), signal: ac.signal });
		await flush();
		ac.abort(); // fire while prompt() is still in flight
		await flush();
		expect(sessionAbort).toHaveBeenCalled();
		releasePrompt();
		await run;
	});

	it("aborts immediately when the signal is already aborted before running", async () => {
		const ac = new AbortController();
		ac.abort();
		const run = runSubagent({ profile: profile(), prompt: "x", ctx: makeCtx(), signal: ac.signal });
		await flush();
		expect(sessionAbort).toHaveBeenCalled();
		releasePrompt();
		await run;
	});

	it("falls back to ctx.signal when no explicit signal is passed", async () => {
		const ac = new AbortController();
		const run = runSubagent({ profile: profile(), prompt: "x", ctx: makeCtx(ac.signal) });
		await flush();
		ac.abort();
		await flush();
		expect(sessionAbort).toHaveBeenCalled();
		releasePrompt();
		await run;
	});
});
