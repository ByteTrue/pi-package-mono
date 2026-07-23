import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { manager } from "../pty/manager.js";
import { buildSessionNotFoundError } from "../pty/utils.js";

export function registerPtyKillTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "pty_kill",
    label: "Kill PTY Session",
    description: "Stop or clean up a managed PTY session.",
    promptGuidelines: [
      "Use pty_kill to stop or clean up PTY sessions when the user asks to stop background work.",
    ],
    parameters: Type.Object({
      id: Type.String({ minLength: 1 }),
      cleanup: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const success = manager.kill(params.id, ctx.sessionManager.getSessionId(), params.cleanup ?? false);
      if (!success) throw buildSessionNotFoundError(params.id);

      return {
        content: [{
          type: "text",
          text: params.cleanup
            ? `Stopped and removed PTY session ${params.id}.`
            : `Sent kill to PTY session ${params.id}.`,
        }],
        details: { id: params.id, cleanup: params.cleanup ?? false },
      };
    },
  });
}
