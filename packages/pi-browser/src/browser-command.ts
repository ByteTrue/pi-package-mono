import { execSync, type ExecSyncOptions } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_HEADED,
  DEFAULT_IDLE_TIMEOUT,
  agentBrowserConfigSummary,
  mergeAgentBrowserConfig,
  readAgentBrowserConfig,
  setExecutablePath,
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
  authDir,
  legacyPlaywrightProfileDir,
  officialSkillDir,
  profileDir,
  projectAgentBrowserConfigPath,
} from "./paths.js";
import { resolveAgentBrowserCommand } from "./cli.js";
import {
  deleteAuthState,
  describeAuthState,
  getAuthState,
  listAuthStates,
  loadAuthStateIntoSession,
  renameAuthState,
  saveAuthStateFromSession,
  validateAuthStateName,
  type AuthStateSummary,
} from "./auth-state.js";
import {
  detectAvailableBrowsers,
  findDownloadedChromeForTesting,
  type DetectedBrowser,
} from "./runtime.js";
import {
  checkDashboardStatus,
  openExternalUrl,
  startDashboard,
  stopDashboard,
  type DashboardStatus,
} from "./dashboard.js";
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
const MENU_LOGINS = "Logins";
const MENU_DASHBOARD = "Dashboard";
const MENU_CONFIGURE = "Configure recommended defaults";
const MENU_SETTINGS = "Settings";
const MENU_SESSIONS = "Sessions";
const MENU_SETUP = "Setup commands";
const CLOSE = "Close";
const BACK = "Back";
const CLOSE_ALL = "Close all sessions in namespace";
const CLEAN_STALE = "Clean stale process records";
const ADD_LOGIN = "+ Add new login";
const SIGN_IN_UPDATE = "Sign in / Update";
const RENAME_LOGIN = "Rename";
const VIEW_LOGIN = "View details";
const DELETE_LOGIN = "Delete";
const BROWSER_PREFIX = "Browser: ";
const WINDOW_PREFIX = "Window: ";
const TIMEOUT_PREFIX = "Auto-close after: ";
const IDLE_TIMEOUT_OPTIONS = ["5m", "10m", "30m", "1h"] as const;

export function registerBrowserCommand(pi: ExtensionAPI): void {
  pi.registerCommand("browser", {
    description: "Manage agent-browser — browsers, logins, dashboard, sessions",
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
    const choice = await ctx.ui.select("agent-browser manager", [
      MENU_STATUS,
      MENU_LOGINS,
      MENU_DASHBOARD,
      MENU_CONFIGURE,
      MENU_SETTINGS,
      MENU_SESSIONS,
      MENU_SETUP,
      CLOSE,
    ]);
    if (!choice || choice === CLOSE) return;

    if (choice === MENU_STATUS) await showStatus(pi, ctx);
    else if (choice === MENU_LOGINS) await runLoginsMenu(pi, ctx);
    else if (choice === MENU_DASHBOARD) await runDashboardMenu(pi, ctx);
    else if (choice === MENU_CONFIGURE) configureDefaults(ctx);
    else if (choice === MENU_SETTINGS) await runSettingsMenu(ctx);
    else if (choice === MENU_SESSIONS) await runSessionsMenu(pi, ctx);
    else if (choice === MENU_SETUP) showSetup(ctx);
    else return;
  }
}

/** Copy text to system clipboard across Windows (clip), macOS (pbcopy), and Linux (wl-copy/xclip). */
export function copyTextToClipboard(text: string): boolean {
  try {
    const options: ExecSyncOptions = { input: text, timeout: 3000, stdio: ["pipe", "ignore", "ignore"], encoding: "utf8" };
    if (process.platform === "win32") {
      execSync("clip", options);
      return true;
    }
    if (process.platform === "darwin") {
      execSync("pbcopy", options);
      return true;
    }
    try {
      execSync("wl-copy", options);
      return true;
    } catch {
      execSync("xclip -selection clipboard", options);
      return true;
    }
  } catch {
    return false;
  }
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
  authStatesDir: string;
  authStatesCount: number;
  configPath: string;
  config: Result<JsonObject | undefined>;
  cli: CliProbe;
  browserLabel: string;
  dashboard: DashboardStatus;
  skillPath: string;
  skillInstalled: boolean;
  projectConfigPath: string;
  projectConfigExists: boolean;
  sessions?: SessionResult<string[]>;
};

export function buildStatusReport(facts: StatusFacts): string {
  const lines: string[] = [];
  lines.push(`Saved logins     ${facts.authStatesCount} saved (${facts.authStatesDir})`);
  lines.push(`Browser          ${facts.browserLabel}`);
  lines.push(`Dashboard        ${facts.dashboard.running ? `running on ${facts.dashboard.url}` : "stopped (manage via Dashboard menu)"}`);
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
    if (summary.profile) lines.push(`  profile         ${summary.profile} (legacy — run Configure defaults to clear)`);
    if (summary.namespace) lines.push(`  namespace       ${summary.namespace} (legacy — run Configure defaults to clear)`);
    lines.push(`  engine          ${summary.engine ?? "(unset)"}`);
    lines.push(`  window          ${summary.headed === true ? "visible" : summary.headed === false ? "headless" : "(unset)"}`);
    lines.push(`  idle cleanup    ${summary.idleTimeout === undefined ? "(unset)" : String(summary.idleTimeout)}`);
    lines.push(`  executable      ${summary.executablePath ?? "auto (system default)"}`);
  }

  if (facts.sessions) {
    lines.push(
      `Sessions          ${facts.sessions.ok ? String(facts.sessions.value.length) : `unavailable (${facts.sessions.error})`}`,
    );
  }
  if (facts.projectConfigExists) {
    lines.push(`Project override  ${facts.projectConfigPath}`);
    lines.push("                  this project config may override the user defaults above");
  }
  return lines.join("\n");
}

async function showStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const configPath = agentBrowserConfigPath();
  const config = readAgentBrowserConfig(configPath);
  const [cli, sessions, dashboard] = await Promise.all([
    probeAgentBrowser(execFrom(pi)),
    config.ok && config.value
      ? listAgentBrowserSessions(execFrom(pi), configPath)
      : Promise.resolve(undefined),
    checkDashboardStatus(),
  ]);
  const installedSkillPath = installedAgentBrowserSkillDir();
  const projectConfigPath = projectAgentBrowserConfigPath();
  const savedStates = listAuthStates();

  const summary = config.ok && config.value ? agentBrowserConfigSummary(config.value) : {};
  const currentExe = summary.executablePath;
  const detected = detectAvailableBrowsers();
  const matched = currentExe ? detected.find((b) => b.path === currentExe) : undefined;
  const browserLabel = currentExe
    ? (matched ? `${matched.label} (${currentExe})` : currentExe)
    : "Auto (system default)";

  const facts: StatusFacts = {
    authStatesDir: authDir(),
    authStatesCount: savedStates.length,
    configPath,
    config,
    cli,
    browserLabel,
    dashboard,
    skillPath: installedSkillPath ?? officialSkillDir(),
    skillInstalled: installedSkillPath !== undefined,
    projectConfigPath,
    projectConfigExists: existsSync(projectConfigPath),
    ...(sessions ? { sessions } : {}),
  };
  const report = buildStatusReport(facts);
  copyTextToClipboard(report);
  ctx.ui.notify(report, "info");
}

function configureDefaults(ctx: ExtensionCommandContext): void {
  const configPath = agentBrowserConfigPath();
  const existing = readAgentBrowserConfig(configPath);
  if (!existing.ok) {
    ctx.ui.notify(existing.error, "error");
    return;
  }
  const summary = agentBrowserConfigSummary(existing.value);
  try {
    mkdirSync(authDir(), { recursive: true, mode: 0o700 });
    mkdirSync(artifactsDir(), { recursive: true, mode: 0o700 });
  } catch (error) {
    ctx.ui.notify(
      `Could not create managed directories: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    return;
  }
  const merged = mergeAgentBrowserConfig(existing.value, {
    screenshotDir: artifactsDir(),
    headed: summary.headed ?? DEFAULT_HEADED,
    idleTimeout: summary.idleTimeout ?? DEFAULT_IDLE_TIMEOUT,
    ...(summary.executablePath ? { executablePath: summary.executablePath } : {}),
  });
  const written = writeAgentBrowserConfig(configPath, merged);
  if (!written.ok) {
    ctx.ui.notify(`Could not write the agent-browser config: ${written.error}`, "error");
    return;
  }
  const browserNote = summary.executablePath
    ? ` Selected browser: ${basename(summary.executablePath)}.`
    : " Browser set to Auto (let agent-browser discover; select Edge or Chrome in Settings).";
  ctx.ui.notify(
    `${written.changed ? "Configured" : "Configuration already ready"}: state-based logins (Logins menu) and ${String(summary.idleTimeout ?? DEFAULT_IDLE_TIMEOUT)} idle cleanup.${browserNote}`,
    "info",
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
    "To manage logins (cookies + localStorage):",
    "Open /browser -> Logins to add, sign in, rename, or inspect login credentials.",
    "",
    `The Pi skill is expected below: ${agentDir}/skills/agent-browser`,
  ].join("\n");
}

function showSetup(ctx: ExtensionCommandContext): void {
  const instructions = setupInstructions();
  copyTextToClipboard(instructions);
  ctx.ui.notify(instructions, "info");
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
    const currentExe = summary.executablePath;
    const detected = detectAvailableBrowsers();
    const matched = currentExe ? detected.find((b) => b.path === currentExe) : undefined;
    const browserDisplay = currentExe
      ? (matched ? matched.label : basename(currentExe))
      : "Auto (system default)";

    const browserItem = `${BROWSER_PREFIX}${browserDisplay}`;
    const windowItem = `${WINDOW_PREFIX}${headed ? "visible" : "headless"}`;
    const timeoutItem = `${TIMEOUT_PREFIX}${String(idleTimeout)}`;
    const choice = await ctx.ui.select(
      "Settings — changes apply when a new browser session starts",
      [browserItem, windowItem, timeoutItem, BACK],
    );
    if (!choice || choice === BACK) return;

    if (choice === browserItem) {
      await handleBrowserSelection(ctx, configPath, existing.value, detected);
      continue;
    }

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

async function handleBrowserSelection(
  ctx: ExtensionCommandContext,
  configPath: string,
  config: JsonObject,
  detected: DetectedBrowser[],
): Promise<void> {
  const AUTO_OPTION = "Auto (System default — let agent-browser discover)";
  const CUSTOM_OPTION = "Custom executable path...";

  const options = [
    AUTO_OPTION,
    ...detected.map((b) => `${b.label} (${b.path})`),
    CUSTOM_OPTION,
    BACK,
  ];

  const pick = await ctx.ui.select("Select browser executable", options);
  if (!pick || pick === BACK) return;

  if (pick === AUTO_OPTION) {
    const written = writeAgentBrowserConfig(configPath, setExecutablePath(config, undefined));
    if (!written.ok) ctx.ui.notify(written.error, "error");
    else ctx.ui.notify("Browser set to Auto (system default).", "info");
    return;
  }

  if (pick === CUSTOM_OPTION) {
    const custom = await ctx.ui.input("Enter full path to browser executable (e.g. msedge.exe, chrome.exe):");
    if (!custom) return;
    const trimmed = custom.trim();
    if (!existsSync(trimmed)) {
      ctx.ui.notify(`File not found at: ${trimmed}`, "error");
      return;
    }
    const written = writeAgentBrowserConfig(configPath, setExecutablePath(config, trimmed));
    if (!written.ok) ctx.ui.notify(written.error, "error");
    else ctx.ui.notify(`Browser executable set to ${basename(trimmed)}.`, "info");
    return;
  }

  const idx = detected.findIndex((b) => `${b.label} (${b.path})` === pick);
  if (idx >= 0) {
    const b = detected[idx]!;
    const written = writeAgentBrowserConfig(configPath, setExecutablePath(config, b.path));
    if (!written.ok) ctx.ui.notify(written.error, "error");
    else ctx.ui.notify(`Browser set to ${b.label}.`, "info");
  }
}

async function runDashboardMenu(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const cli = await probeAgentBrowser(execFrom(pi));
  if (cli.state !== "ready") {
    ctx.ui.notify("agent-browser is not ready. Open Setup commands and install or update it first.", "warning");
    return;
  }

  while (true) {
    const status = await checkDashboardStatus();
    const stateLabel = status.running
      ? `Running on ${status.url}`
      : "Stopped";

    const choices = [
      status.running ? "Stop dashboard" : "Start dashboard",
      ...(status.running ? ["Open in browser"] : []),
      BACK,
    ];

    const choice = await ctx.ui.select(`Observability dashboard (${stateLabel})`, choices);
    if (!choice || choice === BACK) return;

    if (choice === "Start dashboard") {
      ctx.ui.notify("Starting observability dashboard...", "info");
      const startRes = await startDashboard(execFrom(pi));
      if (startRes.ok) {
        ctx.ui.notify(`Dashboard started at ${startRes.url}. Choose "Open in browser" to view.`, "info");
      } else {
        ctx.ui.notify(`Could not start dashboard: ${startRes.error}`, "error");
      }
      continue;
    }

    if (choice === "Stop dashboard") {
      const stopRes = await stopDashboard(execFrom(pi));
      if (stopRes.ok) {
        ctx.ui.notify("Dashboard stopped.", "info");
      } else {
        ctx.ui.notify(`Could not stop dashboard: ${stopRes.error}`, "error");
      }
      continue;
    }

    if (choice === "Open in browser") {
      openExternalUrl(status.url);
      ctx.ui.notify(`Opened ${status.url}`, "info");
      continue;
    }
  }
}

async function runLoginsMenu(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const configPath = agentBrowserConfigPath();
  const cli = await probeAgentBrowser(execFrom(pi));
  if (cli.state !== "ready") {
    ctx.ui.notify("agent-browser is not ready. Open Setup commands and install or update it first.", "warning");
    return;
  }

  while (true) {
    const states = listAuthStates();
    const labels = states.map(describeAuthState);
    const choice = await ctx.ui.select(
      `Login data (${states.length} saved)`,
      [
        ...labels,
        ADD_LOGIN,
        BACK,
      ],
    );
    if (!choice || choice === BACK) return;

    if (choice === ADD_LOGIN) {
      await handleAddNewLogin(pi, ctx, configPath);
      continue;
    }

    const state = states[labels.indexOf(choice)];
    if (!state) continue;

    await handleManageExistingLogin(pi, ctx, configPath, state);
  }
}

async function handleAddNewLogin(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  configPath: string,
): Promise<void> {
  const inputName = await ctx.ui.input("Login name (e.g. github, google, v2ex):");
  if (!inputName) return;

  const valid = validateAuthStateName(inputName);
  if (!valid.ok) {
    ctx.ui.notify(valid.error, "error");
    return;
  }
  const name = valid.name;
  if (getAuthState(name)) {
    ctx.ui.notify(`A login named "${name}" already exists.`, "error");
    return;
  }

  const sessionName = `pi-signin-${Date.now().toString(36)}`;
  const exec = execFrom(pi);
  const resolved = resolveAgentBrowserCommand();

  ctx.ui.notify("Opening visible browser window for sign-in...", "info");
  const openResult = await exec(
    resolved.command,
    [...(resolved.args ?? []), "--config", configPath, "--session", sessionName, "--headed", "open", "about:blank"],
    { timeout: 30_000 },
  );
  if (openResult.code !== 0) {
    ctx.ui.notify(`Could not launch browser: ${openResult.stderr || openResult.stdout}`, "error");
    return;
  }

  const confirmed = await ctx.ui.confirm(
    `Save login "${name}"?`,
    "Sign in to your target website(s) in the opened browser window. When finished, click Yes to save cookies and storage, or No to cancel.",
  );

  if (confirmed) {
    const saved = await saveAuthStateFromSession(exec, configPath, sessionName, name);
    if (saved.ok) {
      const summary = saved.summary;
      ctx.ui.notify(
        `Saved login "${name}" (${summary.domains.length} domain(s), ${summary.cookieCount} cookie(s)).`,
        "info",
      );
    } else {
      ctx.ui.notify(`Could not save login state: ${saved.error}`, "error");
    }
  } else {
    ctx.ui.notify("Login creation canceled.", "info");
  }

  await closeAgentBrowserSession(exec, configPath, sessionName);
}

async function handleManageExistingLogin(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  configPath: string,
  initialState: AuthStateSummary,
): Promise<void> {
  let state = initialState;
  while (true) {
    const action = await ctx.ui.select(`Login: ${state.name}`, [
      SIGN_IN_UPDATE,
      VIEW_LOGIN,
      RENAME_LOGIN,
      DELETE_LOGIN,
      BACK,
    ]);
    if (!action || action === BACK) return;

    if (action === SIGN_IN_UPDATE) {
      const sessionName = `pi-signin-${Date.now().toString(36)}`;
      const exec = execFrom(pi);
      const resolved = resolveAgentBrowserCommand();

      ctx.ui.notify(`Opening browser with "${state.name}" credentials loaded...`, "info");
      const openResult = await exec(
        resolved.command,
        [...(resolved.args ?? []), "--config", configPath, "--session", sessionName, "--headed", "open", "about:blank"],
        { timeout: 30_000 },
      );
      if (openResult.code !== 0) {
        ctx.ui.notify(`Could not launch browser: ${openResult.stderr || openResult.stdout}`, "error");
        return;
      }

      await loadAuthStateIntoSession(exec, configPath, sessionName, state.name);

      const confirmed = await ctx.ui.confirm(
        `Update login "${state.name}"?`,
        "The browser window has your saved cookies loaded. Sign in or refresh credentials, then click Yes to save updates, or No to cancel.",
      );

      if (confirmed) {
        const saved = await saveAuthStateFromSession(exec, configPath, sessionName, state.name);
        if (saved.ok) {
          state = saved.summary;
          ctx.ui.notify(`Updated login "${state.name}".`, "info");
        } else {
          ctx.ui.notify(`Could not update login state: ${saved.error}`, "error");
        }
      }

      await closeAgentBrowserSession(exec, configPath, sessionName);
      continue;
    }

    if (action === VIEW_LOGIN) {
      const lines = [
        `Name:      ${state.name}`,
        `Path:      ${state.path}`,
        `Updated:   ${state.mtime.toLocaleString()}`,
        `Size:      ${(state.sizeBytes / 1024).toFixed(1)} KB`,
        `Cookies:   ${state.cookieCount}`,
        `Origins:   ${state.originCount}`,
        `Domains:   ${state.domains.length > 0 ? state.domains.join(", ") : "(none)"}`,
        "",
        "Usage with agent-browser CLI:",
        `  agent-browser --state "${state.path}" open <url>`,
        "",
        "Usage via environment variable in current shell/Pi:",
        `  export AGENT_BROWSER_STATE="${state.path}"`,
      ];
      const text = lines.join("\n");
      copyTextToClipboard(text);
      ctx.ui.notify(text, "info");
      continue;
    }

    if (action === RENAME_LOGIN) {
      const rawNew = await ctx.ui.input(`New name for "${state.name}":`, state.name);
      if (!rawNew || rawNew === state.name) continue;
      const renamed = renameAuthState(state.name, rawNew);
      if (renamed.ok) {
        ctx.ui.notify(`Renamed "${state.name}" to "${renamed.newName}".`, "info");
        const updated = getAuthState(renamed.newName);
        if (updated) state = updated;
        return;
      } else {
        ctx.ui.notify(renamed.error, "error");
      }
      continue;
    }

    if (action === DELETE_LOGIN) {
      const confirmed = await ctx.ui.confirm(
        `Delete login "${state.name}"?`,
        `Permanently removes "${state.name}.json" (${(state.sizeBytes / 1024).toFixed(1)} KB). Agents using this state file will no longer be authenticated.`,
      );
      if (!confirmed) continue;
      const deleted = deleteAuthState(state.name);
      if (deleted.ok) {
        ctx.ui.notify(`Deleted login "${state.name}".`, "info");
        return;
      } else {
        ctx.ui.notify(`Could not delete "${state.name}": ${deleted.error}`, "error");
      }
      continue;
    }
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
      `agent-browser sessions (${sessions.length} running)`,
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
        "Close all sessions in this namespace?",
        `Stops ${sessions.length} session(s), including any login window you opened and any task session another Pi process is using. Login data stays in the persistent Profile. Your daily Chrome and Edge are not targeted.`,
      );
      if (!confirmed) continue;
      const closed = await closeAllAgentBrowserSessions(execFrom(pi), configPath);
      ctx.ui.notify(
        closed.ok ? "Closed all agent-browser sessions in this namespace." : `Could not close sessions: ${closed.error}`,
        closed.ok ? "info" : "error",
      );
      continue;
    }

    const session: AgentBrowserSession | undefined = sessions[labels.indexOf(choice)];
    if (!session) continue;
    const confirmed = await ctx.ui.confirm(
      `Close ${session.name}?`,
      "Stops its agent-browser daemon and the owned Chrome process tree. Login data stays in the persistent Profile; the next command relaunches the browser.",
    );
    if (!confirmed) continue;
    const closed = await closeAgentBrowserSession(execFrom(pi), configPath, session.name);
    if (closed.ok) {
      ctx.ui.notify(`Closed ${session.name}.`, "info");
      continue;
    }
    // Shared-profile contention and wedged daemons make plain close fail;
    // the official offline doctor removes such records without launching anything.
    const recovery = await ctx.ui.select(
      `Could not close ${session.name}: ${closed.error}`,
      [CLEAN_STALE, BACK],
    );
    if (recovery !== CLEAN_STALE) continue;
    const cleaned = await cleanStaleAgentBrowserState(execFrom(pi), configPath);
    ctx.ui.notify(
      cleaned.ok
        ? "Checked daemon state and removed stale pid/socket records."
        : `Could not clean stale records: ${cleaned.error}`,
      cleaned.ok ? "info" : "error",
    );
  }
}
