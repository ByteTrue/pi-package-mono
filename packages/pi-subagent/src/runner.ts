/**
 * Run a subagent in an isolated, in-memory session.
 *
 * Builds a fresh session for the given profile: resolves its model, computes its
 * tool whitelist, injects its system prompt, runs the prompt to completion, and
 * returns only the final assistant message. The child session shares the parent's
 * ModelRegistry (so credentials are reused) but is otherwise fully isolated — it
 * sees none of the main conversation history.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { resolveModel } from "./model.js";
import type { AgentProfile } from "./types.js";

/** The Agent tool's own name. A child must never be able to call it (no nested subagents). */
const AGENT_TOOL_NAME = "Agent";

export interface RunOptions {
	/** The resolved profile to run. */
	profile: AgentProfile;
	/** The task prompt handed to the subagent (its only input). */
	prompt: string;
	/** The calling tool's extension context (for modelRegistry, cwd, model, ui). */
	ctx: ExtensionContext;
	/** Optional cancellation signal. */
	signal?: AbortSignal;
	/** Optional progress callback, invoked with human-readable status text. */
	onProgress?: (text: string) => void;
}

export interface RunResult {
	/** The subagent's final assistant message (verbatim). */
	text: string;
	/** Model id the subagent actually ran on. */
	modelId: string;
	/** Provider the subagent actually ran on. */
	provider: string;
	/** Set when the requested model could not be honored and a fallback was used. */
	warning?: string;
}

/** The tool-set knobs passed to `createAgentSession`, computed from a profile. */
export interface ToolSelection {
	/** Allowlist of tool names; omitted (undefined) means "inherit pi's defaults". */
	tools?: string[];
	/** Denylist of tool names; always contains the task tool to block recursion. */
	excludeTools: string[];
}

/**
 * Translate a profile's `tools` / `disallowedTools` into `createAgentSession`
 * tool knobs. Pure (no I/O) so it can be unit-tested in isolation.
 *
 * Rules:
 *   - `excludeTools` ALWAYS contains the task tool, so a subagent can never spawn
 *     another subagent (we don't support nesting this phase). The profile's
 *     `disallowedTools` are merged in (deduped).
 *   - When `profile.tools` is a non-empty allowlist, it becomes `tools`. The task
 *     tool is stripped from the allowlist defensively — an allowlist that doesn't
 *     list `task` already excludes it, and we never want to re-enable it.
 *   - When `profile.tools` is omitted/empty, `tools` is left undefined so pi keeps
 *     its default tool set (minus whatever `excludeTools` removes).
 */
export function buildToolSelection(profile: AgentProfile): ToolSelection {
	// Denylist: task is always excluded; append the profile's own denylist, deduped.
	const exclude = new Set<string>([AGENT_TOOL_NAME]);
	for (const t of profile.disallowedTools ?? []) {
		const name = t.trim();
		if (name.length > 0) exclude.add(name);
	}
	const excludeTools = [...exclude];

	// Allowlist: only when the profile names specific tools. Never list the task tool.
	const allow = (profile.tools ?? []).map((t) => t.trim()).filter((t) => t.length > 0 && t !== AGENT_TOOL_NAME);
	if (allow.length === 0) return { excludeTools };
	return { tools: allow, excludeTools };
}

export async function runSubagent(opts: RunOptions): Promise<RunResult> {
	const { profile, ctx } = opts;

	// 1. Resolve the model spec (fail-soft: may return a fallback with a warning).
	const m = resolveModel(profile.model, ctx);

	// 2. Compute the tool set: task is always excluded; honor the profile's
	//    allowlist/denylist on top of that.
	const { tools, excludeTools } = buildToolSelection(profile);

	try {
		// 3. Build a resource loader whose system prompt IS the agent's body, mirroring
		//    Claude Code: the subagent receives ONLY this persona (plus basic
		//    environment details), not pi's full default coding-agent prompt. Using
		//    `systemPrompt` (replace) rather than `appendSystemPrompt` keeps a
		//    read-only persona like explore/plan authoritative instead of subordinate
		//    to pi's generic "edit/run commands" base. Extensions ARE loaded so a
		//    subagent can still reach other extension tools (e.g. web_search), matching
		//    Claude Code's general-purpose "full tool set"; recursion is blocked by
		//    excludeTools (task), not by disabling extensions. `noSkills` keeps the
		//    child's context lean (skills are context, not tools).
		const loader = new DefaultResourceLoader({
			cwd: ctx.cwd,
			agentDir: join(homedir(), ".pi", "agent"),
			systemPrompt: profile.systemPrompt,
			noSkills: true,
		});
		await loader.reload();

		// 4. Create an isolated, in-memory session sharing the parent's model
		//    registry (so credentials/providers are reused) but no history.
		const { session } = await createAgentSession({
			cwd: ctx.cwd,
			model: m.model,
			modelRegistry: ctx.modelRegistry,
			sessionManager: SessionManager.inMemory(ctx.cwd),
			resourceLoader: loader,
			excludeTools,
			...(tools ? { tools } : {}),
		});

		// 5. Wire cancellation: PromptOptions has no signal field, so the only way to
		//    stop an in-flight subagent is session.abort(). Bridge the parent's signal
		//    (the tool's own `signal`, falling back to ctx.signal) to abort(), so a
		//    cancelled Task / RPC stops the child instead of burning tokens. Fail-soft.
		const sig = opts.signal ?? ctx.signal;
		const safeAbort = (): void => {
			void Promise.resolve()
				.then(() => session.abort())
				.catch(() => {});
		};
		// If already aborted before we even start, stop the child immediately.
		if (sig?.aborted) safeAbort();
		const onAbort = (): void => safeAbort();
		sig?.addEventListener("abort", onAbort, { once: true });

		// 6. Optionally forward coarse progress (one tick per agent turn end), then
		//    run the prompt to completion and read the final assistant message.
		let unsub: (() => void) | undefined;
		if (opts.onProgress) {
			unsub = session.subscribe((ev) => {
				if (ev.type === "agent_end") opts.onProgress?.(`${profile.name}: turn complete`);
			});
		}
		try {
			await session.prompt(opts.prompt);
		} finally {
			unsub?.();
			sig?.removeEventListener("abort", onAbort);
		}

		const text = session.getLastAssistantText() ?? "";
		return { text, modelId: m.modelId, provider: m.provider, warning: m.warning };
	} catch (err) {
		// Surface a readable error to the caller (the task tool's execute wraps it).
		const reason = err instanceof Error ? err.message : String(err);
		throw new Error(`subagent "${profile.name}" failed: ${reason}`);
	}
}
