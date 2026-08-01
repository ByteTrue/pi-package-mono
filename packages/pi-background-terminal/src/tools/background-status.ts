import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { manager, type BackgroundTask } from "../background/manager.js";

export function registerBackgroundStatusTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "background_status",
    label: "Background Task Status",
    description:
      "Omit `id` to list all background tasks (id, command, status, output path). Pass `id` for one task's status, exit code (or timeout), output path, line count, and a recent-output preview.\n\n" +
      "Never returns full output inline; use read on the output path for that. Call this to check sooner than the automatic completion notice, not to poll for it.",
    promptSnippet: "Check background tasks: list all, or pass id for one task's status + output path.",
    parameters: Type.Object({
      id: Type.Optional(
        Type.String({ minLength: 1, description: "Task id from background_run; omit to list all background tasks" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();

      if (!params.id) {
        const tasks = manager.list(parentSessionId);
        const text = tasks.length === 0 ? "No background tasks." : tasks.map((task) => formatSummary(task)).join("\n");
        return { content: [{ type: "text", text }], details: tasks };
      }

      const task = manager.get(params.id, parentSessionId);
      if (!task) throw new Error(`No background task found with id "${params.id}".`);

      const text = [
        formatSummary(task),
        `Output file: ${task.outputPath}`,
        `Lines so far: ${task.lineCount}`,
        task.tail ? `Recent output:\n${task.tail}` : "(no output yet)",
        "Use the read tool on the output file path above to see the full output.",
      ].join("\n");

      return { content: [{ type: "text", text }], details: task };
    },
  });
}

function formatSummary(task: BackgroundTask): string {
  const parts = [`[${task.id}] ${task.command}`, `status: ${task.status}`];
  if (task.exitCode !== null) parts.push(`exitCode: ${task.exitCode}`);
  if (task.error) parts.push(`error: ${task.error}`);
  return parts.join(" | ");
}
