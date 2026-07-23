import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DEFAULT_READ_LIMIT, MAX_LINE_LENGTH } from "../constants.js";
import { formatLine } from "../pty/formatters.js";
import { manager } from "../pty/manager.js";
import { buildSessionNotFoundError } from "../pty/utils.js";

export function registerPtyReadTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "pty_read",
    label: "Read PTY Session",
    description: "Read buffered output from a managed PTY session.",
    promptGuidelines: [
      "Use pty_read to inspect PTY output. If notifyOnExit was true and you only need completion, wait for the future pty-exit message instead of polling.",
    ],
    parameters: Type.Object({
      id: Type.String({ minLength: 1 }),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
      pattern: Type.Optional(Type.String({ minLength: 1 })),
      ignoreCase: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const limit = params.limit ?? DEFAULT_READ_LIMIT;
      const offset = params.offset ?? 0;

      if (params.pattern) {
        let regex: RegExp;
        try {
          regex = new RegExp(params.pattern, params.ignoreCase ? "i" : undefined);
        } catch (error) {
          throw new Error(`Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`);
        }
        const result = manager.search(params.id, parentSessionId, regex, offset, limit);
        if (!result) throw buildSessionNotFoundError(params.id);

        const body = [
          `Found ${result.matches.length} of ${result.totalMatches} matches in ${result.totalLines} lines.`,
          ...result.matches.map((match) => formatLine(match.text, match.lineNumber, MAX_LINE_LENGTH)),
        ].join("\n");

        return {
          content: [{ type: "text", text: body }],
          details: result,
        };
      }

      const result = manager.read(params.id, parentSessionId, offset, limit);
      if (!result) throw buildSessionNotFoundError(params.id);

      const body = [
        `Read ${result.lines.length} of ${result.totalLines} lines.`,
        ...result.lines.map((line, index) => formatLine(line, offset + index + 1, MAX_LINE_LENGTH)),
      ].join("\n");

      return {
        content: [{ type: "text", text: body }],
        details: result,
      };
    },
  });
}
