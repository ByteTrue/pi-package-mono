import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { checkCommandPermission, checkWorkdirPermission } from "../pty/permissions.js";
import { formatSessionInfo } from "../pty/formatters.js";
import { manager } from "../pty/manager.js";

export function registerPtySpawnTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "pty_spawn",
    label: "Spawn PTY Session",
    description: "Start a managed background terminal session backed by a real PTY.",
    promptSnippet:
      "Run a command in a managed background PTY session that you can later read, write to, list, kill, or watch in the web monitor.",
    promptGuidelines: [
      "Use pty_spawn instead of bash when the command should keep running after the tool returns, when you may need to send stdin later, or when you may need to inspect logs later. Do not use bash with &, nohup, setsid, screen, or tmux when pty_spawn covers the need.",
    ],
    parameters: Type.Object({
      command: Type.String({ minLength: 1 }),
      args: Type.Optional(Type.Array(Type.String())),
      description: Type.String({ minLength: 1 }),
      workdir: Type.Optional(Type.String({ minLength: 1 })),
      env: Type.Optional(Type.Record(Type.String(), Type.String())),
      title: Type.Optional(Type.String({ minLength: 1 })),
      notifyOnExit: Type.Optional(Type.Boolean()),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params.args ?? [];
      await checkCommandPermission(params.command, args);
      if (params.workdir) await checkWorkdirPermission(params.workdir);

      const session = manager.spawn({
        command: params.command,
        args,
        description: params.description,
        workdir: params.workdir ?? ctx.cwd,
        env: params.env,
        title: params.title,
        notifyOnExit: params.notifyOnExit,
        timeoutSeconds: params.timeoutSeconds,
        parentSessionId: ctx.sessionManager.getSessionId(),
      });

      return {
        content: [{ type: "text", text: formatSessionInfo(session).join("\n") }],
        details: session,
      };
    },
  });
}
