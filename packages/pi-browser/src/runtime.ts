import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { agentBrowserBrowsersDir } from "./paths.js";

let cachedChromeForTesting: { root: string; path: string | undefined } | undefined;

/** Clear cached discovery (used by tests). */
export function resetChromeForTestingCache(): void {
  cachedChromeForTesting = undefined;
}

function isChromeExecutable(path: string, platform: NodeJS.Platform): boolean {
  const name = basename(path);
  if (platform === "win32") return name.toLowerCase() === "chrome.exe";
  if (platform === "darwin") return name === "Google Chrome for Testing";
  return name === "chrome";
}

function versionParts(path: string): number[] {
  const match = /(?:^|[\\/])chrome-(\d+(?:\.\d+){1,3})(?:[\\/]|$)/i.exec(path);
  return match ? match[1]!.split(".").map((part) => Number.parseInt(part, 10) || 0) : [];
}

function compareVersionsNewestFirst(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return right.localeCompare(left);
}

/** Find the newest Chrome for Testing downloaded by `agent-browser install`. */
export function findDownloadedChromeForTesting(
  root: string = agentBrowserBrowsersDir(),
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  // Installs do not change while Pi runs, and Status renders repeatedly;
  // walking the browser tree on every render is wasted IO.
  if (cachedChromeForTesting && cachedChromeForTesting.root === root) {
    return cachedChromeForTesting.path;
  }
  const candidates: string[] = [];
  const pending: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];

  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current.path, entry.name);
      if (entry.isFile() && isChromeExecutable(path, platform)) {
        candidates.push(path);
      } else if (entry.isDirectory() && current.depth < 6) {
        pending.push({ path, depth: current.depth + 1 });
      }
    }
  }

  const newest = candidates.sort(compareVersionsNewestFirst)[0];
  cachedChromeForTesting = { root, path: newest };
  return newest;
}

export type DetectedBrowser = {
  id: string;
  label: string;
  path: string;
};

/** Scan standard platform paths to discover installed browsers (Edge, Chrome, CfT). */
export function detectAvailableBrowsers(
  platform: NodeJS.Platform = process.platform,
): DetectedBrowser[] {
  const browsers: DetectedBrowser[] = [];

  // 1. Chrome for Testing
  const cftPath = findDownloadedChromeForTesting();
  if (cftPath) {
    const v = versionParts(cftPath).join(".");
    browsers.push({
      id: "cft",
      label: `Chrome for Testing${v ? ` (${v})` : ""}`,
      path: cftPath,
    });
  }

  const testCandidate = (id: string, label: string, candidates: string[]) => {
    for (const p of candidates) {
      if (p && existsSync(p)) {
        browsers.push({ id, label, path: p });
        return;
      }
    }
  };

  if (platform === "win32") {
    testCandidate("edge", "Microsoft Edge", [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ]);
    const localAppData = process.env.LOCALAPPDATA ?? "";
    testCandidate("chrome", "Google Chrome", [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      localAppData ? join(localAppData, "Google", "Chrome", "Application", "chrome.exe") : "",
    ]);
  } else if (platform === "darwin") {
    testCandidate("edge", "Microsoft Edge", [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]);
    testCandidate("chrome", "Google Chrome", [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]);
    testCandidate("brave", "Brave Browser", [
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ]);
  } else {
    testCandidate("edge", "Microsoft Edge", [
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable",
    ]);
    testCandidate("chrome", "Google Chrome", [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ]);
  }

  return browsers;
}
