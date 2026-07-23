import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { PTY_EXIT_MESSAGE_TYPE } from "./constants.js";

interface ExitMessageDetails {
  id: string;
  description: string;
  title: string;
  exitCode: number;
  timedOut: boolean;
  lineCount: number;
  lastLine?: string;
}

export function registerMessageRenderers(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(PTY_EXIT_MESSAGE_TYPE, (message, { expanded }, theme) => {
    const details = message.details as ExitMessageDetails | undefined;
    let text = `${theme.fg("accent", "[pty-exit]")} ${message.content}`;
    if (expanded && details) {
      text += `\n${theme.fg("dim", `description: ${details.description}`)}`;
      text += `\n${theme.fg("dim", `exitCode: ${details.exitCode}`)}`;
      text += `\n${theme.fg("dim", `lineCount: ${details.lineCount}`)}`;
      if (details.lastLine) text += `\n${theme.fg("dim", `lastLine: ${details.lastLine}`)}`;
    }
    return new Text(text, 0, 0);
  });
}
