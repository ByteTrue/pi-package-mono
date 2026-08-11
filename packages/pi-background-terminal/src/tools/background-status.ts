import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { manager, type BackgroundTask } from "../background/manager.js";

export function registerBackgroundStatusTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "background_status",
    label: "Background Task Status",
    description:
      "Check a background task by id. Returns status, exit code, output-file path, line count, and recent output. Read the file for full output; completion is reported automatically, so don't poll.",
    promptSnippet: "Check one background task.",
    parameters: Type.Object({
      id: Type.String({ minLength: 1, description: "Task id from background_run." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
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
