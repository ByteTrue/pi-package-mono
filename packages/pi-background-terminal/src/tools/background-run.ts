import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { manager } from "../background/manager.js";

export function registerBackgroundRunTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "background_run",
    label: "Run Command in Background",
    description:
      "Starts a shell command in the background; returns immediately with a task id while the command keeps running. Use only for something that must outlive this call \u2014 a dev server, watch mode, or a long build/test to run hands-off. For a command that finishes on its own, use bash.\n\n" +
      "`timeoutSeconds` is required: the command is auto-terminated if exceeded, so nothing can hang forever. Pick a value generous enough to finish normally.\n\n" +
      "Output streams live to a file (path in the result); use read on that path for the full output, not this tool.",
    promptSnippet: "Run a command in the background (timeoutSeconds required); use bash for commands that finish on their own.",
    promptGuidelines: [
      "A background task's completion (finished or timed out) is reported automatically via a follow-up message; do not call background_status in a loop just to detect completion.",
    ],
    parameters: Type.Object({
      command: Type.String({ minLength: 1, description: "The shell command to run in the background" }),
      timeoutSeconds: Type.Number({ minimum: 1, description: "Auto-terminate the command after this many seconds" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const task = manager.start(params.command, ctx.cwd, ctx.sessionManager.getSessionId(), params.timeoutSeconds);
      return {
        content: [
          {
            type: "text",
            text: `Started in background: ${task.id}\nOutput file: ${task.outputPath}`,
          },
        ],
        details: task,
      };
    },
  });
}
