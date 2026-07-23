import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { manager } from "../pty/manager.js";
import { buildSessionNotFoundError } from "../pty/utils.js";

export function registerPtyWriteTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "pty_write",
    label: "Write PTY Session",
    description: "Send stdin data to a managed PTY session.",
    promptGuidelines: [
      "Use pty_write to send stdin to an existing PTY session, including control characters like \\x03 for Ctrl-C.",
    ],
    parameters: Type.Object({
      id: Type.String({ minLength: 1 }),
      data: Type.String(),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const success = manager.write(params.id, ctx.sessionManager.getSessionId(), params.data);
      if (!success) throw buildSessionNotFoundError(params.id);

      return {
        content: [{ type: "text", text: `Sent ${JSON.stringify(params.data)} to PTY session ${params.id}.` }],
        details: { id: params.id, data: params.data },
      };
    },
  });
}
