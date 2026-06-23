/**
 * The `Agent` tool and the `/subagent` command.
 *
 * `Agent` is the single delegation entry point (matching Claude Code's tool
 * name): the main agent calls it with a `subagent_type` and a `prompt`, and gets
 * back only the subagent's final message. `/subagent` lists/inspects/configures
 * the available subagents.
 *
 * Both receive `AgentsDeps` carrying a `loadProfiles` function (rather than a
 * prebuilt map) so they re-discover profiles per `ctx.cwd` at call time —
 * project-level agents depend on the working directory.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { applyConfigOverrides, getConfigPath, readConfig, setAgentModel, writeConfig } from "./config.js";
import type { LoadProfilesResult } from "./loader.js";
import { resolveModel } from "./model.js";
import { type RunProgress, runSubagent } from "./runner.js";
import type { AgentProfile, ThinkingLevel } from "./types.js";

/** Shared dependencies wired by index.ts so tools and commands stay in sync. */
export interface AgentsDeps {
	/** Discover effective profiles for a given working directory. */
	loadProfiles: (cwd: string) => LoadProfilesResult;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const AGENT_TOOL_NAME = "Agent";
const SUBAGENT_COMMAND_NAME = "subagent";
const LIST_FLAG = "--list";
const SHOW_FLAG = "--show";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_MS = 120;
/** Cap the inline system-prompt preview printed by `/subagent --show`. */
const SYSTEM_PROMPT_PREVIEW_CHARS = 400;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** First line of a (possibly multi-line) description, trimmed for compact listing. */
function firstLine(text: string): string {
	const line = text.split("\n", 1)[0] ?? "";
	return line.trim();
}

/**
 * Full description flattened to a single line for the routing schema. Claude Code
 * drives delegation off the WHOLE `description` (trigger conditions, "use
 * proactively", etc.), so we must not truncate it here — we only collapse runs of
 * whitespace/newlines so it fits a one-line schema entry.
 */
function flattenDescription(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Human-readable origin tag for a profile. */
function sourceLabel(profile: AgentProfile): string {
	switch (profile.source) {
		case "project":
			return "project";
		case "user":
			return "user";
		default:
			return "built-in";
	}
}

/** Compact description of a profile's tool set for listings. */
function toolsLabel(profile: AgentProfile): string {
	if (!profile.tools) return "all tools (inherited)";
	if (profile.tools.length === 0) return "no tools";
	return profile.tools.join(", ");
}

function thinkingLabel(profile: AgentProfile): string {
	const merged = applyConfigOverrides(profile, readConfig());
	return merged.thinking ?? "inherit";
}

/**
 * Best-effort resolved model string for display, e.g. "anthropic/claude-...".
 * Never throws: model resolution is fail-soft and only used for reporting here.
 */
function resolvedModelLabel(profile: AgentProfile, deps: ResolveDeps): string {
	const merged = applyConfigOverrides(profile, readConfig());
	try {
		const res = resolveModel(merged.model, deps.ctx);
		const base = `${res.provider}/${res.modelId}`;
		return res.warning ? `${base} (${res.warning})` : base;
	} catch {
		return merged.model ?? "inherit";
	}
}

interface ResolveDeps {
	ctx: Parameters<typeof resolveModel>[1];
}

/** Sorted profile list with built-ins last, so custom agents surface first. */
function listProfiles(profiles: Map<string, AgentProfile>): AgentProfile[] {
	const rank = (p: AgentProfile): number => (p.source === "project" ? 0 : p.source === "user" ? 1 : 2);
	return [...profiles.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Agent tool
// ---------------------------------------------------------------------------

const AGENT_SNIPPET = "Delegate a self-contained task to an isolated specialist subagent";

/**
 * Proactive-delegation guidance, modeled on Claude Code's Agent tool. This is the
 * primary lever against pain point #1 (the main agent never delegating on its
 * own): it tells the model *when* to reach for a subagent and *how* to write a
 * self-contained prompt for one.
 */
const AGENT_GUIDELINES: string[] = [
	"Prefer delegating to a subagent over doing large investigative or multi-step work yourself. Subagents run in parallel context, keep your own context clean, and can use a cheaper/faster model.",
	'Use subagent_type "explore" when you need to FIND or UNDERSTAND code — locating files, tracing how a feature works, answering "where is X" / "how does Y work". It is read-only and fast.',
	'Use subagent_type "plan" when you need a concrete implementation plan (which files to change, in what order, with what risks) BEFORE touching code. It is read-only.',
	'Use subagent_type "general-purpose" for open-ended, multi-step work that needs both investigation AND edits, or when no more specific agent fits.',
	"When a task matches a specialist agent (see subagent_type options), delegate to it rather than hand-rolling the work — that is the whole point of having the agent.",
	"Delegate proactively: if a request would take you several rounds of searching/reading, hand it to explore first and act on its findings.",
	"The subagent CANNOT see this conversation. Its `prompt` is its ONLY input — make it fully self-contained: state the goal, the relevant absolute file paths, any background it needs, and exactly what to return.",
	"Ask for a specific, structured final answer (e.g. file paths + line numbers, or an ordered plan). You only receive the subagent's final message, not its intermediate steps.",
	"Subagents cannot themselves spawn subagents, so do not ask one to 'delegate' further — give it the concrete work directly.",
];

interface AgentDetails {
	subagent_type: string;
	description?: string;
	model?: string;
	provider?: string;
	thinking?: ThinkingLevel;
	activity?: string;
	status?: "starting" | "running" | "completed" | "error";
	turnCount?: number;
	toolUseCount?: number;
	spinnerFrame?: number;
	warning?: string;
}

function detailsFromProgress(profile: AgentProfile, progress: RunProgress): AgentDetails {
	return {
		subagent_type: profile.name,
		description: firstLine(profile.description),
		model: progress.modelId,
		provider: progress.provider,
		thinking: progress.thinkingLevel,
		activity: progress.activity,
		status: progress.status,
		turnCount: progress.turnCount,
		toolUseCount: progress.toolUseCount,
		...(progress.warning ? { warning: progress.warning } : {}),
	};
}

function runMeta(details: AgentDetails | undefined): string {
	const model = details?.provider && details.model ? `${details.provider}/${details.model}` : "resolving model";
	const thinking = details?.thinking ? `thinking ${details.thinking}` : "thinking inherit";
	const turn = details?.turnCount ? `turn ${details.turnCount}` : undefined;
	const tools = details?.toolUseCount ? `${details.toolUseCount} tool use${details.toolUseCount === 1 ? "" : "s"}` : undefined;
	return [model, thinking, turn, tools].filter(Boolean).join(" · ");
}

/**
 * Build the `subagent_type` description listing the currently available agents.
 * Computed from the cwd-independent built-ins plus whatever is discoverable from
 * the process cwd, which is the best we can do at registration time (the schema
 * is fixed once); the per-call execute() still validates against `ctx.cwd`.
 */
function buildSubagentTypeDescription(deps: AgentsDeps): string {
	let available: AgentProfile[] = [];
	try {
		available = listProfiles(deps.loadProfiles(process.cwd()).profiles);
	} catch {
		available = [];
	}
	const lines = available.map((p) => `- ${p.name}: ${flattenDescription(p.description)}`);
	const body = lines.length ? `\n${lines.join("\n")}` : " (none discovered)";
	return (
		"The type of specialist subagent to delegate to. Choose the one whose description best matches the task. " +
		`Available types:${body}`
	);
}

export function registerAgentTool(pi: ExtensionAPI, deps: AgentsDeps): void {
	pi.registerTool<ReturnType<typeof buildParameters>, AgentDetails>({
		name: AGENT_TOOL_NAME,
		label: "Agent",
		description:
			"Delegate a task to an isolated specialist subagent (e.g. explore, plan, general-purpose). " +
			"The subagent runs in its own context with its own tools and model, and returns only its final message. " +
			"Use this to offload investigation, planning, or multi-step work instead of doing it inline.",
		promptSnippet: AGENT_SNIPPET,
		promptGuidelines: AGENT_GUIDELINES,
		parameters: buildParameters(deps),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const { profiles, diagnostics } = deps.loadProfiles(ctx.cwd);
			const profile = profiles.get(params.subagent_type);

			if (!profile) {
				const available = listProfiles(profiles)
					.map((p) => p.name)
					.join(", ");
				const diag = diagnostics.length ? ` (note: ${diagnostics.join("; ")})` : "";
				return {
					content: [
						{
							type: "text",
							text:
								`Unknown subagent_type "${params.subagent_type}". ` +
								`Available types: ${available || "(none)"}.${diag}`,
						},
					],
					details: { subagent_type: params.subagent_type },
					isError: true,
				};
			}

			// Apply user-config overrides (model overrides, defaults) before running.
			const effective = applyConfigOverrides(profile, readConfig());

			const inheritedThinkingLevel = pi.getThinkingLevel() as ThinkingLevel;
			let spinnerFrame = 0;
			let latestDetails: AgentDetails | undefined;
			const pushUpdate = (details: AgentDetails): void => {
				onUpdate?.({
					content: [{ type: "text", text: details.activity ?? "started" }],
					details,
				});
			};
			const spinner = onUpdate
				? setInterval(() => {
					if (!latestDetails) return;
					spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
					latestDetails = { ...latestDetails, spinnerFrame };
					pushUpdate(latestDetails);
				}, SPINNER_MS)
				: undefined;

			try {
				const result = await runSubagent({
					profile: effective,
					prompt: params.prompt,
					ctx,
					signal,
					inheritedThinkingLevel,
					onProgress: (progress) => {
						latestDetails = { ...detailsFromProgress(effective, progress), spinnerFrame };
						pushUpdate(latestDetails);
					},
				});

				return {
					content: [{ type: "text", text: result.text }],
					details: {
						subagent_type: params.subagent_type,
						description: firstLine(effective.description),
						model: result.modelId,
						provider: result.provider,
						thinking: result.thinkingLevel,
						turnCount: result.turnCount,
						toolUseCount: result.toolUseCount,
						activity: "completed",
						status: "completed",
						...(result.warning ? { warning: result.warning } : {}),
					},
				};
			} finally {
				if (spinner) clearInterval(spinner);
			}
		},

		renderCall(args, theme, _context) {
			const title = args.description?.trim() || args.subagent_type;
			return new Text(
				`${theme.fg("toolTitle", theme.bold("Agent "))}${theme.fg("accent", args.subagent_type)}${theme.fg("muted", ` — ${title}`)}`,
				0,
				0,
			);
		},

		renderResult(result, { isPartial }, theme, _context) {
			const details = result.details as AgentDetails | undefined;
			if (isPartial) {
				const type = details?.subagent_type ?? "subagent";
				const activity = details?.activity ?? "started";
				const isError = details?.status === "error";
				const isDone = details?.status === "completed";
				const frame = SPINNER_FRAMES[details?.spinnerFrame ?? 0] ?? "⠋";
				const icon = isError ? "✗" : isDone ? "✓" : frame;
				const color = isError ? "error" : isDone ? "success" : "accent";
				return new Text(
					`${theme.fg(color, icon)} ${theme.fg("accent", type)}${theme.fg("muted", ` · ${runMeta(details)}`)}\n${theme.fg("muted", `└ ${activity}`)}`,
					0,
					0,
				);
			}
			let text = theme.fg("success", "✓ Subagent finished");
			if (details?.provider && details?.model) {
				text += theme.fg("muted", ` (${runMeta(details)})`);
			}
			if (details?.warning) text += theme.fg("warning", ` — ${details.warning}`);
			return new Text(text, 0, 0);
		},
	});
}

// ---------------------------------------------------------------------------
// /subagent command
// ---------------------------------------------------------------------------

function formatList(result: LoadProfilesResult, ctx: ResolveDeps["ctx"]): string {
	const profiles = listProfiles(result.profiles);
	const lines: string[] = ["Available subagents (delegate via the Agent tool):", ""];
	for (const p of profiles) {
		lines.push(`  ${p.name}  [${sourceLabel(p)}]`);
		lines.push(`    model: ${resolvedModelLabel(p, { ctx })}`);
		lines.push(`    thinking: ${thinkingLabel(p)}`);
		lines.push(`    tools: ${toolsLabel(p)}`);
		lines.push(`    ${firstLine(p.description)}`);
		lines.push("");
	}
	if (result.diagnostics.length) {
		lines.push("Diagnostics:");
		for (const d of result.diagnostics) lines.push(`  - ${d}`);
	}
	return lines.join("\n").trimEnd();
}

function formatShow(name: string, result: LoadProfilesResult, ctx: ResolveDeps["ctx"]): string {
	const profile = result.profiles.get(name);
	if (!profile) {
		const available = listProfiles(result.profiles)
			.map((p) => p.name)
			.join(", ");
		return `No subagent named "${name}". Available: ${available || "(none)"}.`;
	}

	const promptPreview =
		profile.systemPrompt.length > SYSTEM_PROMPT_PREVIEW_CHARS
			? `${profile.systemPrompt.slice(0, SYSTEM_PROMPT_PREVIEW_CHARS).trimEnd()}…`
			: profile.systemPrompt;

	const lines = [
		`Subagent: ${profile.name}  [${sourceLabel(profile)}]`,
		profile.filePath ? `  file: ${profile.filePath}` : "  file: (built-in)",
		`  model: ${resolvedModelLabel(profile, { ctx })}`,
		`  thinking: ${thinkingLabel(profile)}`,
		`  tools: ${toolsLabel(profile)}`,
	];
	if (profile.disallowedTools?.length) lines.push(`  disallowedTools: ${profile.disallowedTools.join(", ")}`);
	if (profile.color) lines.push(`  color: ${profile.color}`);
	lines.push(`  description: ${profile.description}`);
	lines.push("  system prompt:");
	for (const l of promptPreview.split("\n")) lines.push(`    ${l}`);
	return lines.join("\n");
}

/** The "use the main agent's model" choice in the model picker. */
const INHERIT_OPTION = "inherit — use the main agent's model";

/**
 * Interactive model configuration, mirroring /web: pick a subagent, pick a model
 * from the live registry (or "inherit"), and persist it. The change is picked up
 * on /reload (profiles are read fresh per Agent call, configs per /subagent run).
 */
async function configureAgentModel(ctx: ExtensionCommandContext, result: LoadProfilesResult): Promise<void> {
	const profiles = listProfiles(result.profiles);
	const pickLabels = profiles.map((p) => `${p.name}  (current: ${resolvedModelLabel(p, { ctx })})`);
	const picked = await ctx.ui.select("Configure which subagent's model?", pickLabels, {});
	if (picked == null) {
		ctx.ui.notify("Subagent config unchanged", "info");
		return;
	}
	const profile = profiles[pickLabels.indexOf(picked)];
	if (!profile) {
		ctx.ui.notify("Subagent config unchanged", "info");
		return;
	}

	// Offer "inherit" plus every available model as "provider/model-id".
	const models = ctx.modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`);
	const choice = await ctx.ui.select(`Model for "${profile.name}"`, [INHERIT_OPTION, ...models], {});
	if (choice == null) {
		ctx.ui.notify("Subagent config unchanged", "info");
		return;
	}
	const model = choice === INHERIT_OPTION ? "inherit" : choice;

	const next = setAgentModel(readConfig(), profile.name, model);
	if (!writeConfig(next)) {
		ctx.ui.notify(`Failed to save config to ${getConfigPath()}`, "error");
		return;
	}
	ctx.ui.notify(
		model === "inherit"
			? `"${profile.name}" now inherits the main agent's model. Run /reload (or restart pi) to apply.`
			: `"${profile.name}" will use ${model}. Run /reload (or restart pi) to apply.`,
		"info",
	);
}

export function registerSubagentCommand(pi: ExtensionAPI, deps: AgentsDeps): void {
	pi.registerCommand(SUBAGENT_COMMAND_NAME, {
		description: "Configure subagent models, or list/inspect the available subagents",
		handler: async (args, ctx) => {
			const argv = (typeof args === "string" ? args : "").trim();
			const result = deps.loadProfiles(ctx.cwd);

			// `--show <name>`: print a single profile's details.
			const showIdx = argv.indexOf(SHOW_FLAG);
			if (showIdx !== -1) {
				const rest = argv.slice(showIdx + SHOW_FLAG.length).trim();
				const name = rest.split(/\s+/, 1)[0] ?? "";
				if (!name) {
					ctx.ui?.notify?.(`Usage: /${SUBAGENT_COMMAND_NAME} ${SHOW_FLAG} <name>`, "warning");
					return;
				}
				ctx.ui?.notify?.(formatShow(name, result, ctx), "info");
				return;
			}

			// `--list`: print all profiles (pure text, RPC-friendly).
			if (argv.includes(LIST_FLAG)) {
				ctx.ui?.notify?.(formatList(result, ctx), "info");
				return;
			}

			// No args: interactive model configuration (mirrors /web). Needs a UI;
			// in non-interactive (-p) mode there's nothing to prompt with.
			if (!ctx.hasUI) {
				ctx.ui?.notify?.(
					`/${SUBAGENT_COMMAND_NAME} needs interactive mode. Use /${SUBAGENT_COMMAND_NAME} ${LIST_FLAG} to list agents or /${SUBAGENT_COMMAND_NAME} ${SHOW_FLAG} <name> to inspect one.`,
					"error",
				);
				return;
			}
			await configureAgentModel(ctx, result);
		},
	});
}

// ---------------------------------------------------------------------------
// Agent parameter schema
// ---------------------------------------------------------------------------

/**
 * Build the Agent tool's TypeBox parameter schema. The `subagent_type`
 * description is computed from `deps` so the model sees the live list of
 * available agents at registration time.
 */
function buildParameters(deps: AgentsDeps) {
	return Type.Object({
		subagent_type: Type.String({ description: buildSubagentTypeDescription(deps) }),
		prompt: Type.String({
			description:
				"The complete, self-contained task for the subagent. The subagent CANNOT see the main " +
				"conversation, so include every file path, piece of background, and expected output it needs. " +
				"State exactly what to return as the final answer.",
		}),
		description: Type.Optional(
			Type.String({ description: "A short (3-5 word) title for this task, shown in the UI." }),
		),
	});
}
