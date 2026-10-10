/**
 * pi-bash-timeout — optional 300s default-and-cap for Pi's built-in bash/powershell tools.
 *
 * A small-extension: shipped as this single file (no npm package, no build step) and
 * installed by scripts/install-small-extension.sh / .ps1 into ~/.pi/agent/extensions/.
 * Zero runtime imports — the installed artifact is exactly this file; jiti loads
 * TypeScript directly (type-only imports disappear at load time).
 *
 * Why it exists: Pi's built-in bash runs with no timeout unless the model passes one, so
 * a single runaway foreground command (`find /`) can wedge the agent for hours. This is
 * the safety net @bytetrue/pi-background-terminal carried until its 0.12.0 (BYTE-10,
 * GitHub #3): some setups' architecture checks statically scan installed packages and
 * reject foreground-timeout hook source, so the hook lives here — not installing this
 * file means the cap is simply absent, and installing it pulls in no background tooling.
 *
 * Surface: a tool_call hook injects `timeout: 300` when bash/powershell passes none
 * (degenerate values like 0 count as absent) and clamps explicit values above 300s down
 * to it; a tool_result hook appends one steering block to timeout errors (long commands
 * belong in background_run). No tool is registered, overridden, or executed here.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Default and hard cap for the built-in shell tools' timeout parameter, in seconds. */
export const SHELL_TIMEOUT_SECONDS = 300;

/** A usable timeout: finite, positive, a real number. Anything else counts as absent.
 * Note: `0` is treated as absent on purpose — Node convention reads it as "infinite",
 * and an unbounded foreground command is exactly what this hook exists to prevent.
 * Same semantics as background_run's lifetime guard in @bytetrue/pi-background-terminal
 * (its src/shell-timeout.ts). Deliberate copy, not a shared module: this file must stay
 * dependency-free, and repo packages never depend on each other. */
export function isUsableTimeout(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

type ShellToolInput = {
  timeout?: number;
};

const TIMEOUT_ERROR_PATTERN = /Command timed out after \d+ seconds/;
// Source of that wording: pi core's bash/powershell execute throws
// `Command timed out after ${n} seconds` (dist/core/tools/bash.js). If a core release
// ever reformats it, steering silently stops — the cap itself is unaffected (it keys on
// the input parameter, not this text). Re-align on upgrade.

const TIMEOUT_STEERING =
  `[pi-bash-timeout] Foreground shell commands are hard-capped at ${SHELL_TIMEOUT_SECONDS}s by this extension. ` +
  "If the command legitimately needs longer, start it with background_run and a larger timeout — its exit arrives as a new message. " +
  "If it should have finished quickly, it probably hung; find out why before retrying it in the foreground.";

export function registerBashDefaultTimeout(pi: ExtensionAPI): void {
  // Narrowing by toolName equality instead of pi's isToolCallEventType helper: calling
  // that helper would need a runtime import from the pi package, and this file must stay
  // import-free to work as a dropped-in single file. The comparison is the same one the
  // helper performs.
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash" && event.toolName !== "powershell") return;
    const input = event.input as ShellToolInput;
    if (!isUsableTimeout(input.timeout)) {
      input.timeout = SHELL_TIMEOUT_SECONDS;
    } else if (input.timeout > SHELL_TIMEOUT_SECONDS) {
      input.timeout = SHELL_TIMEOUT_SECONDS;
    }
  });

  pi.on("tool_result", async (event) => {
    if (!event.isError) return;
    if (event.toolName !== "bash" && event.toolName !== "powershell") return;
    if (!event.content.some((block) => block.type === "text" && TIMEOUT_ERROR_PATTERN.test(block.text))) return;
    // Echo every field: agent-session replaces (not merges) details/isError/usage with
    // the hook result's, so dropping them here would lose truncation info and the
    // full-output path that ride on `details`.
    return {
      content: [...event.content, { type: "text" as const, text: TIMEOUT_STEERING }],
      details: event.details,
      isError: event.isError,
      ...(event.usage ? { usage: event.usage } : {}),
    };
  });
}

/** Extension entry point (jiti loads the default export). */
export default function registerBashTimeout(pi: ExtensionAPI): void {
  registerBashDefaultTimeout(pi);
}
