import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_SHELL_TIMEOUT_SECONDS = 600;

/**
 * Pi's built-in bash/powershell tools run with no timeout unless the model passes
 * one, so a single runaway foreground command (e.g. `find /`) can wedge the agent
 * for hours. Pi fires `tool_call` before execution and documents mutating
 * `event.input` as supported behavior, so inject a default here. Explicit
 * timeouts are respected as-is; background tasks (background_run) never pass
 * through this hook — they are supposed to run long.
 */
export function registerBashDefaultTimeout(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event) => {
    if (isToolCallEventType("bash", event) || isToolCallEventType("powershell", event)) {
      if (event.input.timeout === undefined) {
        event.input.timeout = DEFAULT_SHELL_TIMEOUT_SECONDS;
      }
    }
  });
}
