import { join } from "node:path";
import { managedBrowserSummary, readPlaywrightConfig, type JsonObject } from "./config.js";
import { playwrightConfigPath } from "./paths.js";
import { detectSourceBrowsers, type DetectedBrowser } from "./import/detect.js";
import { profileDir, statePath } from "./paths.js";
import { readBrowserState } from "./state.js";

/**
 * A target is the browser+profile playwright-cli drives. Two kinds:
 *  - "copy": a profile this package owns (an imported snapshot; safe to overwrite).
 *  - "real": the user's own daily browser profile. Driving it writes their data, and it
 *    can only be used while their browser is closed (Chromium holds the user-data-dir).
 */
export type TargetKind = "copy" | "real";

export type Target = {
  /** Stable key: "<browserId>:<profileDir>" for real profiles, "copy" for ours. */
  id: string;
  kind: TargetKind;
  /** Playwright channel used to launch it; must match the profile's browser family. */
  channel: string;
  /** "Microsoft Edge" / "Google Chrome" / "Copy profile". */
  browserLabel: string;
  /** Chromium user-data-dir: where the SingletonLock lives. */
  userDataDir: string;
  /** Profile dir inside it ("Default", "Profile 1", …). Our copy is always "Default". */
  profileDirectory: string;
  label: string;
};

/** The copy is launched as `<userDataDir>/Default`, so the path is a real dir we own. */
export const COPY_PROFILE_DIRECTORY = "Default";

export function copyTarget(channel: string, sourceLabel?: string): Target {
  return {
    id: "copy",
    kind: "copy",
    channel,
    browserLabel: "Copy profile",
    userDataDir: profileDir(),
    profileDirectory: COPY_PROFILE_DIRECTORY,
    label: sourceLabel ? "Copy profile (imported from " + sourceLabel + ")" : "Copy profile (no data yet)",
  };
}

/** Launch args that pin Chromium to one profile inside the user-data-dir. */
export function targetArgs(target: Target): string[] {
  return target.profileDirectory === "Default" ? [] : ["--profile-directory=" + target.profileDirectory];
}

export function sameTarget(a: Target, b: Target): boolean {
  return a.userDataDir === b.userDataDir && a.profileDirectory === b.profileDirectory && a.channel === b.channel;
}

function realTargetsFrom(detected: DetectedBrowser[]): Target[] {
  const out: Target[] = [];
  for (const browser of detected) {
    for (const profile of browser.profiles) {
      out.push({
        id: browser.id + ":" + profile.dir,
        kind: "real",
        channel: browser.channel,
        browserLabel: browser.label,
        userDataDir: browser.userDataDir,
        profileDirectory: profile.dir,
        label: browser.label + " · " + profile.name,
      });
    }
  }
  return out;
}

/** Every selectable target: the copy first (it is the safe default), then real profiles. */
export function listTargets(): { copy: Target; real: Target[]; all: Target[] } {
  const read = readPlaywrightConfig(playwrightConfigPath());
  const config = read.ok ? read.value : undefined;
  const detected = detectSourceBrowsers();
  const copy = copyTarget(channelForCopy(config, detected), sourceLabelForCopy());
  const real = realTargetsFrom(detected);
  return { copy, real, all: [copy, ...real] };
}

/** What the copy currently holds, from the import record (not from what is installed now). */
function sourceLabelForCopy(): string | undefined {
  return readBrowserState(statePath())?.lastImport?.sourceBrowserLabel;
}

/** The copy must launch with the channel its data was imported from (keychain pairing). */
function channelForCopy(config: JsonObject | undefined, detected: DetectedBrowser[]): string {
  const configured = managedBrowserSummary(config).channel;
  if (configured && detected.some((entry) => entry.channel === configured)) return configured;
  if (configured) return configured;
  return detected[0]?.channel ?? "chrome";
}

/**
 * The target the CLI config points at right now, classified as copy or real.
 * Unknown paths are reported as-is with kind "real" so we never mistake a foreign
 * profile for the copy we are allowed to overwrite.
 */
export function currentTarget(): Target | undefined {
  const config = readPlaywrightConfig(playwrightConfigPath());
  if (!config.ok || !config.value) return undefined;
  return targetFromConfig(config.value);
}

export function targetFromConfig(config: JsonObject | undefined): Target | undefined {
  const summary = managedBrowserSummary(config);
  if (!summary.channel || !summary.userDataDir) return undefined;
  const copy = profileDir();
  const isCopy = summary.userDataDir === copy;
  if (isCopy) return copyTarget(summary.channel, sourceLabelForCopy());
  const detected = detectSourceBrowsers();
  const browser = detected.find((entry) => entry.userDataDir === summary.userDataDir);
  const profileDirectory = summary.profileDirectory ?? "Default";
  if (browser) {
    const profile = browser.profiles.find((entry) => entry.dir === profileDirectory);
    return {
      id: browser.id + ":" + profileDirectory,
      kind: "real",
      channel: summary.channel,
      browserLabel: browser.label,
      userDataDir: summary.userDataDir,
      profileDirectory,
      label: browser.label + " · " + (profile?.name ?? profileDirectory),
    };
  }
  return {
    id: "external:" + summary.userDataDir + ":" + profileDirectory,
    kind: "real",
    channel: summary.channel,
    browserLabel: "External profile",
    userDataDir: summary.userDataDir,
    profileDirectory,
    label: "External profile · " + profileDirectory,
  };
}

/**
 * Import destinations: only a profile we own may be overwritten, because the copy step is
 * a whole-file replace (SQLite + leveldb cannot merge). Real profiles are refused outright.
 */
export function assertImportDestination(destination: string, realUserDataDirs: string[]): string | undefined {
  if (destination === profileDir()) return undefined;
  if (realUserDataDirs.some((dir) => destination === dir || destination.startsWith(join(dir, "/")))) {
    return "Refusing to import into your daily browser profile — importing replaces its files wholesale and would wipe your own logins.";
  }
  return "Refusing to import into " + destination + ": only the profile owned by this package may be overwritten.";
}

/** True when nothing has ever been imported into the copy (so driving it buys nothing). */
export function copyHasData(): boolean {
  return readBrowserState(statePath())?.lastImport !== undefined;
}
