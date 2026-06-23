import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { type AgentDirs, type AgentEntry, discoverAgents, readAgentFile, resetOverride, writeAgentFile } from "./agents.js";
import { patchFrontmatterField } from "./frontmatter.js";

const COMMAND_NAME = "agents-plus";
const GOTGENES_INSTALL_COMMAND = "pi install npm:@gotgenes/pi-subagents";
const INHERIT_MODEL = "inherit";
const MANUAL_MODEL = "manual input...";
const THINKING = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh"] as const;

type SlashCommand = { name: string; source?: string };

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
			const action = await ctx.ui.select("Agents Plus", ["Configure model", "Configure thinking", "Reset built-in override"]);
			if (action === "Configure model") await configureModel(ctx);
			else if (action === "Configure thinking") await configureThinking(ctx);
			else if (action === "Reset built-in override") await resetBuiltin(ctx);
			else ctx.ui.notify("Agents Plus unchanged", "info");
		},
	});
}

async function configureModel(ctx: ExtensionCommandContext): Promise<void> {
	const dirs = getDirs(ctx);
	const agent = await chooseAgent(ctx, discoverAgents(dirs), "Configure model for which agent?");
	if (!agent) return unchanged(ctx);
	const path = ensureConfigFile(ctx, agent);
	if (!path) return unchanged(ctx);

	const choice = await ctx.ui.select(`Model for ${agent.name}`, [INHERIT_MODEL, ...availableModels(ctx), MANUAL_MODEL]);
	if (choice == null) return unchanged(ctx);
	const model = choice === MANUAL_MODEL ? await promptModel(ctx, agent.name) : choice;
	if (!model) return unchanged(ctx);

	writeAgentFile(path, patchFrontmatterField(readAgentFile(path), "model", { value: model }));
	ctx.ui.notify(`${agent.name} model set to ${model}. Run /reload to apply.`, "info");
}

async function configureThinking(ctx: ExtensionCommandContext): Promise<void> {
	const dirs = getDirs(ctx);
	const agent = await chooseAgent(ctx, discoverAgents(dirs), "Configure thinking for which agent?");
	if (!agent) return unchanged(ctx);
	const path = ensureConfigFile(ctx, agent);
	if (!path) return unchanged(ctx);

	const thinking = await ctx.ui.select(`Thinking for ${agent.name}`, [...THINKING]);
	if (thinking == null) return unchanged(ctx);
	writeAgentFile(path, patchFrontmatterField(readAgentFile(path), "thinking", { value: thinking === "inherit" ? undefined : thinking }));
	ctx.ui.notify(`${agent.name} thinking set to ${thinking}. Run /reload to apply.`, "info");
}

async function resetBuiltin(ctx: ExtensionCommandContext): Promise<void> {
	const overrides = discoverAgents(getDirs(ctx)).filter((agent) => agent.isBuiltin && agent.path);
	const agent = await chooseAgent(ctx, overrides, "Reset which built-in override?");
	if (!agent?.path) return unchanged(ctx);
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
	return `${agent.name} (${agent.source}${agent.path ? `: ${agent.path}` : ""})`;
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
