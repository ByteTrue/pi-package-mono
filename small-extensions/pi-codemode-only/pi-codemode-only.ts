/**
 * pi-codemode-only — codemode "only" companion.
 *
 * Pi 0.99.2 hides direct-exposure tools from request declarations and from the
 * <tools> section on its own, and rejects top-level calls to them ("Tool read
 * not found"). Two prompt spots still point the model at those tools:
 *   1. the <tools> tail line "In addition to the tools above, ...",
 *   2. the <skills> line "Use the read tool to load a skill's file...".
 *
 * So: say in <tools> that everything else runs from inside a codemode script,
 * and point the skills line at codemode. No-op unless codemode.mode === "only".
 * <rules> is left alone on purpose.
 *
 * Pi 1.1.0 no longer *enforces* only-mode: direct tools stay active (so codemode
 * scripts can call them) and the top-level execution pool is the active set, so a
 * model that ignores the prompt can still call bash/read/... directly and the call
 * runs. Enforce it here: block top-level tool_call to anything but codemode.
 * Nested calls from scripts carry parentToolCallId and pass through.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** The <tools> tail line Pi appends when custom tools exist. If a core release
 * rewords it, the rewrite silently stops — prompt honesty degrades, but the
 * tool_call block below still enforces only-mode. Re-align on upgrade. */
export const TOOLS_TAIL =
	"In addition to the tools above, you may have access to other custom tools depending on the project.";

/** What the tail line becomes in only-mode. */
export const TOOLS_INSTRUCTION =
	"Only the tools listed above are called directly. Everything else runs from inside a codemode " +
	"script: await tools.<name>({ ... }). One script can make several calls at once.";

/** The skills line Pi ships, in either of its two known wordings. */
export const SKILLS_SENTENCE = /(?:Use (?:the read tool|bash) to )?[Ll]oad a skill's file when the task matches its description\./;

/** What the skills line becomes in only-mode. */
export const SKILLS_VIA_CODEMODE =
	"Load skill files through the codemode tool when the task matches their descriptions; " +
	"one script can read several at once, e.g. await Promise.all(paths.map((path) => tools.read({ path }))).";

/** Only-mode gate: codemode.mode is "only" AND codemode itself is active. Structural
 * parameter type on purpose — the file must stay loadable with only a type import.
 * Optional chaining covers Pi builds where either accessor is absent. */
export function onlyModeActive(pi: {
	getSettings?: () => { codemode?: { mode?: string } };
	getActiveTools?: () => string[];
}): boolean {
	if (pi.getSettings?.().codemode?.mode !== "only") return false;
	const active = pi.getActiveTools?.();
	if (Array.isArray(active) && !active.includes("codemode")) return false;
	return true;
}

/** The tool_call verdict for a top-level call in only-mode: block everything that
 * is not codemode itself. Nested calls from scripts (parentToolCallId set) pass. */
export function onlyModeBlockReason(toolName: string, opts: { parentToolCallId?: string }): string | undefined {
	if (opts.parentToolCallId) return undefined;
	if (toolName === "codemode") return undefined;
	return (
		`${toolName} is not directly callable in codemode-only mode. ` +
		`Call it from inside a codemode script instead: await tools.${toolName}({ ... }).`
	);
}

/** Rewrites the two prompt spots for only-mode. sections is the normalized,
 * collection-complete record exposed on before_agent_start events. */
export function rewritePromptSections(
	systemPrompt: string,
	sections: Record<string, string>,
): void {
	const tools = systemPrompt.match(/<tools>\n([\s\S]*?)\n<\/tools>/)?.[1];
	if (tools !== undefined) sections.tools = tools.replace(TOOLS_TAIL, TOOLS_INSTRUCTION);

	const skills = systemPrompt.match(/<skills>\n([\s\S]*?)\n<\/skills>/)?.[1];
	if (skills !== undefined && SKILLS_SENTENCE.test(skills)) {
		sections.skills = skills.replace(SKILLS_SENTENCE, SKILLS_VIA_CODEMODE);
	}
}

export function registerCodemodeOnly(pi: ExtensionAPI): void {
	pi.on("tool_call", (event) => {
		if (!onlyModeActive(pi)) return;
		const reason = onlyModeBlockReason(event.toolName, event);
		if (!reason) return;
		return { block: true, reason };
	});

	pi.on("before_agent_start", (event) => {
		if (!onlyModeActive(pi)) return;
		rewritePromptSections(event.systemPrompt, event.systemPromptOptions.sections);
	});
}

export default function (pi: ExtensionAPI): void {
	registerCodemodeOnly(pi);
}
