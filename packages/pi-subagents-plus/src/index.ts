import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { type AgentDirs, type AgentEntry, discoverAgents, readAgentFile, resetOverride, writeAgentFile } from "./agents.js";
import { patchFrontmatterField, readFrontmatterField } from "./frontmatter.js";

const COMMAND_NAME = "agents-plus";
const GOTGENES_INSTALL_COMMAND = "pi install npm:@gotgenes/pi-subagents";
const INHERIT_MODEL = "inherit";
const MANUAL_MODEL = "manual input...";
const THINKING = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh"] as const;

type SlashCommand = { name: string; source?: string };
type AgentDetails = { model: string; thinking: string; description?: string; path?: string };

export function registerAgentsPlusCommand(pi: ExtensionAPI): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "Configure @gotgenes/pi-subagents agent model/thinking frontmatter",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/agents-plus needs interactive mode.", "error");
				return;
			}
			if (!hasGotgenesAgentsCommand(pi.getCommands())) {
				ctx.ui.notify(`Install gotgenes subagents first: ${GOTGENES_INSTALL_COMMAND}`, "error");
				return;
			}
			const action = await ctx.ui.select("Agents Plus", ["Manage agents", "Reset built-in override"]);
			if (action === "Manage agents") await manageAgents(ctx);
			else if (action === "Reset built-in override") await resetBuiltin(ctx);
			else unchanged(ctx);
		},
	});
}

async function manageAgents(ctx: ExtensionCommandContext): Promise<void> {
	const agent = await chooseAgent(ctx, discoverAgents(getDirs(ctx)), "Manage which agent?");
	if (!agent) return unchanged(ctx);
	await showAgentMenu(ctx, agent);
}

async function showAgentMenu(ctx: ExtensionCommandContext, agent: AgentEntry): Promise<void> {
	const options = ["Configure model & thinking"];
	if (agent.isBuiltin && agent.path) options.push("Reset built-in override");
	const action = await ctx.ui.select(agentDetailsTitle(agent), [...options, "Back"]);
	if (action === "Configure model & thinking") await configureModelAndThinking(ctx, agent);
	else if (action === "Reset built-in override") await resetAgentOverride(ctx, agent);
	else unchanged(ctx);
}

async function configureModelAndThinking(ctx: ExtensionCommandContext, agent: AgentEntry): Promise<void> {
	const path = ensureConfigFile(ctx, agent);
	if (!path) return;

	const model = await chooseModel(ctx, agent.name);
	if (!model) return unchanged(ctx);
	const thinking = await chooseThinking(ctx, agent.name);
	if (thinking == null) return unchanged(ctx);

	let next = patchFrontmatterField(readAgentFile(path), "model", { value: model });
	next = patchFrontmatterField(next, "thinking", { value: thinking === "inherit" ? undefined : thinking });
	writeAgentFile(path, next);
	ctx.ui.notify(`${agent.name} model/thinking updated. Run /reload to apply.`, "info");
}


async function resetBuiltin(ctx: ExtensionCommandContext): Promise<void> {
	const overrides = discoverAgents(getDirs(ctx)).filter((agent) => agent.isBuiltin && agent.path);
	const agent = await chooseAgent(ctx, overrides, "Reset which built-in override?");
	if (!agent) return unchanged(ctx);
	await resetAgentOverride(ctx, agent);
}

async function resetAgentOverride(ctx: ExtensionCommandContext, agent: AgentEntry): Promise<void> {
	if (!agent.path) return unchanged(ctx);
	const confirmed = await ctx.ui.confirm(`Reset ${agent.name}?`, `Move ${agent.path} to a timestamped backup so gotgenes defaults apply again.`);
	if (!confirmed) return unchanged(ctx);
	const backup = resetOverride(agent.path);
	ctx.ui.notify(`${agent.name} override moved to ${backup}. Run /reload to apply.`, "info");
}

function ensureConfigFile(ctx: ExtensionCommandContext, agent: AgentEntry): string | undefined {
	if (agent.path) return agent.path;
	ctx.ui.notify(`${agent.name} is built in. Eject it in gotgenes /agents first, then rerun /agents-plus.`, "info");
	return undefined;
}

async function chooseAgent(ctx: ExtensionCommandContext, agents: AgentEntry[], title: string): Promise<AgentEntry | undefined> {
	if (agents.length === 0) {
		ctx.ui.notify("No matching agents found", "info");
		return undefined;
	}
	const labels = agents.map(formatAgent);
	const picked = await ctx.ui.select(title, labels);
	const index = picked == null ? -1 : labels.indexOf(picked);
	return index < 0 ? undefined : agents[index];
}

async function chooseModel(ctx: ExtensionCommandContext, name: string): Promise<string | undefined> {
	const choice = await ctx.ui.select(`Model for ${name}`, [INHERIT_MODEL, ...availableModels(ctx), MANUAL_MODEL]);
	if (choice == null) return undefined;
	return choice === MANUAL_MODEL ? promptModel(ctx, name) : choice;
}

async function chooseThinking(ctx: ExtensionCommandContext, name: string): Promise<(typeof THINKING)[number] | undefined> {
	const choice = await ctx.ui.select(`Thinking for ${name}`, [...THINKING]);
	return THINKING.includes(choice as (typeof THINKING)[number]) ? (choice as (typeof THINKING)[number]) : undefined;
}

async function promptModel(ctx: ExtensionCommandContext, name: string): Promise<string | undefined> {
	const value = await ctx.ui.input(`Model for ${name}`, "provider/model-id");
	return value?.trim() || undefined;
}

function getDirs(ctx: ExtensionCommandContext): AgentDirs {
	return { projectAgentsDir: join(ctx.cwd, ".pi", "agents"), globalAgentsDir: join(getAgentDir(), "agents") };
}

function availableModels(ctx: ExtensionCommandContext): string[] {
	try {
		const models = ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`);
		return [...new Set(models)].sort();
	} catch {
		return [];
	}
}

function formatAgent(agent: AgentEntry): string {
	const details = getAgentDetails(agent);
	return `${agent.name} · model: ${details.model} · thinking: ${details.thinking} · ${formatSource(agent)}`;
}

function agentDetailsTitle(agent: AgentEntry): string {
	const details = getAgentDetails(agent);
	const lines = [
		`Agent: ${agent.name}`,
		`Source: ${formatSource(agent)}`,
		`Model: ${details.model}`,
		`Thinking: ${details.thinking}`,
	];
	if (details.description) lines.push(`Description: ${details.description}`);
	if (details.path) lines.push(`File: ${details.path}`);
	return lines.join("\n");
}

function getAgentDetails(agent: AgentEntry): AgentDetails {
	if (!agent.path) return { model: "gotgenes default", thinking: "gotgenes default" };
	try {
		const markdown = readAgentFile(agent.path);
		return {
			model: readFrontmatterField(markdown, "model") ?? "inherit",
			thinking: readFrontmatterField(markdown, "thinking") ?? "inherit",
			description: readFrontmatterField(markdown, "description"),
			path: agent.path,
		};
	} catch {
		return { model: "unknown", thinking: "unknown", path: agent.path };
	}
}

function formatSource(agent: AgentEntry): string {
	if (agent.source === "builtin") return "built-in";
	if (agent.isBuiltin) return `${agent.source} override`;
	return agent.source;
}

function unchanged(ctx: ExtensionCommandContext): void {
	ctx.ui.notify("Agents Plus unchanged", "info");
}

export function hasGotgenesAgentsCommand(commands: readonly SlashCommand[]): boolean {
	return commands.some((command) => command.name === "agents" && command.source === "extension");
}

export default async function registerAgentsPlus(pi: ExtensionAPI): Promise<void> {
	registerAgentsPlusCommand(pi);
}
