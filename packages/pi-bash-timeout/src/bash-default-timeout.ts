import {
  isBashToolResult,
  isPowerShellToolResult,
  isToolCallEventType,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

/** Default and hard cap for the built-in shell tools' timeout parameter, in seconds. */
export const SHELL_TIMEOUT_SECONDS = 300;

type ShellToolInput = {
  timeout?: number;
};

/** A usable timeout: finite, positive, a real number. Anything else counts as absent.
 * Note: `0` is treated as absent on purpose — Node convention reads it as "infinite",
 * and an unbounded foreground command is exactly what this hook exists to prevent.
 * Same semantics as background_run's lifetime guard in @bytetrue/pi-background-terminal,
 * so both surfaces answer "was a timeout actually passed?" identically. Deliberate copy,
 * not a shared module: packages in this repo never depend on each other. */
export function isUsableTimeout(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 300s timeout for the built-in shell tools (bash, powershell): Pi runs them with
 * no timeout unless the model passes one, so a single runaway foreground command
 * (`find /`) can wedge the agent for hours. Pi fires `tool_call` before execution and
 * documents mutating `event.input` as supported behavior, so inject the default here.
 *
 * The default is also a cap: an explicit timeout above 300s is clamped down. An agent
 * turn blocked on one foreground command is wedged — user, subagents, everything waits —
 * so no foreground bash call may outlive 300s. Commands that legitimately need longer
 * (builds, test suites, dev servers) have a real home: background_run (from
 * @bytetrue/pi-background-terminal) with a large timeout, which reports its exit as a
 * new message instead of blocking the turn. The cap also guards against prompt-side
 * drift teaching the model to sidestep the default by passing a large value (real
 * incident, 2026-09: `agent-browser open` hung for tens of minutes behind an
 * explicitly passed timeout).
 *
 * This is a safety net, not a coupling: no tool is registered, overridden, or executed
 * here — only a missing parameter gets a default value and an oversized one gets clamped.
 * background_run (when installed) resolves its own (longer) lifetime default inside its
 * execute.
 *
 * Second surface: when a shell command dies on the 300s cap, the raw error the model
 * sees says only "Command timed out after N seconds" — nothing about the cap or the
 * recovery path. 079's audit deferred in-result steering until real usage proved the
 * need; that proof arrived (2026-09: the model repeatedly retried the same hung
 * foreground command after each timeout kill). So a `tool_result` handler appends
 * one steering block at the moment of failure, when it actually has the model's
 * attention — recency a static guideline cannot buy.
 */
const TIMEOUT_ERROR_PATTERN = /Command timed out after \d+ seconds/;
// Source of that wording: pi core's bash/powershell execute throws
// `Command timed out after ${n} seconds` (dist/core/tools/bash.js). If a core release
// ever reformats it, this hook silently stops steering — the 300s cap itself is
// unaffected (it keys on the input parameter, not this text). Re-align on upgrade.

const TIMEOUT_STEERING =
  `[pi-bash-timeout] Foreground shell commands are hard-capped at ${SHELL_TIMEOUT_SECONDS}s by this extension. ` +
  "If the command legitimately needs longer, start it with background_run and a larger timeout — its exit arrives as a new message. " +
  "If it should have finished quickly, it probably hung; find out why before retrying it in the foreground.";

export function registerBashDefaultTimeout(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event) => {
    if (
      isToolCallEventType<"bash", ShellToolInput>("bash", event) ||
      isToolCallEventType<"powershell", ShellToolInput>("powershell", event)
    ) {
      if (!isUsableTimeout(event.input.timeout)) {
        event.input.timeout = SHELL_TIMEOUT_SECONDS;
      } else if (event.input.timeout > SHELL_TIMEOUT_SECONDS) {
        event.input.timeout = SHELL_TIMEOUT_SECONDS;
      }
    }
  });

  pi.on("tool_result", async (event) => {
    if (!event.isError) return;
    if (!isBashToolResult(event) && !isPowerShellToolResult(event)) return;
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
