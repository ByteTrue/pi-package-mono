import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  loadSubagentSettings,
  updateSubagentSettings,
  settingsPathForScope,
  listDiscoveredAgentNames,
  type SettingsScope,
  type SubagentSettings,
} from "./settings.js";
import { promptFuzzySelect, type PickerItem } from "./tui-picker.js";
import { subagentManager, type SubagentTaskRecord } from "./index.js";

const THINKING_CHOICES = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

function trunc(s: string, w: number): string {
  return s.length <= w ? s : `${s.slice(0, w - 1)}…`;
}

async function chooseScope(ctx: ExtensionCommandContext): Promise<SettingsScope | undefined> {
  const globalLabel = `Global — ${settingsPathForScope(ctx.cwd, "global")}`;
  const projectLabel = `Project — ${settingsPathForScope(ctx.cwd, "project")}`;
  const options = [globalLabel];
  if (ctx.isProjectTrusted()) {
    options.push(projectLabel);
  }
  options.push("🔙 Back");

  const selected = await ctx.ui.select("Where should subagent settings be saved?", options);
  if (!selected || selected === "🔙 Back") return undefined;
  return selected === projectLabel ? "project" : "global";
}

export async function pickModel(
  ctx: ExtensionCommandContext,
  current?: string,
): Promise<string | undefined | null> {
  const available = ctx.modelRegistry.getAvailable();
  const items: PickerItem[] = [];

  if (current) {
    items.push({
      value: "__KEEP__",
      label: `Keep current (${current})`,
      description: "retain existing model",
    });
    items.push({
      value: "__CLEAR__",
      label: "Clear model override",
      description: "inherit parent session model",
    });
  }

  items.push({
    value: "__CUSTOM__",
    label: "Custom model ref...",
    description: "enter model ID manually",
  });

  for (const m of available) {
    const id = `${m.provider}/${m.id}`;
    items.push({
      value: id,
      label: id,
      description: m.name,
    });
  }

  const title = current
    ? `Select Subagent Model (Current: ${current})`
    : "Select Subagent Model";

  const picked = await promptFuzzySelect(ctx, title, items, "Type to filter models...");
  if (!picked) return undefined;

  if (picked === "__KEEP__") return current;
  if (picked === "__CLEAR__") return null;
  if (picked === "__CUSTOM__") {
    const input = await ctx.ui.input(
      "Custom Model Ref",
      "Example: bytetrueapi/gemini-3.7-flash:low",
    );
    if (input === undefined) return undefined;
    return input.trim() || undefined;
  }
  return picked;
}

export async function pickThinking(
  ctx: ExtensionCommandContext,
  current?: string,
): Promise<string | undefined | null> {
  const items: PickerItem[] = [];

  if (current) {
    items.push({
      value: "__KEEP__",
      label: `Keep current (${current})`,
      description: "retain existing thinking level",
    });
    items.push({
      value: "__CLEAR__",
      label: "Clear thinking override",
      description: "inherit default thinking level",
    });
  }

  for (const t of THINKING_CHOICES) {
    items.push({
      value: t,
      label: t === current ? `${t} (current)` : t,
    });
  }

  const title = current
    ? `Select Subagent Thinking Level (Current: ${current})`
    : "Select Subagent Thinking Level";

  const picked = await promptFuzzySelect(ctx, title, items, "Filter thinking level...");
  if (!picked) return undefined;

  if (picked === "__KEEP__") return current;
  if (picked === "__CLEAR__") return null;
  return picked;
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
  lines.push("Discovered Agent Templates (built-in + .pi/agents/*.md):");
  if (discoveredRoles.length === 0) {
    lines.push("  (none found)");
  } else {
    lines.push(`  ${discoveredRoles.join(", ")}`);
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

async function configureDefaultMenu(ctx: ExtensionCommandContext): Promise<void> {
  const scope = await chooseScope(ctx);
  if (!scope) return;

  const currentSettings = loadSubagentSettings(ctx.cwd, ctx.isProjectTrusted());

  const model = await pickModel(ctx, currentSettings.defaultModel);
  if (model === undefined) return;

  const thinking = await pickThinking(ctx, currentSettings.defaultThinking);
  if (thinking === undefined) return;

  const path = updateSubagentSettings(ctx.cwd, scope, (current) => ({
    ...current,
    defaultModel: model === null ? undefined : model,
    defaultThinking: thinking === null ? undefined : thinking,
  }));

  ctx.ui.notify(
    `Subagent default saved to ${path}\nModel: ${model ?? "(inherited)"}, Thinking: ${thinking ?? "(inherited)"}`,
    "info",
  );
}

async function configureRoleMenu(ctx: ExtensionCommandContext): Promise<void> {
  while (true) {
    const discovered = listDiscoveredAgentNames(ctx.cwd);
    const customOption = "➕ Enter a new role name...";
    const choices = [...discovered, customOption, "🔙 Back"];

    const pickedRole = await ctx.ui.select("Select an Agent Role to Configure", choices);
    if (!pickedRole || pickedRole === "🔙 Back") return;

    let roleName = pickedRole;
    if (pickedRole === customOption) {
      const input = await ctx.ui.input(
        "Role Name",
        "Example: scout, reviewer, researcher",
      );
      if (input === undefined || !input.trim()) continue;
      roleName = input.trim().toLowerCase();
    }

    const scope = await chooseScope(ctx);
    if (!scope) continue;

    const currentSettings = loadSubagentSettings(ctx.cwd, ctx.isProjectTrusted());
    const existingRole = currentSettings.agents?.[roleName] ?? {};

    const model = await pickModel(ctx, existingRole.model);
    if (model === undefined) continue;

    const thinking = await pickThinking(ctx, existingRole.thinking);
    if (thinking === undefined) continue;

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
    return;
  }
}

async function viewSubagentsMenu(ctx: ExtensionCommandContext): Promise<void> {
  const sessionId = ctx.sessionManager?.getSessionId?.() ?? "default";

  while (true) {
    const tasks = subagentManager.list(sessionId);
    if (tasks.length === 0) {
      ctx.ui.notify("No subagent tasks recorded in current session.", "info");
      return;
    }

    const running = tasks.filter((t) => t.status === "running").length;
    const taskChoices: PickerItem[] = tasks.map((t) => {
      const dur = fmtDur((t.finishedAt ?? Date.now()) - t.startedAt);
      const role = t.agent ? `[${t.agent}] ` : "";
      const mode = t.mode === "background" ? "bg" : "fg";
      return {
        value: t.id,
        label: `[${t.status}] ${role}${trunc(t.description, 40)} (${t.id})`,
        description: `${mode} · ${dur}`,
      };
    });

    taskChoices.push({
      value: "__BACK__",
      label: "🔙 Back",
      description: "return to subagent menu",
    });

    const pickedId = await promptFuzzySelect(
      ctx,
      `Subagent Tasks (${running} running, ${tasks.length} total)`,
      taskChoices,
    );

    if (!pickedId || pickedId === "__BACK__") return;

    const task = subagentManager.get(pickedId);
    if (!task) continue;

    await viewSingleTaskMenu(ctx, task);
  }
}

async function viewSingleTaskMenu(
  ctx: ExtensionCommandContext,
  task: SubagentTaskRecord,
): Promise<void> {
  while (true) {
    const actions = ["📄 View Output"];
    if (task.status === "running") {
      actions.push("🛑 Stop Task");
    }
    if (task.status === "paused") {
      actions.push("💡 How to Resume");
    }
    actions.push("🔙 Back");

    const action = await ctx.ui.select(
      `Task ${task.id} [${task.status}] — ${task.description}`,
      actions,
    );

    if (!action || action === "🔙 Back") return;

    if (action === "📄 View Output") {
      const out = task.output || "(no output captured yet)";
      const rawUI = ctx.ui as unknown as Record<string, Function>;
      if (typeof rawUI?.editor === "function") {
        await rawUI.editor(`Output for ${task.id}`, out);
      } else {
        ctx.ui.notify(out.slice(0, 500), "info");
      }
    } else if (action === "🛑 Stop Task") {
      const confirmed = await ctx.ui.confirm(
        "Stop this subagent task?",
        `ID: ${task.id}\nTask: ${task.description}`,
      );
      if (confirmed) {
        subagentManager.stop(task.id);
        ctx.ui.notify(`Subagent task ${task.id} stopped.`, "info");
        return;
      }
    } else if (action === "💡 How to Resume") {
      const resumeCode = `subagent({ tasks: [{ resume: "${task.id}", task: "Continue the remaining work" }] })`;
      ctx.ui.notify(`To resume this session in chat, run:\n${resumeCode}`, "info");
    }
  }
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
    while (true) {
      const sessionId = ctx.sessionManager?.getSessionId?.() ?? "default";
      const runningCount = subagentManager.getRunningCount(sessionId);
      const actionActive =
        runningCount > 0
          ? `👀 View Active Subagents (${runningCount} running)`
          : "👀 View Subagent Tasks";
      const actionDefault = "⚙️ Configure Default Subagent Model & Thinking";
      const actionRole = "🎭 Configure an Agent Role (e.g. scout, reviewer)";
      const actionShow = "📋 Show Current Configuration";

      const choices = [
        actionActive,
        actionDefault,
        actionRole,
        actionShow,
        "🚪 Exit",
      ];

      const action = await ctx.ui.select("Subagent Settings", choices);
      if (!action || action === "🚪 Exit") {
        return;
      }

      if (action === actionActive) {
        await viewSubagentsMenu(ctx);
      } else if (action === actionDefault) {
        await configureDefaultMenu(ctx);
      } else if (action === actionRole) {
        await configureRoleMenu(ctx);
      } else if (action === actionShow) {
        showConfig(ctx);
      }
    }
  } catch (error) {
    ctx.ui.notify(
      `Subagent config error: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}
