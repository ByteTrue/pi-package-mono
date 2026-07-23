import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatSessionInfo } from "../pty/formatters.js";
import { manager } from "../pty/manager.js";

export function registerPtyListTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "pty_list",
    label: "List PTY Sessions",
    description: "List managed PTY sessions for the current Pi session.",
    promptGuidelines: [
      "Use pty_list to discover managed PTY sessions before reading, writing to, or killing them.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const sessions = manager.list(ctx.sessionManager.getSessionId());
      const text = sessions.length === 0
        ? "No PTY sessions yet."
        : sessions.flatMap((session) => formatSessionInfo(session)).join("\n");

      return {
        content: [{ type: "text", text }],
        details: sessions,
      };
    },
  });
}
