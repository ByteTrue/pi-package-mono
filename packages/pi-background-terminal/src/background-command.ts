import { readFile } from "node:fs/promises";
import { truncateLine, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { manager, type BackgroundTask } from "./background/manager.js";

const BACK = "Back";
const VIEW_OUTPUT = "View output";
const KILL = "Kill";

export async function runBackgroundCommand(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) return;

  const sessionId = ctx.sessionManager.getSessionId();
  while (true) {
    const tasks = manager.list(sessionId).filter((task) => task.status === "running");
    if (tasks.length === 0) {
      ctx.ui.notify("No running background commands.", "info");
      return;
    }

    const taskOptions = tasks.map(formatTaskOption);
    const selected = await ctx.ui.select("Background commands", [...taskOptions, BACK]);
    if (!selected || selected === BACK) return;

    const task = tasks[taskOptions.indexOf(selected)];
    if (!task) continue;
    await runTaskMenu(ctx, task, sessionId);
  }
}

export function registerBackgroundCommand(pi: ExtensionAPI): void {
  pi.registerCommand("background", {
    description: "Browse running background commands, view their output, or stop one",
    handler: async (_args, ctx) => runBackgroundCommand(ctx),
  });
}

async function runTaskMenu(ctx: ExtensionCommandContext, task: BackgroundTask, sessionId: string): Promise<void> {
  while (true) {
    const current = manager.get(task.id, sessionId) ?? task;
    const actions = [VIEW_OUTPUT];
    if (current.status === "running") actions.push(KILL);
    actions.push(BACK);

    const action = await ctx.ui.select(`${current.command} — ${current.status}`, actions);
    if (!action || action === BACK) return;

    if (action === VIEW_OUTPUT) {
      await showOutput(ctx, current);
      continue;
    }

    if (action === KILL) {
      const confirmed = await ctx.ui.confirm("Stop this background command?", current.command);
      if (!confirmed) continue;
      if (manager.kill(current.id, sessionId)) {
        ctx.ui.notify("Background command stopped.", "info");
      } else {
        ctx.ui.notify("That background command is no longer running.", "warning");
      }
      return;
    }
  }
}

async function showOutput(ctx: ExtensionCommandContext, task: BackgroundTask): Promise<void> {
  let output: string;
  try {
    output = await readFile(task.outputPath, "utf8");
  } catch (error) {
    ctx.ui.notify(`Could not read background output: ${error instanceof Error ? error.message : String(error)}`, "error");
    return;
  }

  await ctx.ui.editor(`Output — ${truncateLine(task.command.replace(/\s+/g, " ").trim(), 100).text}`, output || "(no output yet)");
}

function formatTaskOption(task: BackgroundTask): string {
  const command = truncateLine(task.command.replace(/\s+/g, " ").trim(), 100).text;
  return `[${task.status}] ${command} — ${task.id}`;
}
