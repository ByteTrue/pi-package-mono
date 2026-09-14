import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SourceBrowserDef = {
  id: string;
  label: string;
  /** Playwright channel used to run the imported profile. */
  channel: string;
  roots: Partial<Record<NodeJS.Platform, string>>;
};

/** Only browsers with a Playwright channel: launching and keychain decryption ride on it. */
export const SOURCE_BROWSERS: SourceBrowserDef[] = [
  {
    id: "msedge",
    label: "Microsoft Edge",
    channel: "msedge",
    roots: {
      darwin: "~/Library/Application Support/Microsoft Edge",
      win32: "~/AppData/Local/Microsoft/Edge/User Data",
      linux: "~/.config/microsoft-edge",
    },
  },
  {
    id: "chrome",
    label: "Google Chrome",
    channel: "chrome",
    roots: {
      darwin: "~/Library/Application Support/Google/Chrome",
      win32: "~/AppData/Local/Google/Chrome/User Data",
      linux: "~/.config/google-chrome",
    },
  },
];

export type DetectedProfile = { dir: string; name: string };
export type DetectedBrowser = {
  id: string;
  label: string;
  channel: string;
  userDataDir: string;
  profiles: DetectedProfile[];
};

export type DetectOptions = {
  platform?: NodeJS.Platform;
  home?: string;
  exists?: (path: string) => boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandHome(path: string, home: string): string {
  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

/** Chromium keeps display names for profile dirs in `<user data dir>/Local State`. */
export function readProfileNames(userDataDir: string, exists: (path: string) => boolean = existsSync): DetectedProfile[] {
  const names = new Map<string, string>();
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(userDataDir, "Local State"), "utf8"));
    if (isObject(parsed) && isObject(parsed.profile) && isObject(parsed.profile.info_cache)) {
      for (const [dir, value] of Object.entries(parsed.profile.info_cache)) {
        const name = isObject(value) && typeof value.name === "string" && value.name.trim() ? value.name : dir;
        names.set(dir, name);
      }
    }
  } catch {
    // Missing or unreadable Local State: fall back to the default profile below.
  }

  const profiles: DetectedProfile[] = [];
  for (const [dir, name] of names) {
    if (exists(join(userDataDir, dir))) profiles.push({ dir, name });
  }
  if (profiles.length === 0 && exists(join(userDataDir, "Default"))) {
    profiles.push({ dir: "Default", name: "Default" });
  }
  return profiles.sort((a, b) => {
    if (a.dir === "Default") return -1;
    if (b.dir === "Default") return 1;
    return a.name.localeCompare(b.name);
  });
}

export function detectSourceBrowsers(options: DetectOptions = {}): DetectedBrowser[] {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const exists = options.exists ?? existsSync;
  const found: DetectedBrowser[] = [];

  for (const browser of SOURCE_BROWSERS) {
    const root = browser.roots[platform];
    if (!root) continue;
    const userDataDir = expandHome(root, home);
    if (!exists(userDataDir)) continue;
    const profiles = readProfileNames(userDataDir, exists);
    if (profiles.length === 0) continue;
    found.push({ id: browser.id, label: browser.label, channel: browser.channel, userDataDir, profiles });
  }
  return found;
}

export function profilePath(browser: DetectedBrowser, profile: DetectedProfile): string {
  return join(browser.userDataDir, profile.dir);
}
