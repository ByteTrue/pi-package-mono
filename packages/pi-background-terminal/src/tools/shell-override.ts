import {
  createBashToolDefinition,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { manager } from "../background/manager.js";

/**
 * bash override with one added parameter: `waitSeconds`.
 *
 * - omitted  -> pure delegation to the built-in execute (byte-identical behavior)
 * - 0        -> start in the background immediately (replaces background_run)
 * - N > 0    -> wait up to N seconds: inline output if the command exits in time,
 *               otherwise it moves to the background and its exit notifies the agent
 *
 * Schema, rendering and the default path all come from the built-in definition;
 * we only add one property and branch on it. Renderer inheritance is per-slot:
 * omitting renderCall/renderResult means the built-in renderers are used.
 *
 * The powershell builtin is deliberately NOT overridden: extension-registered
 * tools are force-activated into the tool list, so registering an override would
 * add a powershell tool that the default active set never includes. The 600s
 * default-timeout hook still covers powershell by tool name.
 */
export function registerShellOverride(pi: ExtensionAPI): void {
  // Prototype only supplies static fields (label, promptSnippet, promptGuidelines, schema);
  // the delegating definition is created lazily per session cwd + trust state.
  const proto = createBashToolDefinition(process.cwd());
  let cached: {
    key: string;
    definition: ReturnType<typeof createBashToolDefinition>;
    settings: { commandPrefix?: string; shellPath?: string };
  } | null = null;

  const parameters = Type.Object({
    ...proto.parameters.properties,
    waitSeconds: Type.Optional(
      Type.Number({
        minimum: 0,
        description:
          "How long to wait synchronously for the command to finish. If it is still running after this many seconds it automatically moves to the background and you are notified when it exits. 0 starts it in the background immediately. Omit to wait for the command like a normal foreground call.",
      }),
    ),
  });

  pi.registerTool({
    name: "bash",
    label: proto.label,
    description: `${proto.description} waitSeconds moves a still-running command to the background instead of blocking: set it when you want the result soon but must not hang on it.`,
    promptSnippet: proto.promptSnippet,
    promptGuidelines: proto.promptGuidelines,
    parameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { waitSeconds, ...baseParams } = params;
      // Trust and cwd come from the live ctx: an untrusted project's settings must not
      // influence shell resolution here, exactly like Pi's own built-in creation.
      const key = `${ctx.isProjectTrusted() ? "t" : "u"}:${ctx.cwd}`;
      if (cached?.key !== key) {
        const settings = resolveBashOptions(ctx.cwd, ctx.isProjectTrusted());
        cached = { key, definition: createBashToolDefinition(ctx.cwd, settings), settings };
      }
      if (waitSeconds === undefined) {
        return cached.definition.execute(toolCallId, baseParams, signal, onUpdate, ctx);
      }
      return manager.runWithWait(params.command, ctx.cwd, ctx.sessionManager.getSessionId(), {
        waitMs: waitSeconds * 1000,
        signal,
        settings: cached.settings,
        env: sessionEnv(ctx),
        timeoutSeconds: params.timeout,
      });
    },
  });
}

function resolveBashOptions(cwd: string, trusted: boolean): { commandPrefix?: string; shellPath?: string } {
  // The built-in bash tool is created with the user's shellPath / shellCommandPrefix
  // settings; the extension API does not expose the live SettingsManager, so read the
  // same files through SettingsManager itself, honoring the project-trust decision.
  // A broken settings file must not take the extension down — fall back to defaults.
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
 * Mirrors the built-in tool's session environment (PI_SESSION_ID and friends), which the
 * tool's own promptGuidelines promise to the model. Base env is process.env — the built-in
 * additionally prepends the agent bin dir to PATH, which is not exported; a PATH-dependent
 * command failing only in waitSeconds mode is the upgrade trigger for replicating that.
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
  return env;
}
