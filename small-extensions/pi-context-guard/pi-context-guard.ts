// pi-context-guard
//
// Two context rules for Pi:
//
// 1. A model whose context window is larger than 400k tokens compacts once the
//    context passes 400k, instead of Pi's default "window - reserveTokens".
//    Models with a smaller window are not touched; Pi's default applies there.
//
// 2. The system prompt names the session file, which keeps every message even
//    after compaction replaces them in the model's view. So a detail a summary
//    dropped stays reachable, instead of having to be re-derived or guessed.
//
// Why the system prompt and not the compaction instructions: a summary is only
// as good as whatever produced it. Pi uses another extension's summary verbatim
// when one handles "session_before_compact", and custom instructions are never
// passed to it. The system prompt is unaffected by who compacts, or whether a
// compaction happened at all.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Compact once the context passes this many tokens — but only for models whose
 * window is larger, so small-window models keep Pi's own compaction policy. */
export const COMPACT_AT_TOKENS = 400_000;

/** The compaction decision: compact only when the model can hold more than the
 * threshold AND the current usage has passed it. `tokens` may be null (right
 * after a compaction, before the next response) — that counts as "don't know". */
export function shouldCompact(usage: { tokens: number | null; contextWindow: number }): boolean {
	if (usage.contextWindow <= COMPACT_AT_TOKENS) return false;
	if (usage.tokens === null) return false;
	return usage.tokens > COMPACT_AT_TOKENS;
}

/** The system-prompt pointer to the session file. Constant for the whole session,
 * so setting it on every before_agent_start stays inside the cached prefix. */
export function sessionFileSection(sessionFile: string): string {
	return (
		"This session's full history, including parts a compaction summary replaced, is kept " +
		"as JSONL at " + sessionFile + ". Search it when a summary lost a detail you need."
	);
}

export function registerContextGuard(pi: ExtensionAPI): void {
	pi.on("agent_settled", (_event, ctx) => {
		const usage = ctx.getContextUsage();
		if (!usage || !shouldCompact(usage)) return;
		ctx.compact({
			onError: (error) => console.error(`compaction failed: ${error.message}`),
		});
	});

	pi.on("before_agent_start", (event, ctx) => {
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (!sessionFile) return; // ephemeral session: there is no file to search
		event.systemPromptOptions.sections.session_file = sessionFileSection(sessionFile);
	});
}

export default function (pi: ExtensionAPI): void {
	registerContextGuard(pi);
}
