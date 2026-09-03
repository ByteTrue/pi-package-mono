import { truncateLine, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { manager, type BackgroundTask } from "./background/manager.js";
import { registerBashDefaultTimeout } from "./bash-default-timeout.js";
import { registerBackgroundCommand } from "./background-command.js";
import { registerBackgroundKillTool } from "./tools/background-kill.js";
import { registerBackgroundRunTool } from "./tools/background-run.js";
import { registerBackgroundStatusTool } from "./tools/background-status.js";

export default function registerBackgroundTerminal(pi: ExtensionAPI): void {
  let currentSessionId: string | null = null;
  let updateStatus: (() => void) | undefined;
  let agentBusy = false;
  let pendingExits: BackgroundTask[] = [];

  // Pi drains the followUp queue one message at a time by default, so one message per exit
  // would wake the agent into a separate turn per task. Exits that land while the agent is
  // busy are buffered and flushed as a single message when it settles; followUp messages are
  // only delivered once the agent finishes anyway, so this changes no delivery timing.
  const flushPendingExits = () => {
    const batch = pendingExits;
    pendingExits = [];
    const first = batch[0];
    if (!first) return;
    const content =
      batch.length === 1
        ? formatExitMessage(first)
        : `${batch.length} background tasks finished:\n${batch.map(formatExitMessage).join("\n")}`;
    pi.sendMessage(
      {
        customType: "background-exit",
        content,
        display: true,
        details: batch.length === 1 ? first : batch,
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  };

  manager.init(
    (task) => {
      if (!currentSessionId || task.parentSessionId !== currentSessionId) return;
      // followUp + triggerTurn is what makes this hands-off: it wakes an idle agent into a new turn
      // with the outcome, so nothing has to poll background_status to notice completion.
      pendingExits.push(task);
      if (!agentBusy) flushPendingExits();
    },
    () => updateStatus?.(),
  );

  registerBackgroundCommand(pi);
  registerBashDefaultTimeout(pi);
  registerBackgroundRunTool(pi);
  registerBackgroundStatusTool(pi);
  registerBackgroundKillTool(pi);

  pi.on("agent_start", async () => {
    agentBusy = true;
  });

  pi.on("agent_settled", async () => {
    agentBusy = false;
    flushPendingExits();
  });

  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    currentSessionId = sessionId;
    updateStatus = () => {
      const running = manager.list(sessionId).filter((task) => task.status === "running").length;
      ctx.ui.setStatus("background-terminal", running === 0 ? undefined : `bg:${running}`);
    };
    updateStatus();
  });

  pi.on("session_shutdown", async (event, ctx) => {
    // "reload" re-fires session_shutdown/session_start on the SAME session (extensions and config
    // hot-reload), it does not end the session. Background tasks must survive a /reload.
    if (event.reason === "reload") return;

    const sessionId = ctx.sessionManager.getSessionId();
    ctx.ui.setStatus("background-terminal", undefined);
    updateStatus = undefined;
    pendingExits = [];
    if (currentSessionId === sessionId) currentSessionId = null;
    await manager.clearSession(sessionId);
  });
}

function formatExitMessage(task: BackgroundTask): string {
  const outcome =
    task.status === "killed"
      ? "was stopped"
      : task.status === "failed"
        ? `failed: ${task.error ?? "unknown error"}`
        : `exited with code ${task.exitCode}`;
  const lastLine = task.tail.trim().split("\n").at(-1);
  const summary = lastLine ? ` Last line: ${truncateLine(lastLine, 250).text}` : "";
  return `[${task.id}] ${task.command} ${outcome}.${summary} Output: ${task.outputPath}`;
}
