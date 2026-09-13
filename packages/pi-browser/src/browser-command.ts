import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { managedBrowserSummary, mergePlaywrightConfig, readPlaywrightConfig, writePlaywrightConfig, type JsonObject } from "./config.js";
import { INSTALL_CLI, INSTALL_SKILL, MIN_CLI_VERSION, isPlaywrightSkillInstalled, probePlaywrightCli, type CliProbe, type ExecFn, type InstallCommand } from "./env.js";
import { clearProfileData, isProfileInUse } from "./import/apply.js";
import { detectSourceBrowsers, profilePath, type DetectedBrowser, type DetectedProfile } from "./import/detect.js";
import { importProfileData, type ImportSource } from "./import/pipeline.js";
import { measureItems, planSnapshotItems } from "./import/snapshot.js";
import { runImportSmoke } from "./import/verify.js";
import { closeCliSession, closeCliSessions, collectSessionViews, describeSession, killAllCliSessions } from "./sessions.js";
import { DEFAULT_PROFILE_NAME, artifactsDir, officialSkillDir, playwrightConfigPath, profileDir, statePath } from "./paths.js";
import { initialBrowserState, readBrowserState, writeBrowserState, type PiBrowserState } from "./state.js";

const STATUS = "Status";
const SETUP = "Setup";
const IMPORT = "Import login data";
const REIMPORT = "Re-import";
const CLEAR = "Clear imported data";
const SESSIONS = "Sessions";
const CLOSE = "Close";
const BACK = "Back";
const CLOSE_ALL = "Close all sessions";
const CLOSE_ONE = "Close this session";
const KILL_ALL = "Force kill all sessions (all workspaces)";

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
    const choice = await ctx.ui.select("Browser", [STATUS, SETUP, IMPORT, REIMPORT, CLEAR, SESSIONS, CLOSE]);
    if (!choice || choice === CLOSE) return;

    if (choice === STATUS) {
      await showStatus(pi, ctx);
      continue;
    }
    if (choice === SETUP) {
      await runSetup(pi, ctx);
      continue;
    }
    if (choice === IMPORT) {
      await runImportFlow(pi, ctx);
      continue;
    }
    if (choice === REIMPORT) {
      await runImportFlow(pi, ctx, { reuseLast: true });
      continue;
    }
    if (choice === CLEAR) {
      await runClearFlow(ctx);
      continue;
    }
    if (choice === SESSIONS) {
      await runSessionsMenu(pi, ctx);
      continue;
    }
  }
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
  };
  await ctx.ui.editor("Browser status", buildStatusReport(facts));
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
  lines.push("Profile        " + facts.profilePath + " (" + (facts.profileExists ? "exists" : "not imported yet") + ")");
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
    lines.push("CLI config     " + facts.configPath + " (missing — run Setup / Import)");
  } else {
    const summary = managedBrowserSummary(facts.config.value);
    lines.push("CLI config     " + facts.configPath);
    lines.push("  channel      " + (summary.channel ?? "(unset)"));
    const matches = summary.userDataDir === facts.profilePath;
    lines.push("  userDataDir  " + (summary.userDataDir ?? "(unset)") + (matches ? " (matches our profile)" : " (does not match our profile)"));
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
        await ctx.ui.editor(
          "Install output — read only, press Esc to close",
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
  channel: string,
  targetProfileDir: string,
): { ok: true; backupPath?: string } | { ok: false; error: string } {
  const path = playwrightConfigPath();
  const existing = readPlaywrightConfig(path);
  if (!existing.ok) return { ok: false, error: existing.error };
  const merged = mergePlaywrightConfig(existing.value, {
    channel,
    userDataDir: targetProfileDir,
    headless: true,
    outputDir: artifactsDir(),
  });
  if (!merged.ok) return { ok: false, error: merged.error };
  const written = writePlaywrightConfig(path, merged.value);
  if (!written.ok) return { ok: false, error: written.error };
  return { ok: true, ...(written.backupPath ? { backupPath: written.backupPath } : {}) };
}

async function runImportFlow(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  options: { reuseLast?: boolean } = {},
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
    const browserChoice = await ctx.ui.select("Import login data — source browser", [
      ...browsers.map((entry) => entry.label),
      BACK,
    ]);
    if (!browserChoice || browserChoice === BACK) return;
    browser = browsers.find((entry) => entry.label === browserChoice);
    if (!browser) return;

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

  const target = profileDir();
  const bytes = measureItems(items);
  const confirmed = await ctx.ui.confirm(
    "Import login data?",
    "From:  " + browser.label + " / " + profile.name + "\n" +
      "Data:  " + items.map((item) => item.kind).join(", ") + " (about " + formatBytes(bytes) + ")\n" +
      "Into:  " + target + "\n" +
      "The current target profile is kept until the new one is in place.\n" +
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

  const configResult = writeManagedConfig(browser.channel, target);
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
    const smoke = await runImportSmoke(execFrom(pi));
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

    const labels = views.map((view) => describeSession(view) + (view.local ? "" : " — other workspace"));
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
