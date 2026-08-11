import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { manager } from "../background/manager.js";

export function registerBackgroundRunTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "background_run",
    label: "Run Command in Background",
    description:
      "Start a shell command without waiting. Use for dev servers, watch mode, or long builds/tests; use bash otherwise. Returns a task id and output-file path; read that file for output. The task ends on exit, background_kill, or session shutdown.",
    promptSnippet: "Start a long-running shell command without waiting.",
    parameters: Type.Object({
      command: Type.String({ minLength: 1, description: "Shell command to run." }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const task = manager.start(params.command, ctx.cwd, ctx.sessionManager.getSessionId());
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
