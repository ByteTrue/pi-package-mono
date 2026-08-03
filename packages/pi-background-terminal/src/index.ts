import { truncateLine, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { manager, type BackgroundTask } from "./background/manager.js";
import { registerBackgroundCommand } from "./background-command.js";
import { registerBackgroundKillTool } from "./tools/background-kill.js";
import { registerBackgroundRunTool } from "./tools/background-run.js";
import { registerBackgroundStatusTool } from "./tools/background-status.js";

export default function registerBackgroundTerminal(pi: ExtensionAPI): void {
  let currentSessionId: string | null = null;

  manager.init((task) => {
    if (!currentSessionId || task.parentSessionId !== currentSessionId) return;
    // followUp + triggerTurn is what makes this hands-off: it wakes an idle agent into a new turn
    // with the outcome, so nothing has to poll background_status to notice completion.
    pi.sendMessage(
      {
        customType: "background-exit",
        content: formatExitMessage(task),
        display: true,
        details: task,
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  });

  registerBackgroundCommand(pi);
  registerBackgroundRunTool(pi);
  registerBackgroundStatusTool(pi);
  registerBackgroundKillTool(pi);

  pi.on("session_start", async (_event, ctx) => {
    currentSessionId = ctx.sessionManager.getSessionId();
  });

  pi.on("session_shutdown", async (event, ctx) => {
    // "reload" re-fires session_shutdown/session_start on the SAME session (extensions and config
    // hot-reload), it does not end the session. Background tasks must survive a /reload.
    if (event.reason === "reload") return;

    const sessionId = ctx.sessionManager.getSessionId();
    if (currentSessionId === sessionId) currentSessionId = null;
    await manager.clearSession(sessionId);
  });
}

function formatExitMessage(task: BackgroundTask): string {
  const outcome =
    task.status === "killed"
      ? "was stopped"
      : task.status === "timed_out"
        ? "timed out"
        : task.status === "failed"
          ? `failed: ${task.error ?? "unknown error"}`
          : `exited with code ${task.exitCode}`;
  const lastLine = task.tail.trim().split("\n").at(-1);
  const summary = lastLine ? ` Last line: ${truncateLine(lastLine, 250).text}` : "";
  return `[${task.id}] ${task.command} ${outcome}.${summary} Output: ${task.outputPath}`;
}
