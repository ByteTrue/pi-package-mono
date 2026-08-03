import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { manager } from "../background/manager.js";

export function registerBackgroundKillTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "background_kill",
    label: "Stop Background Task",
    description: "Stops a running command started with background_run.",
    promptSnippet: "Stop a running background task started with background_run.",
    parameters: Type.Object({
      id: Type.String({ minLength: 1, description: "The task id returned by background_run" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const task = manager.get(params.id, parentSessionId);
      if (!task) throw new Error(`No background task found with id "${params.id}".`);
      if (task.status !== "running") {
        return {
          content: [{ type: "text", text: `[${task.id}] is already ${task.status}; nothing to stop.` }],
          details: task,
        };
      }

      // The task can finish between the get() above and here; report what actually happened.
      if (!manager.kill(params.id, parentSessionId)) {
        const settled = manager.get(params.id, parentSessionId) ?? task;
        return {
          content: [{ type: "text", text: `[${settled.id}] finished on its own (${settled.status}); nothing to stop.` }],
          details: settled,
        };
      }

      return {
        content: [{ type: "text", text: `Stopped ${task.id} (${task.command}).` }],
        details: manager.get(params.id, parentSessionId) ?? task,
      };
    },
  });
}
