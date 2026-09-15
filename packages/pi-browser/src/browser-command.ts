import { existsSync, mkdirSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Text, matchesKey, type Component } from "@earendil-works/pi-tui";
import {
  DEFAULT_HEADED,
  DEFAULT_IDLE_TIMEOUT,
  MANAGED_NAMESPACE,
  MANAGED_SESSION,
  agentBrowserConfigSummary,
  mergeAgentBrowserConfig,
  readAgentBrowserConfig,
  setHeaded,
  setIdleTimeout,
  writeAgentBrowserConfig,
  type AgentBrowserConfigSummary,
  type JsonObject,
  type Result,
} from "./config.js";
import {
  CLOSE_BROWSER_COMMAND,
  INSTALL_BROWSER_COMMAND,
  INSTALL_CLI_COMMAND,
  INSTALL_SKILL_COMMAND,
  MIN_AGENT_BROWSER_VERSION,
  OPEN_SIGN_IN_COMMAND,
  installedAgentBrowserSkillDir,
  probeAgentBrowser,
  type CliProbe,
  type ExecFn,
} from "./env.js";
import {
  activeConfigDir,
  agentBrowserConfigPath,
  artifactsDir,
  legacyPlaywrightProfileDir,
  officialSkillDir,
  profileDir,
  projectAgentBrowserConfigPath,
} from "./paths.js";
import { findDownloadedChromeForTesting } from "./runtime.js";
import {
  cleanStaleAgentBrowserState,
  closeAgentBrowserSession,
  closeAllAgentBrowserSessions,
  collectAgentBrowserSessions,
  describeSession,
  listAgentBrowserSessions,
  type AgentBrowserSession,
  type SessionResult,
} from "./sessions.js";

const MENU_STATUS = "Status";
const MENU_CONFIGURE = "Configure recommended defaults";
const MENU_SETTINGS = "Settings";
const MENU_SESSIONS = "Sessions";
const MENU_SETUP = "Setup commands";
const CLOSE = "Close";
const BACK = "Back";
const CLOSE_ALL = "Close all managed sessions";
const CLEAN_STALE = "Clean stale process records";
const WINDOW_PREFIX = "Window: ";
const TIMEOUT_PREFIX = "Auto-close after: ";
const IDLE_TIMEOUT_OPTIONS = ["5m", "10m", "30m", "1h"] as const;

export function registerBrowserCommand(pi: ExtensionAPI): void {
  pi.registerCommand("browser", {
    description: "Configure agent-browser and clean up its managed sessions",
    handler: async (_args, ctx) => {
      await runBrowserCommand(pi, ctx);
    },
  });
}

export async function runBrowserCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!ctx.hasUI) return;

  while (true) {
    const choice = await ctx.ui.select("Browser", [
      MENU_STATUS,
      MENU_CONFIGURE,
      MENU_SETTINGS,
      MENU_SESSIONS,
      MENU_SETUP,
      CLOSE,
    ]);
    if (!choice || choice === CLOSE) return;

    if (choice === MENU_STATUS) await showStatus(pi, ctx);
    else if (choice === MENU_CONFIGURE) configureDefaults(ctx);
    else if (choice === MENU_SETTINGS) await runSettingsMenu(ctx);
    else if (choice === MENU_SESSIONS) await runSessionsMenu(pi, ctx);
    else if (choice === MENU_SETUP) await showSetup(ctx);
    else return;
  }
}

/** Read-only panel matching Pi's own dialogs. */
export function makeReadOnlyPanel(
  theme: { fg(color: "border" | "muted", text: string): string },
  text: string,
  done: () => void,
): Component {
  const box = new Container();
  const border = (value: string) => theme.fg("border", value);
  box.addChild(new DynamicBorder(border));
  box.addChild(new Text(text, 1, 0));
  box.addChild(new Text(theme.fg("muted", "Esc — close"), 1, 0));
  box.addChild(new DynamicBorder(border));
  return {
    render(width: number): string[] {
      return box.render(width);
    },
    invalidate(): void {
      box.invalidate();
    },
    handleInput(data: string): void {
      if (matchesKey(data, "escape") || data === "\r" || data === "\n" || data === "q") done();
    },
  };
}

async function showReadOnlyPanel(
  ctx: ExtensionCommandContext,
  title: string,
  text: string,
): Promise<void> {
  await ctx.ui.custom<void>(
    (_tui, theme, _keybindings, done) => makeReadOnlyPanel(theme, `${title}\n\n${text}`, done),
    { overlay: true, overlayOptions: { width: "76%", minWidth: 52, maxHeight: "85%" } },
  );
}

function execFrom(pi: ExtensionAPI): ExecFn {
  return (command, args, options) => pi.exec(command, args, options);
}

export function describeCli(cli: CliProbe): string {
  if (cli.state === "missing") return `not found (${cli.detail})`;
  if (cli.state === "outdated") return `${cli.version} — update to >= ${MIN_AGENT_BROWSER_VERSION}`;
  return `${cli.version} — ready`;
}

export type StatusFacts = {
  profilePath: string;
  profileExists: boolean;
  legacyProfileExists: boolean;
  configPath: string;
  config: Result<JsonObject | undefined>;
  cli: CliProbe;
  chromeForTestingPath?: string;
  skillPath: string;
  skillInstalled: boolean;
  projectConfigPath: string;
  projectConfigExists: boolean;
  sessions?: SessionResult<string[]>;
};

export function buildStatusReport(facts: StatusFacts): string {
  const lines: string[] = [];
  lines.push(`Profile          ${facts.profilePath} (${facts.profileExists ? "exists" : "not created yet"})`);
  lines.push(
    `Test browser     ${facts.chromeForTestingPath ?? "not found — run Setup commands, including agent-browser install"}`,
  );
  lines.push(`agent-browser    ${describeCli(facts.cli)}`);
  lines.push(
    `Official skill   ${facts.skillPath} (${facts.skillInstalled ? "installed" : "missing — run the Setup command"})`,
  );

  if (!facts.config.ok) {
    lines.push(`Config            ${facts.configPath}`);
    lines.push(`                  unusable: ${facts.config.error}`);
  } else if (!facts.config.value) {
    lines.push(`Config            ${facts.configPath} (missing — choose Configure recommended defaults)`);
  } else {
    const summary = agentBrowserConfigSummary(facts.config.value);
    lines.push(`Config            ${facts.configPath}`);
    lines.push(`  profile         ${summary.profile ?? "(unset)"}`);
    lines.push(`  session         ${summary.session ?? "(unset)"}`);
    lines.push(`  namespace       ${summary.namespace ?? "(unset)"}`);
    lines.push(`  engine          ${summary.engine ?? "(unset)"}`);
    lines.push(`  window          ${summary.headed === true ? "visible" : summary.headed === false ? "headless" : "(unset)"}`);
    lines.push(`  idle cleanup    ${summary.idleTimeout === undefined ? "(unset)" : String(summary.idleTimeout)}`);
    if (summary.executablePath) lines.push(`  executable      ${summary.executablePath}`);
  }

  if (facts.sessions) {
    lines.push(
      `Managed sessions ${facts.sessions.ok ? String(facts.sessions.value.length) : `unavailable (${facts.sessions.error})`}`,
    );
  }
  if (facts.projectConfigExists) {
    lines.push(`Project override  ${facts.projectConfigPath}`);
    lines.push("                  this project config may override the user defaults above");
  }
  if (facts.legacyProfileExists) {
    lines.push("Legacy data       old Playwright profile still exists and is intentionally not reused or deleted");
  }
  return lines.join("\n");
}

async function showStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const configPath = agentBrowserConfigPath();
  const config = readAgentBrowserConfig(configPath);
  const [cli, sessions] = await Promise.all([
    probeAgentBrowser(execFrom(pi)),
    config.ok && config.value
      ? listAgentBrowserSessions(execFrom(pi), configPath)
      : Promise.resolve(undefined),
  ]);
  const installedSkillPath = installedAgentBrowserSkillDir();
  const projectConfigPath = projectAgentBrowserConfigPath();
  const facts: StatusFacts = {
    profilePath: profileDir(),
    profileExists: existsSync(profileDir()),
    legacyProfileExists: existsSync(legacyPlaywrightProfileDir()),
    configPath,
    config,
    cli,
    chromeForTestingPath: findDownloadedChromeForTesting(),
    skillPath: installedSkillPath ?? officialSkillDir(),
    skillInstalled: installedSkillPath !== undefined,
    projectConfigPath,
    projectConfigExists: existsSync(projectConfigPath),
    ...(sessions ? { sessions } : {}),
  };
  await showReadOnlyPanel(ctx, "Browser status", buildStatusReport(facts));
}

function configureDefaults(ctx: ExtensionCommandContext): void {
  const configPath = agentBrowserConfigPath();
  const existing = readAgentBrowserConfig(configPath);
  if (!existing.ok) {
    ctx.ui.notify(existing.error, "error");
    return;
  }
  const summary = agentBrowserConfigSummary(existing.value);
  const testBrowser = findDownloadedChromeForTesting();
  try {
    mkdirSync(profileDir(), { recursive: true, mode: 0o700 });
    mkdirSync(artifactsDir(), { recursive: true, mode: 0o700 });
  } catch (error) {
    ctx.ui.notify(
      `Could not create the managed Profile directories: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    return;
  }
  const merged = mergeAgentBrowserConfig(existing.value, {
    profile: profileDir(),
    screenshotDir: artifactsDir(),
    headed: summary.headed ?? DEFAULT_HEADED,
    idleTimeout: summary.idleTimeout ?? DEFAULT_IDLE_TIMEOUT,
    ...(testBrowser ? { executablePath: testBrowser } : {}),
  });
  const written = writeAgentBrowserConfig(configPath, merged);
  if (!written.ok) {
    ctx.ui.notify(`Could not write the agent-browser config: ${written.error}`, "error");
    return;
  }
  const browserNote = testBrowser
    ? " Chrome for Testing is selected."
    : " Chrome for Testing is not installed yet; run the commands under Setup.";
  ctx.ui.notify(
    `${written.changed ? "Configured" : "Configuration already ready"}: one persistent Profile, session ${MANAGED_SESSION}, and ${String(summary.idleTimeout ?? DEFAULT_IDLE_TIMEOUT)} idle cleanup.${browserNote}`,
    testBrowser ? "info" : "warning",
  );
}

export function setupInstructions(agentDir: string = activeConfigDir()): string {
  return [
    "Run these commands yourself in a terminal; pi-browser will not execute them:",
    "",
    INSTALL_CLI_COMMAND,
    INSTALL_BROWSER_COMMAND,
    INSTALL_SKILL_COMMAND,
    "",
    "Then return to /browser and choose Configure recommended defaults.",
    "",
    "Sign in once using the same persistent Profile:",
    OPEN_SIGN_IN_COMMAND,
    "",
    "When you are done signing in:",
    CLOSE_BROWSER_COMMAND,
    "",
    `The Pi skill is expected below: ${agentDir}/skills/agent-browser`,
  ].join("\n");
}

async function showSetup(ctx: ExtensionCommandContext): Promise<void> {
  await showReadOnlyPanel(ctx, "Setup commands", setupInstructions());
}

async function runSettingsMenu(ctx: ExtensionCommandContext): Promise<void> {
  const configPath = agentBrowserConfigPath();
  while (true) {
    const existing = readAgentBrowserConfig(configPath);
    if (!existing.ok) {
      ctx.ui.notify(existing.error, "error");
      return;
    }
    if (!existing.value) {
      ctx.ui.notify("No agent-browser config yet. Choose Configure recommended defaults first.", "warning");
      return;
    }
    const summary = agentBrowserConfigSummary(existing.value);
    const headed = summary.headed ?? DEFAULT_HEADED;
    const idleTimeout = summary.idleTimeout ?? DEFAULT_IDLE_TIMEOUT;
    const windowItem = `${WINDOW_PREFIX}${headed ? "visible" : "headless"}`;
    const timeoutItem = `${TIMEOUT_PREFIX}${String(idleTimeout)}`;
    const choice = await ctx.ui.select(
      "Settings — changes apply when a new browser session starts",
      [windowItem, timeoutItem, BACK],
    );
    if (!choice || choice === BACK) return;

    if (choice === windowItem) {
      const written = writeAgentBrowserConfig(configPath, setHeaded(existing.value, !headed));
      if (!written.ok) ctx.ui.notify(`Could not update the config: ${written.error}`, "error");
      else ctx.ui.notify(`New sessions will open ${headed ? "headless" : "in a visible window"}.`, "info");
      continue;
    }

    const timeoutChoice = await ctx.ui.select(
      "Auto-close — applies even to a visible browser after no agent-browser activity",
      [...IDLE_TIMEOUT_OPTIONS, BACK],
    );
    if (!timeoutChoice || timeoutChoice === BACK) continue;
    const written = writeAgentBrowserConfig(
      configPath,
      setIdleTimeout(existing.value, timeoutChoice),
    );
    if (!written.ok) ctx.ui.notify(`Could not update the config: ${written.error}`, "error");
    else ctx.ui.notify(`Idle browser sessions will close after ${timeoutChoice}.`, "info");
  }
}

async function runSessionsMenu(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const configPath = agentBrowserConfigPath();
  if (!readAgentBrowserConfig(configPath).ok || !existsSync(configPath)) {
    ctx.ui.notify("Configure agent-browser first, then Sessions can inspect its namespace.", "warning");
    return;
  }
  const cli = await probeAgentBrowser(execFrom(pi));
  if (cli.state !== "ready") {
    ctx.ui.notify("agent-browser is not ready. Open Setup commands and install or update it first.", "warning");
    return;
  }

  while (true) {
    const collected = await collectAgentBrowserSessions(execFrom(pi), configPath);
    if (!collected.ok) {
      const recovery = await ctx.ui.select(
        `Could not list agent-browser sessions: ${collected.error}`,
        [CLEAN_STALE, BACK],
      );
      if (recovery !== CLEAN_STALE) return;
      const cleaned = await cleanStaleAgentBrowserState(execFrom(pi), configPath);
      ctx.ui.notify(
        cleaned.ok
          ? "Checked daemon state and removed stale pid/socket records."
          : `Could not clean stale records: ${cleaned.error}`,
        cleaned.ok ? "info" : "error",
      );
      if (!cleaned.ok) return;
      continue;
    }
    const sessions = collected.value;
    const labels = sessions.map(describeSession);
    const choice = await ctx.ui.select(
      `Managed agent-browser sessions (${sessions.length} running)`,
      [
        ...labels,
        ...(sessions.length > 0 ? [CLOSE_ALL] : []),
        CLEAN_STALE,
        BACK,
      ],
    );
    if (!choice || choice === BACK) return;

    if (choice === CLEAN_STALE) {
      const cleaned = await cleanStaleAgentBrowserState(execFrom(pi), configPath);
      ctx.ui.notify(
        cleaned.ok
          ? "Checked daemon state and removed stale pid/socket records."
          : `Could not clean stale records: ${cleaned.error}`,
        cleaned.ok ? "info" : "error",
      );
      continue;
    }

    if (choice === CLOSE_ALL) {
      const confirmed = await ctx.ui.confirm(
        "Close all managed browser sessions?",
        `Stops ${sessions.length} session(s) in the ${MANAGED_NAMESPACE} namespace. Your daily Chrome and Edge are not targeted.`,
      );
      if (!confirmed) continue;
      const closed = await closeAllAgentBrowserSessions(execFrom(pi), configPath);
      ctx.ui.notify(
        closed.ok ? "Closed all managed agent-browser sessions." : `Could not close sessions: ${closed.error}`,
        closed.ok ? "info" : "error",
      );
      continue;
    }

    const session: AgentBrowserSession | undefined = sessions[labels.indexOf(choice)];
    if (!session) continue;
    const confirmed = await ctx.ui.confirm(
      `Close ${session.name}?`,
      "Stops its agent-browser daemon and the owned Chrome process tree. The persistent Profile remains on disk.",
    );
    if (!confirmed) continue;
    const closed = await closeAgentBrowserSession(execFrom(pi), configPath, session.name);
    ctx.ui.notify(
      closed.ok ? `Closed ${session.name}.` : `Could not close ${session.name}: ${closed.error}`,
      closed.ok ? "info" : "error",
    );
  }
}
