import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { agentBrowserBrowsersDir } from "./paths.js";

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

  return candidates.sort(compareVersionsNewestFirst)[0];
}
