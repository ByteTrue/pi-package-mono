import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  COMMAND_NAME,
  loadSubagentSettings,
  updateSubagentSettings,
  settingsPathForScope,
  listDiscoveredAgentNames,
  type SettingsScope,
  type SubagentSettings,
} from "./settings.js";

const THINKING_CHOICES = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

async function chooseScope(ctx: ExtensionCommandContext): Promise<SettingsScope | undefined> {
  const globalLabel = `Global — ${settingsPathForScope(ctx.cwd, "global")}`;
  const projectLabel = `Project — ${settingsPathForScope(ctx.cwd, "project")}`;
  const options = [globalLabel];
  if (ctx.isProjectTrusted()) {
    options.push(projectLabel);
  }
  const selected = await ctx.ui.select("Where should subagent settings be saved?", options);
  if (!selected) return undefined;
  return selected === projectLabel ? "project" : "global";
}

async function pickModel(
  ctx: ExtensionCommandContext,
  current?: string,
): Promise<string | undefined | null> {
  const available = ctx.modelRegistry.getAvailable();
  const modelRefs = available.map((m) => `${m.provider}/${m.id}`);
  const customOption = "✏️ Enter custom model ID manually...";
  const clearOption = "🗑️ Clear (inherit session model)";
  const keepOption = current ? `Keep current (${current})` : undefined;

  const choices = [
    ...(keepOption ? [keepOption] : []),
    ...modelRefs,
    customOption,
    ...(current ? [clearOption] : []),
  ];

  const picked = await ctx.ui.select(
    current ? `Subagent Model (Current: ${current})` : "Select Subagent Model",
    choices,
  );
  if (!picked) return undefined;
  if (picked === keepOption) return current;
  if (picked === clearOption) return null;
  if (picked === customOption) {
    const input = await ctx.ui.input("Custom Model Ref", "Example: bytetrueapi/gemini-3.7-flash:low");
    if (!input?.trim()) return undefined;
    return input.trim();
  }
  return picked;
}

async function pickThinking(
  ctx: ExtensionCommandContext,
  current?: string,
): Promise<string | undefined | null> {
  const customOptions = [
    ...(current ? [`Keep current (${current})`] : []),
    ...THINKING_CHOICES.map((t) => (t === current ? `${t} (current)` : t)),
    "🗑️ Clear (inherit default)",
  ];

  const picked = await ctx.ui.select(
    current ? `Subagent Thinking Level (Current: ${current})` : "Select Subagent Thinking Level",
    customOptions,
  );
  if (!picked) return undefined;
  if (picked.startsWith("Keep current")) return current;
  if (picked.startsWith("🗑️ Clear")) return null;
  const match = THINKING_CHOICES.find((t) => picked.startsWith(t));
  return match ?? null;
}

function showConfig(ctx: ExtensionCommandContext): void {
  const settings = loadSubagentSettings(ctx.cwd, ctx.isProjectTrusted());
  const discoveredRoles = listDiscoveredAgentNames(ctx.cwd);

  const lines = [
    "=== Subagent Configuration ===",
    `Default Model:    ${settings.defaultModel ?? "inherit parent session"}`,
    `Default Thinking: ${settings.defaultThinking ?? "inherit parent session"}`,
    "",
    "Configured Roles (settings.json):",
  ];

  const configuredRoles = Object.entries(settings.agents ?? {});
  if (configuredRoles.length === 0) {
    lines.push("  (no roles explicitly configured in settings.json)");
  } else {
    for (const [name, cfg] of configuredRoles) {
      lines.push(
        `  • ${name}: model=${cfg.model ?? "default"}, thinking=${cfg.thinking ?? "default"}${cfg.tools?.length ? `, tools=[${cfg.tools.join(",")}]` : ""}`,
      );
    }
  }

  lines.push("");
  lines.push(`Discovered Agent Templates (.pi/agents/*.md):`);
  if (discoveredRoles.length === 0) {
    lines.push("  (none found in .pi/agents or ~/.pi/agent/agents)");
  } else {
    lines.push(`  ${discoveredRoles.join(", ")}`);
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

async function configureDefault(
  ctx: ExtensionCommandContext,
  scope: SettingsScope,
  settings: SubagentSettings,
): Promise<void> {
  const model = await pickModel(ctx, settings.defaultModel);
  if (model === undefined) return;

  const thinking = await pickThinking(ctx, settings.defaultThinking);
  if (thinking === undefined) return;

  const path = updateSubagentSettings(ctx.cwd, scope, (current) => ({
    ...current,
    defaultModel: model === null ? undefined : model,
    defaultThinking: thinking === null ? undefined : thinking,
  }));

  ctx.ui.notify(
    `Subagent default model/thinking saved to ${path}\nModel: ${model ?? "(inherited)"}, Thinking: ${thinking ?? "(inherited)"}`,
    "info",
  );
}

async function configureRole(
  ctx: ExtensionCommandContext,
  scope: SettingsScope,
  settings: SubagentSettings,
): Promise<void> {
  const discovered = listDiscoveredAgentNames(ctx.cwd);
  const customOption = "➕ Enter a new role name...";
  const choices = [...discovered, customOption];

  const pickedRole = await ctx.ui.select("Select an Agent Role to Configure", choices);
  if (!pickedRole) return;

  let roleName = pickedRole;
  if (pickedRole === customOption) {
    const input = await ctx.ui.input("Role Name", "Example: researcher, reviewer, scout");
    if (!input?.trim()) return;
    roleName = input.trim().toLowerCase();
  }

  const existingRole = settings.agents?.[roleName] ?? {};
  const model = await pickModel(ctx, existingRole.model);
  if (model === undefined) return;

  const thinking = await pickThinking(ctx, existingRole.thinking);
  if (thinking === undefined) return;

  const path = updateSubagentSettings(ctx.cwd, scope, (current) => {
    const nextAgents = { ...(current.agents ?? {}) };
    const updatedRole = { ...(nextAgents[roleName] ?? {}) };

    if (model === null) delete updatedRole.model;
    else updatedRole.model = model;

    if (thinking === null) delete updatedRole.thinking;
    else updatedRole.thinking = thinking;

    if (Object.keys(updatedRole).length > 0) {
      nextAgents[roleName] = updatedRole;
    } else {
      delete nextAgents[roleName];
    }

    return {
      ...current,
      agents: Object.keys(nextAgents).length > 0 ? nextAgents : undefined,
    };
  });

  ctx.ui.notify(
    `Role "${roleName}" configured in ${path}\nModel: ${model ?? "(default)"}, Thinking: ${thinking ?? "(default)"}`,
    "info",
  );
}

export async function runSubagentCommand(
  ctx: ExtensionCommandContext,
  args = "",
): Promise<void> {
  const arg = args.trim().toLowerCase();
  if (arg === "list" || arg === "show" || arg === "status") {
    showConfig(ctx);
    return;
  }

  if (!ctx.hasUI) {
    showConfig(ctx);
    return;
  }

  try {
    const actionDefault = "⚙️ Configure Default Subagent Model & Thinking";
    const actionRole = "🎭 Configure an Agent Role (e.g. researcher, reviewer)";
    const actionShow = "📋 Show Current Configuration";

    const action = await ctx.ui.select("Subagent Settings", [
      actionDefault,
      actionRole,
      actionShow,
    ]);

    if (!action) return;
    if (action === actionShow) {
      showConfig(ctx);
      return;
    }

    const scope = await chooseScope(ctx);
    if (!scope) return;

    const currentSettings = loadSubagentSettings(ctx.cwd, ctx.isProjectTrusted());

    if (action === actionDefault) {
      await configureDefault(ctx, scope, currentSettings);
    } else if (action === actionRole) {
      await configureRole(ctx, scope, currentSettings);
    }
  } catch (error) {
    ctx.ui.notify(
      `Subagent config error: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}
