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
	type AgentSessionEvent,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { resolveModel } from "./model.js";
import type { AgentProfile, ThinkingLevel } from "./types.js";

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
	/** Parent-session thinking level used when the profile does not pin one. */
	inheritedThinkingLevel?: ThinkingLevel;
	/** Optional progress callback, invoked with compact structured status. */
	onProgress?: (progress: RunProgress) => void;
}

export type RunStatus = "starting" | "running" | "completed" | "error";

export interface RunProgress {
	status: RunStatus;
	activity: string;
	modelId: string;
	provider: string;
	thinkingLevel?: ThinkingLevel;
	warning?: string;
}

export interface RunResult {
	/** The subagent's final assistant message (verbatim). */
	text: string;
	/** Model id the subagent actually ran on. */
	modelId: string;
	/** Provider the subagent actually ran on. */
	provider: string;
	/** Thinking level the child session actually ran with. */
	thinkingLevel: ThinkingLevel;
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

function oneLine(value: string, max = 80): string {
	const s = value.replace(/\s+/g, " ").trim();
	return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function argSummary(args: unknown): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	const record = args as Record<string, unknown>;
	for (const key of ["path", "file", "command", "pattern", "query"]) {
		const value = record[key];
		if (typeof value !== "string" || !value.trim()) continue;
		const text = oneLine(value);
		return key === "pattern" || key === "query" ? `"${text}"` : text;
	}
	return undefined;
}

function describeTool(toolName: string, args?: unknown): string {
	const name = toolName.trim() || "tool";
	const summary = argSummary(args);
	return summary ? `${name} ${summary}` : name;
}

function turnActivity(ev: AgentSessionEvent, suffix: "started" | "complete"): string {
	const index = (ev as { turnIndex?: unknown }).turnIndex;
	return typeof index === "number" ? `turn ${index + 1} ${suffix}` : `turn ${suffix}`;
}

function progressFromEvent(
	ev: AgentSessionEvent,
	toolSummaries: Map<string, string>,
): Pick<RunProgress, "status" | "activity"> | undefined {
	switch (ev.type) {
		case "agent_start":
			return { status: "starting", activity: "started" };
		case "turn_start":
			return { status: "running", activity: turnActivity(ev, "started") };
		case "tool_execution_start": {
			const summary = describeTool(ev.toolName, ev.args);
			toolSummaries.set(ev.toolCallId, summary);
			return { status: "running", activity: `running ${summary}` };
		}
		case "tool_execution_end": {
			const summary = toolSummaries.get(ev.toolCallId) ?? describeTool(ev.toolName);
			toolSummaries.delete(ev.toolCallId);
			return { status: ev.isError ? "error" : "running", activity: `${summary} ${ev.isError ? "failed" : "done"}` };
		}
		case "turn_end":
			return { status: "running", activity: turnActivity(ev, "complete") };
		case "agent_end":
			return ev.willRetry
				? { status: "running", activity: "retrying" }
				: { status: "completed", activity: "completed" };
		default:
			return undefined;
	}
}

export async function runSubagent(opts: RunOptions): Promise<RunResult> {
	const { profile, ctx } = opts;

	// 1. Resolve the model spec (fail-soft: may return a fallback with a warning).
	const m = resolveModel(profile.model, ctx);
	let currentThinkingLevel: ThinkingLevel | undefined = profile.thinking ?? opts.inheritedThinkingLevel;

	const emit = (status: RunStatus, activity: string): void => {
		opts.onProgress?.({
			status,
			activity,
			modelId: m.modelId,
			provider: m.provider,
			...(currentThinkingLevel ? { thinkingLevel: currentThinkingLevel } : {}),
			...(m.warning ? { warning: m.warning } : {}),
		});
	};

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
			...(currentThinkingLevel ? { thinkingLevel: currentThinkingLevel } : {}),
			modelRegistry: ctx.modelRegistry,
			sessionManager: SessionManager.inMemory(ctx.cwd),
			resourceLoader: loader,
			excludeTools,
			...(tools ? { tools } : {}),
		});
		currentThinkingLevel = session.thinkingLevel as ThinkingLevel;
		emit("starting", "started");

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

		// 6. Forward compact lifecycle/tool progress, then run the prompt to
		//    completion and read the final assistant message.
		let unsub: (() => void) | undefined;
		if (opts.onProgress) {
			const toolSummaries = new Map<string, string>();
			unsub = session.subscribe((ev) => {
				const progress = progressFromEvent(ev, toolSummaries);
				if (progress) emit(progress.status, progress.activity);
			});
		}
		try {
			await session.prompt(opts.prompt);
			emit("completed", "completed");
		} finally {
			unsub?.();
			sig?.removeEventListener("abort", onAbort);
		}

		const text = session.getLastAssistantText() ?? "";
		const thinkingLevel = currentThinkingLevel ?? "medium";
		return { text, modelId: m.modelId, provider: m.provider, thinkingLevel, warning: m.warning };
	} catch (err) {
		// Surface a readable error to the caller (the task tool's execute wraps it).
		const reason = err instanceof Error ? err.message : String(err);
		emit("error", `failed: ${reason}`);
		throw new Error(`subagent "${profile.name}" failed: ${reason}`);
	}
}
