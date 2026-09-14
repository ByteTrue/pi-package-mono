import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Text, matchesKey, type Component } from "@earendil-works/pi-tui";
import { managedBrowserSummary, mergePlaywrightConfig, readPlaywrightConfig, setHeadless, writePlaywrightConfig, type JsonObject, type ManagedBrowserConfig } from "./config.js";
import { INSTALL_CLI, INSTALL_SKILL, MIN_CLI_VERSION, isPlaywrightSkillInstalled, probePlaywrightCli, type CliProbe, type ExecFn, type InstallCommand } from "./env.js";
import { clearProfileData, isProfileInUse, readProfileLockPid } from "./import/apply.js";
import { detectSourceBrowsers, profilePath, type DetectedBrowser, type DetectedProfile } from "./import/detect.js";
import { importProfileData, type ImportSource } from "./import/pipeline.js";
import { measureItems, planSnapshotItems } from "./import/snapshot.js";
import { closeCliSession, closeCliSessions, collectSessionViews, describeSession, killAllCliSessions } from "./sessions.js";
import { closeLoginWindow, LOGIN_SESSION, openLoginWindow, runImportSmoke } from "./import/verify.js";
import { DEFAULT_PROFILE_NAME, artifactsDir, officialSkillDir, playwrightConfigPath, profileDir, signInConfigPath, smokeConfigPath, statePath } from "./paths.js";
import { assertImportDestination, COPY_PROFILE_DIRECTORY, copyHasData, copyTarget, currentTarget, listTargets, type Target } from "./target.js";
import { initialBrowserState, readBrowserState, writeBrowserState, type PiBrowserState } from "./state.js";

const MENU_STATUS = "Status";
const MENU_DATA = "Data";
const MENU_SESSIONS = "Sessions";
const MENU_SETTINGS = "Settings";
const MENU_SETUP = "Setup";
const IMPORT = "Import login data";
const REIMPORT = "Re-import";
const MANUAL = "Manual sign-in (opens a window)";
const CLEAR = "Clear imported data";
const CLOSE = "Close";
const BACK = "Back";
const TARGET_ITEM_PREFIX = "Target: ";
const CLOSE_ALL = "Close all sessions";
const CLOSE_ONE = "Close this session";
const KILL_ALL = "Force kill all sessions (all workspaces)";
const GO_HEADED = "Open headed (visible window)";
const GO_HEADLESS = "Open headless (no window)";

export function registerBrowserCommand(pi: ExtensionAPI): void {
  pi.registerCommand("browser", {
    description: "Set up official playwright-cli/skill and manage the imported browser profile",
    handler: async (_args, ctx) => {
      await runBrowserCommand(pi, ctx);
    },
  });
}

export async function runBrowserCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) return;

  while (true) {
    const choice = await ctx.ui.select("Browser", [
      MENU_STATUS,
      TARGET_ITEM_PREFIX + describeTarget(),
      MENU_DATA,
      MENU_SESSIONS,
      MENU_SETTINGS,
      MENU_SETUP,
      CLOSE,
    ]);
    if (!choice || choice === CLOSE) return;

    if (choice === MENU_STATUS) {
      await showStatus(pi, ctx);
    } else if (choice.startsWith(TARGET_ITEM_PREFIX)) {
      await runTargetMenu(ctx);
    } else if (choice === MENU_DATA) {
      await runDataMenu(pi, ctx);
    } else if (choice === MENU_SESSIONS) {
      await runSessionsMenu(pi, ctx);
    } else if (choice === MENU_SETTINGS) {
      await runSettingsMenu(ctx);
    } else if (choice === MENU_SETUP) {
      await runSetup(pi, ctx);
    } else {
      return;
    }
  }
}

/** What playwright-cli drives right now, per the CLI config. */
function describeTarget(): string {
  const target = currentTarget();
  if (!target) return "(none — pick one)";
  if (target.kind === "copy" && !copyHasData()) return target.label + ", no data yet";
  return target.label;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Who holds a profile right now, named for error messages. */
export function lockHolder(target: Target): string | undefined {
  const pid = readProfileLockPid(target.userDataDir);
  if (pid === undefined || !processAlive(pid)) return undefined;
  return target.browserLabel + " (pid " + String(pid) + ")";
}

/** Read-only panel: bordered like Pi's own dialogs, closed with Esc/Enter/q — no editable editor box. */
export function makeReadOnlyPanel(theme: { fg(color: "border" | "muted", text: string): string }, text: string, done: () => void): Component {
  const box = new Container();
  const border = (str: string) => theme.fg("border", str);
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

async function showReadOnlyPanel(ctx: ExtensionCommandContext, title: string, text: string): Promise<void> {
  await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
    return makeReadOnlyPanel(theme, title + "\n\n" + text, done);
  }, { overlay: true, overlayOptions: { width: "70%", minWidth: 48, maxHeight: "80%" } });
}

function execFrom(pi: ExtensionAPI): ExecFn {
  return (command, args, options) => pi.exec(command, args, options);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return value.toFixed(value >= 10 ? 0 : 1) + " " + units[index];
}

async function showStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const target = profileDir();
  const configPath = playwrightConfigPath();
  const skillPath = officialSkillDir();
  const current = currentTarget();
  const facts: StatusFacts = {
    profilePath: target,
    profileExists: existsSync(target),
    configPath,
    config: readPlaywrightConfig(configPath),
    cli: await probePlaywrightCli(execFrom(pi)),
    skillInstalled: isPlaywrightSkillInstalled(skillPath),
    skillPath,
    state: readBrowserState(statePath()),
    artifactsPath: artifactsDir(),
    target: current,
    targetLockedBy: current ? lockHolder(current) : undefined,
  };
  await showReadOnlyPanel(ctx, "Browser status", buildStatusReport(facts));
}

export type StatusFacts = {
  profilePath: string;
  profileExists: boolean;
  configPath: string;
  config: { ok: boolean; value?: JsonObject; error?: string };
  cli: CliProbe;
  skillInstalled: boolean;
  skillPath: string;
  state?: PiBrowserState;
  artifactsPath: string;
  target?: Target;
  targetLockedBy?: string;
};

/** Last non-empty line of an install run, used as the one-line success toast. */
export function summarizeInstallSuccess(output: string): string | undefined {
  const lines = output
    .split("\n")
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : undefined;
}

export function describeCli(cli: CliProbe): string {
  if (cli.state === "missing") return "not found (" + cli.detail + ")";
  if (cli.state === "outdated") return cli.version + " — needs >= " + MIN_CLI_VERSION;
  return cli.version + " — ready (>= " + MIN_CLI_VERSION + ")";
}

export function buildStatusReport(facts: StatusFacts): string {
  const lines: string[] = [];
  const target = facts.target;
  lines.push("Target         " + (target ? target.label + "  [" + (target.kind === "copy" ? "copy, owned by pi-browser" : "YOUR REAL PROFILE") + "]" : "(none — pick one in Target)"));
  if (target?.kind === "real") {
    lines.push("               the agent drives your daily browser as you; changes may sync to other devices");
    lines.push("               locked by: " + (facts.targetLockedBy ?? "nobody — usable now"));
  }
  if (!target || target.kind === "copy") {
    lines.push("Copy profile   " + facts.profilePath + " (" + (facts.profileExists ? "exists" : "no data yet") + ")");
  }
  if (facts.state?.lastImport) {
    const last = facts.state.lastImport;
    const size = typeof last.bytesCopied === "number" ? ", " + formatBytes(last.bytesCopied) : "";
    lines.push("Last import    " + last.importedAt + " from " + last.sourceBrowserLabel + " / " + last.sourceProfile + size);
  } else {
    lines.push("Last import    (none)");
  }
  lines.push("Artifacts      " + facts.artifactsPath);

  if (!facts.config.ok) {
    lines.push("CLI config     " + facts.configPath);
    lines.push("               unusable: " + (facts.config.error ?? "unknown error"));
  } else if (!facts.config.value) {
    lines.push("CLI config     " + facts.configPath + " (missing — run Setup, then pick a Target)");
  } else {
    const summary = managedBrowserSummary(facts.config.value);
    lines.push("CLI config     " + facts.configPath);
    lines.push("  channel      " + (summary.channel ?? "(unset)"));
    lines.push("  userDataDir  " + (summary.userDataDir ?? "(unset)"));
    if (summary.profileDirectory) lines.push("  profile      " + summary.profileDirectory);
    lines.push("  headless     " + (summary.headless === undefined ? "(unset)" : String(summary.headless)));
    lines.push("  mock keychain disabled: " + (summary.mockKeychainDisabled ? "yes" : "no"));
  }

  lines.push("playwright-cli " + describeCli(facts.cli));
  if (facts.cli.state !== "ready") {
    lines.push("               run Setup to install or update it.");
  }
  lines.push("Official skill " + facts.skillPath + " (" + (facts.skillInstalled ? "installed" : "missing") + ")");
  if (!facts.skillInstalled) {
    lines.push("               run Setup to install it; Pi reads ~/.agents/skills.");
  }
  return lines.join("\n");
}

/**
 * Choose what playwright-cli drives. Selecting a target only rewrites the CLI config —
 * it never copies or deletes browser data. Real profiles need explicit informed consent.
 */
async function runTargetMenu(ctx: ExtensionCommandContext): Promise<void> {
  while (true) {
    const { copy, real } = listTargets();
    const current = currentTarget();
    const options = [
      copy.label + (current?.kind === "copy" ? "  — current" : ""),
      ...real.map((entry) => entry.label + (current && entry.id === current.id ? "  — current" : "")),
    ];
    const choice = await ctx.ui.select(
      "Target — what playwright-cli drives. Picking one only changes the config; it imports nothing.",
      [...options, BACK],
    );
    if (!choice || choice === BACK) return;
    const index = options.indexOf(choice);
    const picked = index === 0 ? copy : real[index - 1];
    if (!picked) return;
    if (current && picked.id === current.id) {
      ctx.ui.notify("Already the current target.", "info");
      continue;
    }
    await applyTarget(ctx, picked);
    return;
  }
}

/** Real profiles are writable by the agent and synced to other devices: ask before pointing at one. */
async function informedConsent(ctx: ExtensionCommandContext, target: Target): Promise<boolean> {
  return ctx.ui.confirm(
    "Drive your own " + target.label + "?",
    "This points playwright-cli at your daily browser profile. Consequences:\n" +
      "  - The agent acts as you in your real profile: it writes your history and cookies,\n" +
      "    and can read and post on every site you are signed in to.\n" +
      "  - Your browser syncs those changes to your other devices.\n" +
      "  - It only works while " + target.browserLabel + " is fully closed (one process per profile).\n" +
      "  - Launching large profiles has been observed to be slow or to fail; the copy profile\n" +
      "    is the supported path.\n" +
      lockLine(target),
  );
}

function lockLine(target: Target): string {
  const holder = lockHolder(target);
  return holder
    ? "\nCurrently held by: " + holder + " — close it first."
    : "\nNot currently locked — the config will be updated straight away.";
}

async function applyTarget(ctx: ExtensionCommandContext, target: Target): Promise<void> {
  if (target.kind === "real") {
    const holder = lockHolder(target);
    if (holder) {
      ctx.ui.notify("Your " + target.label + " is running (" + holder + "). Close it first, or pick the copy profile.", "warning");
      return;
    }
    if (!(await informedConsent(ctx, target))) return;
  } else if (!copyHasData()) {
    ctx.ui.notify("The copy profile has no data yet — run Data → Import login data to fill it.", "info");
  }

  const written = writeManagedConfig(target);
  if (!written.ok) {
    ctx.ui.notify("Could not update the CLI config: " + written.error, "error");
    return;
  }
  ctx.ui.notify(
    "Now driving " + target.label + "." +
      (target.kind === "real" ? " Warning: the agent works as you, in your real profile." : ""),
    "info",
  );
}

/** Import always lands in the copy we own; choosing it does not change the current target. */
async function runDataMenu(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  while (true) {
    const choice = await ctx.ui.select(
      "Data — copies login data into the copy profile. The copy is never your daily browser, and a re-import replaces its contents wholesale.",
      [IMPORT, REIMPORT, MANUAL, CLEAR, BACK],
    );
    if (!choice || choice === BACK || choice === CLOSE) return;

    if (choice === IMPORT) {
      await runImportFlow(pi, ctx);
    } else if (choice === REIMPORT) {
      await runImportFlow(pi, ctx, { reuseLast: true });
    } else if (choice === MANUAL) {
      await runManualSignIn(pi, ctx);
    } else if (choice === CLEAR) {
      await runClearFlow(ctx);
    } else {
      return;
    }
  }
}

/**
 * Guided sign-in: open the managed profile in a visible window, wait for the user to
 * finish, then close it ourselves. Closing the window by hand does NOT free the profile
 * (the browser process and its SingletonLock survive), so this flow always ends in an
 * explicit `close` — otherwise the next import or agent session is blocked.
 */
async function runManualSignIn(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  // Always the copy profile: this window must not touch whatever the agent is driving,
  // and never the user's daily profile (launching that rewrites their data).
  const target = profileDir();
  if (!existsSync(target)) {
    ctx.ui.notify("The managed profile does not exist yet. Run Import login data first.", "warning");
    return;
  }
  if (isProfileInUse(target)) {
    ctx.ui.notify("The managed browser profile is in use. Close it in Sessions first.", "warning");
    return;
  }
  const { copy } = listTargets();
  const configPath = signInConfigPath();
  const merged = mergePlaywrightConfig(undefined, {
    channel: copy.channel,
    userDataDir: target,
    profileDirectory: COPY_PROFILE_DIRECTORY,
    headless: false,
    outputDir: artifactsDir(),
  });
  if (!merged.ok) {
    ctx.ui.notify("Could not prepare the sign-in config: " + merged.error, "error");
    return;
  }
  const written = writePlaywrightConfig(configPath, merged.value);
  if (!written.ok) {
    ctx.ui.notify("Could not write the sign-in config: " + written.error, "error");
    return;
  }

  const confirmed = await ctx.ui.confirm(
    "Open a sign-in window?",
    "Opens " + copy.label + " in a visible window. Sign in there, then come back here and press Enter —\n" +
      "this flow closes the window and frees the profile for you.\n" +
      "Note: a later Re-import overwrites these sign-ins.\n" +
      "If you close the window by hand, this flow still performs the cleanup.",
  );
  if (!confirmed) return;

  ctx.ui.setStatus("pi-browser", "opening window…");
  const opened = await openLoginWindow(execFrom(pi), configPath);
  ctx.ui.setStatus("pi-browser", undefined);
  if (!opened.ok) {
    ctx.ui.notify("Could not open the sign-in window: " + opened.detail, "error");
    return;
  }

  ctx.ui.notify("Sign-in window open — sign in there, then return to this prompt.", "info");
  // One blocking prompt carries the whole wait: any reply (including Esc) ends the flow,
  // and the close below runs either way so the profile never stays pinned.
  await ctx.ui.input(
    "Signing in — finish in the browser window, then press Enter here to close it",
    "Press Enter (or Esc) when done",
  );

  ctx.ui.setStatus("pi-browser", "closing window…");
  const closed = await closeLoginWindow(execFrom(pi));
  ctx.ui.setStatus("pi-browser", undefined);
  if (!closed.ok) {
    ctx.ui.notify(
      "Sign-in finished, but the window could not be closed: " + closed.detail + " — use /browser → Sessions.",
      "warning",
    );
    return;
  }
  ctx.ui.notify("Sign-in window closed; the profile is free. A later Re-import will overwrite these logins.", "info");
}

async function runSetup(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  while (true) {
    const cli = await probePlaywrightCli(execFrom(pi));
    const choice = await ctx.ui.select("Setup — playwright-cli " + describeCli(cli), [
      INSTALL_CLI.label,
      INSTALL_SKILL.label,
      BACK,
    ]);
    if (!choice || choice === BACK) return;

    if (choice === INSTALL_CLI.label) {
      const confirmed = await ctx.ui.confirm("Run this command?", INSTALL_CLI.label);
      if (!confirmed) continue;
      await runInstall(pi, ctx, INSTALL_CLI);
      continue;
    }

    if (cli.state !== "ready") {
      ctx.ui.notify("Install or update @playwright/cli first.", "warning");
      continue;
    }
    const confirmed = await ctx.ui.confirm("Run this command?", INSTALL_SKILL.label);
    if (!confirmed) continue;
    await runInstall(pi, ctx, INSTALL_SKILL);
  }
}

async function runInstall(pi: ExtensionAPI, ctx: ExtensionCommandContext, command: InstallCommand): Promise<void> {
  ctx.ui.setStatus("pi-browser", "installing…");
  try {
    const result = await pi.exec(command.command, command.args, { timeout: 300_000 });
    const output = (result.stdout + "\n" + result.stderr).trim();
    if (result.code === 0) {
      // Quiet on success: a toast with the CLI's own last line, not an editor full of build noise.
      ctx.ui.notify(summarizeInstallSuccess(output) ?? (command.label + " finished."), "info");
    } else {
      ctx.ui.notify(command.label + " failed with exit code " + String(result.code) + ".", "error");
      if (output) {
        await showReadOnlyPanel(
          ctx,
          "Install output — press Esc to close",
          output.length > 8000 ? output.slice(-8000) : output,
        );
      }
    }
  } catch (error) {
    ctx.ui.notify(command.label + " failed: " + (error instanceof Error ? error.message : String(error)), "error");
  } finally {
    ctx.ui.setStatus("pi-browser", undefined);
  }
}

function writeManagedConfig(
  target: Target,
): { ok: true; backupPath?: string } | { ok: false; error: string } {
  const path = playwrightConfigPath();
  const existing = readPlaywrightConfig(path);
  if (!existing.ok) return { ok: false, error: existing.error };
  // Keep a headless choice from an earlier write / Settings toggle; the first defaults to headless.
  const headless = managedBrowserSummary(existing.value).headless ?? true;
  const managed: ManagedBrowserConfig = {
    channel: target.channel,
    userDataDir: target.userDataDir,
    profileDirectory: target.profileDirectory,
    headless,
    outputDir: artifactsDir(),
  };
  const merged = mergePlaywrightConfig(existing.value, managed);
  if (!merged.ok) return { ok: false, error: merged.error };
  const written = writePlaywrightConfig(path, merged.value);
  if (!written.ok) return { ok: false, error: written.error };
  return { ok: true, ...(written.backupPath ? { backupPath: written.backupPath } : {}) };
}

async function runSettingsMenu(ctx: ExtensionCommandContext): Promise<void> {
  const path = playwrightConfigPath();
  const existing = readPlaywrightConfig(path);
  if (!existing.ok) {
    ctx.ui.notify(existing.error, "error");
    return;
  }
  if (!existing.value) {
    ctx.ui.notify("No CLI config yet. Run Import login data first — it writes the browser settings.", "warning");
    return;
  }

  const summary = managedBrowserSummary(existing.value);
  const headless = summary.headless ?? true;
  const title =
    "Settings — sessions open " + (headless ? "headless" : "headed") + " — to change the browser or profile, use Target";
  const choice = await ctx.ui.select(title, [headless ? GO_HEADED : GO_HEADLESS, BACK]);
  if (!choice || choice === BACK) return;

  const next = setHeadless(existing.value, !headless);
  if (!next.ok) {
    ctx.ui.notify(next.error, "error");
    return;
  }
  const written = writePlaywrightConfig(path, next.value);
  if (!written.ok) {
    ctx.ui.notify("Could not update the CLI config: " + written.error, "error");
    return;
  }
  ctx.ui.notify(
    headless
      ? "Headless off — new sessions open a visible window. Running sessions are unaffected."
      : "Headless on — new sessions run without a window. Running sessions are unaffected.",
    "info",
  );
}

async function runImportFlow(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  options: { reuseLast?: boolean; pinnedBrowserId?: string } = {},
): Promise<void> {
  let browser: DetectedBrowser | undefined;
  let profile: DetectedProfile | undefined;

  if (options.reuseLast) {
    const last = readBrowserState(statePath())?.lastImport;
    if (!last) {
      ctx.ui.notify('No previous import to repeat. Use "Import login data" first.', "warning");
      return;
    }
    const detected = detectSourceBrowsers().find((entry) => entry.id === last.sourceBrowserId);
    if (!detected) {
      ctx.ui.notify(last.sourceBrowserLabel + " is not installed (or its profile is gone).", "warning");
      return;
    }
    browser = detected;
    profile = detected.profiles.find((entry) => profilePath(detected, entry) === last.sourceProfileDir);
    if (!profile) {
      ctx.ui.notify("That profile no longer exists in " + detected.label + ".", "warning");
      return;
    }
  } else {
    const browsers = detectSourceBrowsers();
    if (browsers.length === 0) {
      ctx.ui.notify("No supported browsers found (Microsoft Edge or Google Chrome).", "warning");
      return;
    }

    if (options.pinnedBrowserId) {
      // Browser already chosen via the Browser menu — jump straight to the profile.
      const pinned = browsers.find((entry) => entry.id === options.pinnedBrowserId);
      if (!pinned) {
        ctx.ui.notify("That browser is not installed (or its profile is gone).", "warning");
        return;
      }
      browser = pinned;
    } else {
      const browserChoice = await ctx.ui.select("Import login data — source browser", [
        ...browsers.map((entry) => entry.label),
        BACK,
      ]);
      if (!browserChoice || browserChoice === BACK) return;
      browser = browsers.find((entry) => entry.label === browserChoice);
      if (!browser) return;
    }

    const profileOptions = browser.profiles.map((entry) => entry.name + "  (" + entry.dir + ")");
    const profileChoice = await ctx.ui.select("Profile — " + browser.label, [...profileOptions, BACK]);
    if (!profileChoice || profileChoice === BACK) return;
    profile = browser.profiles[profileOptions.indexOf(profileChoice)];
    if (!profile) return;
  }

  const sourceProfileDir = profilePath(browser, profile);
  const items = planSnapshotItems(sourceProfileDir);
  if (items.length === 0) {
    ctx.ui.notify("Nothing importable in " + sourceProfileDir + " (no cookies or storage found).", "warning");
    return;
  }

  // Hard gate, checked on every import: the destination must be a profile we own.
  // Importing replaces files wholesale, so a daily profile as destination would mean
  // wiping the user's own logins.
  const target = profileDir();
  const refusal = assertImportDestination(target, listTargets().real.map((entry) => entry.userDataDir));
  if (refusal) {
    ctx.ui.notify(refusal, "error");
    return;
  }
  const bytes = measureItems(items);
  const confirmed = await ctx.ui.confirm(
    "Import login data?",
    "From:  " + browser.label + " / " + profile.name + "\n" +
      "Data:  " + items.map((item) => item.kind).join(", ") + " (about " + formatBytes(bytes) + ")\n" +
      "Into:  " + target + " (the copy profile; your daily browser is never written)\n" +
      "Whatever is already in the copy is replaced, including manual sign-ins.\n" +
      "Choosing this does not change the current Target.\n" +
      "Google-style source-bound logins may still need a fresh sign-in.",
  );
  if (!confirmed) return;

  if (isProfileInUse(target)) {
    ctx.ui.notify("The managed browser profile is in use. Close it and retry.", "warning");
    return;
  }

  const source: ImportSource = {
    browserId: browser.id,
    browserLabel: browser.label,
    channel: browser.channel,
    profileDir: sourceProfileDir,
    profileName: profile.name,
  };

  ctx.ui.setStatus("pi-browser", "importing…");
  const outcome = importProfileData({ source, targetProfileDir: target });
  ctx.ui.setStatus("pi-browser", undefined);
  if (!outcome.ok) {
    ctx.ui.notify("Import failed: " + outcome.error, "error");
    return;
  }

  // Importing fills the copy; it must not silently retarget the user's current choice.
  const keep = currentTarget();
  const configResult = writeManagedConfig(keep ?? copyTarget(browser.channel));
  if (!configResult.ok) {
    ctx.ui.notify("Data imported, but writing the CLI config failed: " + configResult.error, "error");
    return;
  }
  writeBrowserState(statePath(), {
    version: 1,
    profileName: DEFAULT_PROFILE_NAME,
    lastImport: outcome.summary,
  });

  const cli = await probePlaywrightCli(execFrom(pi));
  let smokeNote = "";
  if (cli.state === "ready") {
    ctx.ui.setStatus("pi-browser", "checking…");
    const smoke = await runImportSmoke(execFrom(pi), {
      channel: browser.channel,
      userDataDir: target,
      profileDirectory: COPY_PROFILE_DIRECTORY,
      headless: true,
      outputDir: artifactsDir(),
    }, smokeConfigPath());
    ctx.ui.setStatus("pi-browser", undefined);
    smokeNote = smoke.ok ? " Browser check passed." : " Browser check failed: " + smoke.detail;
  } else {
    smokeNote = " Skipped browser check: playwright-cli not ready.";
  }

  const backupNote = configResult.backupPath ? " Previous config backed up to " + configResult.backupPath + "." : "";
  const warningNote = outcome.warnings.length > 0 ? " " + outcome.warnings.join(" ") : "";
  const level = smokeNote.includes("failed") ? "warning" : "info";
  ctx.ui.notify(
    "Imported " + items.length + " item(s), " + formatBytes(outcome.bytes) + ", from " + browser.label + " / " + profile.name + "." +
      backupNote + smokeNote + warningNote,
    level,
  );
}

async function runSessionsMenu(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  while (true) {
    const collected = await collectSessionViews(execFrom(pi));
    if (!collected.ok) {
      ctx.ui.notify("Could not list playwright-cli sessions: " + collected.error, "error");
      return;
    }
    const views = collected.views;
    if (views.length === 0) {
      ctx.ui.notify("No open playwright-cli sessions.", "info");
      return;
    }

    const labels = views.map((view) => describeSession(view) + (view.name === LOGIN_SESSION ? " — sign-in window" : "") + (view.local ? "" : " — other workspace"));
    const choice = await ctx.ui.select("playwright-cli sessions (" + views.length + " open)", [
      ...labels,
      CLOSE_ALL,
      ...(views.some((view) => !view.local) ? [KILL_ALL] : []),
      BACK,
    ]);
    if (!choice || choice === BACK) return;

    if (choice === CLOSE_ALL) {
      const confirmed = await ctx.ui.confirm(
        "Close all sessions?",
        "Stops " + views.filter((view) => view.local).length + " session(s) started from this project. Your own browser windows are not touched.",
      );
      if (!confirmed) continue;
      const closed = await closeCliSessions(execFrom(pi));
      ctx.ui.notify(
        closed.ok
          ? summarizeInstallSuccess(closed.output) ?? "Closed all playwright-cli sessions."
          : "close-all failed: " + closed.error,
        closed.ok ? "info" : "error",
      );
      continue;
    }

    if (choice === KILL_ALL) {
      const confirmed = await ctx.ui.confirm(
        "Force kill every playwright-cli session?",
        "Stops browser sessions in every workspace, including other projects. Use it for stale browsers that close-all cannot reach.",
      );
      if (!confirmed) continue;
      const killed = await killAllCliSessions(execFrom(pi));
      ctx.ui.notify(
        killed.ok ? summarizeInstallSuccess(killed.output) ?? "Killed all playwright-cli sessions." : "kill-all failed: " + killed.error,
        killed.ok ? "info" : "error",
      );
      continue;
    }

    const view = views[labels.indexOf(choice)];
    if (!view) continue;
    if (!view.local) {
      ctx.ui.notify(
        "Session " + view.name + " belongs to another workspace. Close it from that project, or use \"" + KILL_ALL + "\".",
        "warning",
      );
      continue;
    }
    const action = await ctx.ui.select(describeSession(view), [CLOSE_ONE, BACK]);
    if (!action || action === BACK) continue;
    const closed = await closeCliSession(execFrom(pi), view);
    ctx.ui.notify(
      closed.ok ? "Session " + view.name + " closed." : "Could not close " + view.name + ": " + closed.error,
      closed.ok ? "info" : "error",
    );
  }
}

async function runClearFlow(ctx: ExtensionCommandContext): Promise<void> {
  const target = profileDir();
  if (!existsSync(target)) {
    ctx.ui.notify("No imported profile to clear.", "info");
    return;
  }
  if (isProfileInUse(target)) {
    ctx.ui.notify("The managed browser profile is in use. Close it and retry.", "warning");
    return;
  }
  const confirmed = await ctx.ui.confirm(
    "Clear imported data?",
    "Deletes " + target + " (cookies and storage). The CLI config is left in place.",
  );
  if (!confirmed) return;
  const cleared = clearProfileData(target);
  if (!cleared.ok) {
    ctx.ui.notify("Could not clear the profile: " + cleared.error, "error");
    return;
  }
  writeBrowserState(statePath(), initialBrowserState());
  ctx.ui.notify("Cleared " + target + ".", "info");
}
