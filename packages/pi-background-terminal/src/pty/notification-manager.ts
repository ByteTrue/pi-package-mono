import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  NOTIFICATION_LINE_TRUNCATE,
  NOTIFICATION_TITLE_TRUNCATE,
  PTY_EXIT_MESSAGE_TYPE,
} from "../constants.js";
import type { PTYSession } from "./types.js";

interface ExitMessageDetails {
  id: string;
  description: string;
  title: string;
  exitCode: number;
  timedOut: boolean;
  lineCount: number;
  lastLine?: string;
}

export class NotificationManager {
  private pi: ExtensionAPI | null = null;
  private currentSessionId: string | null = null;

  init(pi: ExtensionAPI): void {
    this.pi = pi;
  }

  setCurrentSessionId(sessionId: string | null): void {
    this.currentSessionId = sessionId;
  }

  sendExitNotification(session: PTYSession, exitCode: number): void {
    if (!this.pi) return;
    if (!session.notifyOnExit) return;
    if (!this.currentSessionId || session.parentSessionId !== this.currentSessionId) return;

    const lines = session.buffer.read();
    const lastLine = lines.at(-1)?.trim() || undefined;
    const details: ExitMessageDetails = {
      id: session.id,
      description: session.description,
      title: session.title,
      exitCode,
      timedOut: session.timedOut,
      lineCount: lines.length,
      lastLine,
    };

    const title = truncate(session.title, NOTIFICATION_TITLE_TRUNCATE);
    const summary = lastLine ? ` Last line: ${truncate(lastLine, NOTIFICATION_LINE_TRUNCATE)}` : "";
    const status = session.timedOut ? "timed out" : `exited with code ${exitCode}`;

    this.pi.sendMessage(
      {
        customType: PTY_EXIT_MESSAGE_TYPE,
        content: `[${session.id}] ${title} ${status}.${summary}`,
        display: true,
        details,
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  }
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…`;
}
