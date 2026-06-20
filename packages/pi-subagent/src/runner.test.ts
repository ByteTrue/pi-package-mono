import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "./types.js";

// --- Mock the pi SDK so runSubagent can be exercised without a real session ----
const loaderCtor = vi.fn();
const sessionAbort = vi.fn(async () => {});
let lastSubscribe: ((ev: { type: string }) => void) | undefined;
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
	createAgentSession: vi.fn(async () => ({
		session: {
			prompt: sessionPrompt,
			abort: sessionAbort,
			getLastAssistantText: () => "final answer",
			subscribe: (fn: (ev: { type: string }) => void) => {
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

import { buildToolSelection, runSubagent } from "./runner.js";

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
