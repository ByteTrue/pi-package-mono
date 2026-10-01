import {
  createLocalBashOperations,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { Type } from "typebox";
import { SHELL_TIMEOUT_SECONDS } from "../bash-default-timeout.js";
import { manager } from "../background/manager.js";

/** Default total lifetime: hard-kill bound for a background task with no explicit timeout. */
export const DEFAULT_LIFETIME_SECONDS = 600;

/**
 * Hard cap on a background task's total lifetime, explicit timeout included (seconds).
 * Rationale: background tasks are cleared on session_shutdown, so no task outlives its
 * session anyway — the cap bounds how long a *zombie* task may burn resources inside a
 * live session. It also bounds the renew loop: a dev server started with the cap must be
 * restarted (and its consumers reconnected) every time it fires, and that reconnect cost
 * is real work — 3600s fired inside a single working session and cost more than the
 * zombie ceiling it bought (2026-10-01 用户口径). 8 hours spans any working session —
 * the cap now fires only for genuinely forgotten tasks; the ceiling itself
 * stays (0.8.x taught 86400 for dev servers, which is 不设上限 in practice — see ff 099).
 */
export const HARD_CAP_LIFETIME_SECONDS = 28_800;

/**
 * `background_run` — a pure background executor. It never waits, never returns command
 * output inline; it starts the command and returns a task id immediately. The exit
 * (natural, failed, or timed-out) wakes the agent with a follow-up.
 *
 * The selection axis against the built-in bash is "do you need the result now":
 * the model knows this before calling — no duration prediction involved. bash is the
 * foreground executor (native, untouched); background_run is for anything that should
 * run hands-off: builds, test suites, dev servers, watch modes.
 *
 * Dual inheritance from the 077/078 work, minus the wait path:
 * - timeout defaults to 600s total lifetime; explicit values are honored up to the
 *   hard cap (`HARD_CAP_LIFETIME_SECONDS`), above which they are clamped — and a timed-out
 *   dev server renews by restarting (the wake-up message says so);
 * - the exit notification (followUp + triggerTurn) fires exactly once per task.
 *
 * This being a pure background tool, print/json sessions (pi -p, subagent children)
 * need no special-casing: there is no wait to keep alive. The task runs while the
 * session lives and dies with the Pi process — in pi -p the process exits with the
 * turn (the exit notification cannot arrive), in TUI/RPC it fires normally.
 */
export function registerBackgroundRunTool(pi: ExtensionAPI): void {
  let cached: {
    key: string;
    settings: { commandPrefix?: string; shellPath?: string };
  } | null = null;

  pi.registerTool({
    name: "background_run",
    label: "Run Command in Background",
    description: `Starts a shell command in the background and returns immediately with a task id; the command keeps running on its own. Use it for work that should run hands-off — builds, test suites, dev servers, watch mode. When you need the output to decide your next step, use bash instead. After it starts, continue with other work or end your turn: its exit — natural, failed, or timed-out — arrives as a new message that starts your next turn. That notification is how you wait. The command is hard-killed after timeout seconds (default ${DEFAULT_LIFETIME_SECONDS}, hard cap ${HARD_CAP_LIFETIME_SECONDS} — larger values are clamped). A dev server that hits the cap is renewed by restarting it with background_run; the timeout notification tells you when. Full output streams to a file (path in the result); use read on that path.`,
    promptSnippet: `Start a command in the background; its exit arrives later as a new message. Use bash when you need the result now.`,
    // Positive-first wording (decision 001): each line says what to do; the wait model is stated
    // explicitly because a bare "do not poll" left a vacuum the model filled with `sleep`.
    promptGuidelines: [
      "Use background_run for work that should run hands-off — builds, test suites, dev servers, watch mode — anything you can leave running while you do other things",
      "When you need a command's output to decide your next step, use bash — it blocks and returns the output",
      "After background_run returns, the command is already running: continue with other work or end your turn. Its exit arrives as a new message that starts your next turn — that notification is how you wait. background_status is for a one-off look at partial output",
      `timeout is a hard lifetime cap (default ${DEFAULT_LIFETIME_SECONDS}s, hard cap ${HARD_CAP_LIFETIME_SECONDS}s — larger values are clamped); pass a larger value for dev servers and watch modes, and restart with background_run when the timeout notification arrives to renew them`,
      `bash/powershell are hard-killed after ${SHELL_TIMEOUT_SECONDS}s (this extension injects the default and caps explicit values at ${SHELL_TIMEOUT_SECONDS}); when a command needs longer, run it with background_run and a larger timeout instead of blocking on bash`,
    ],
    parameters: Type.Object({
      command: Type.String({ minLength: 1, description: "The shell command to run in the background" }),
      timeout: Type.Optional(
        Type.Number({
          minimum: 0.001,
          maximum: 2147483,
          description: `Hard lifetime cap in seconds. Defaults to ${DEFAULT_LIFETIME_SECONDS}; clamped to ${HARD_CAP_LIFETIME_SECONDS} — restart with background_run on the timeout notification to renew long-running services.`,
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // Settings are resolved from the live ctx: an untrusted project's settings must not
      // influence shell resolution here, exactly like Pi's own built-in creation.
      const key = `${ctx.isProjectTrusted() ? "t" : "u"}:${ctx.cwd}`;
      if (cached?.key !== key) {
        cached = { key, settings: resolveShellOptions(ctx.cwd, ctx.isProjectTrusted()) };
      }
      const timeoutSeconds = Math.min(params.timeout ?? DEFAULT_LIFETIME_SECONDS, HARD_CAP_LIFETIME_SECONDS);
      const task = manager.start(params.command, ctx.cwd, ctx.sessionManager.getSessionId(), {
        timeoutSeconds,
        operations: createLocalBashOperations({ shellPath: cached.settings.shellPath }),
        env: sessionEnv(ctx),
        commandPrefix: cached.settings.commandPrefix,
      });
      return {
        content: [
          {
            type: "text",
            text: `Started in background: ${task.id}\nOutput file: ${task.outputPath}\nHard timeout: ${timeoutSeconds}s. Its exit will arrive as a new message — continue with other work or end your turn now. Until then the output file is partial.`,
          },
        ],
        details: task,
      };
    },
  });
}

function resolveShellOptions(cwd: string, trusted: boolean): { commandPrefix?: string; shellPath?: string } {
  // The built-in shell tools run with the user's shellPath / shellCommandPrefix settings;
  // the extension API does not expose the live SettingsManager, so read the same files
  // through SettingsManager itself, honoring the project-trust decision. A broken settings
  // file must not take the extension down — fall back to defaults.
  try {
    const settings = SettingsManager.create(cwd, undefined, { projectTrusted: trusted });
    return {
      commandPrefix: settings.getShellCommandPrefix(),
      shellPath: settings.getShellPath() ?? undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Mirrors the built-in tool's session environment (PI_SESSION_ID and friends) plus the
 * agent bin dir prepended to PATH — the built-in does this via getShellEnv()
 * (dist/utils/shell.js), which is not exported from the package entry. Replicated here
 * (six lines, same semantics: prepend only when absent, case-insensitive PATH key on
 * Windows). Upgrade trigger: switch to the upstream export if one ever appears.
 */
function sessionEnv(ctx: ExtensionContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PI_SESSION_ID;
  delete env.PI_SESSION_FILE;
  delete env.PI_PROVIDER;
  delete env.PI_MODEL;
  delete env.PI_REASONING_LEVEL;
  env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (sessionFile) env.PI_SESSION_FILE = sessionFile;
  if (ctx.model) {
    env.PI_PROVIDER = ctx.model.provider;
    env.PI_MODEL = ctx.model.id;
  }
  if (ctx.thinkingLevel) env.PI_REASONING_LEVEL = ctx.thinkingLevel;

  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const binDir = join(agentDir, "bin");
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const currentPath = env[pathKey] ?? "";
  if (currentPath.split(delimiter).filter(Boolean).includes(binDir)) {
    env[pathKey] = currentPath;
  } else {
    env[pathKey] = [binDir, currentPath].filter(Boolean).join(delimiter);
  }
  return env;
}
