import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_SHELL_TIMEOUT_SECONDS = 600;

type ShellToolInput = {
  timeout?: number;
  waitSeconds?: number;
};

/**
 * Pi's built-in bash/powershell tools run with no timeout unless the model passes
 * one, so a single runaway foreground command (e.g. `find /`) can wedge the agent
 * for hours. Pi fires `tool_call` before execution and documents mutating
 * `event.input` as supported behavior, so inject a default here. Explicit
 * timeouts are respected as-is. Calls that opt into `waitSeconds` are skipped:
 * they demote to background tasks when the wait expires, and a background task
 * (e.g. a dev server) must not be silently killed by an injected default.
 */
export function registerBashDefaultTimeout(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event) => {
    if (isToolCallEventType<"bash", ShellToolInput>("bash", event) || isToolCallEventType<"powershell", ShellToolInput>("powershell", event)) {
      if (event.input.timeout === undefined && event.input.waitSeconds === undefined) {
        event.input.timeout = DEFAULT_SHELL_TIMEOUT_SECONDS;
      }
    }
  });
}
