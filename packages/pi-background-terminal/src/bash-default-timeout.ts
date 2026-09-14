import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_SHELL_TIMEOUT_SECONDS = 600;

type ShellToolInput = {
  timeout?: number;
};

/**
 * Default 600s timeout for the built-in shell tools (bash, powershell): Pi runs them with
 * no timeout unless the model passes one, so a single runaway foreground command
 * (`find /`) can wedge the agent for hours. Pi fires `tool_call` before execution and
 * documents mutating `event.input` as supported behavior, so inject the default here.
 * Explicit timeouts are respected as-is.
 *
 * This is a safety net, not a coupling: no tool is registered, overridden, or executed
 * here — only a missing parameter gets a default value. background_run resolves its
 * own 600s lifetime default inside its execute.
 */
export function registerBashDefaultTimeout(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event) => {
    if (
      isToolCallEventType<"bash", ShellToolInput>("bash", event) ||
      isToolCallEventType<"powershell", ShellToolInput>("powershell", event)
    ) {
      if (event.input.timeout === undefined) {
        event.input.timeout = DEFAULT_SHELL_TIMEOUT_SECONDS;
      }
    }
  });
}
