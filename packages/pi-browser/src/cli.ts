import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

/**
 * pi.exec spawns without a shell, so on Windows the npm `agent-browser` shim
 * (agent-browser.cmd) cannot be launched by name. Resolve a directly
 * spawnable command — a native binary, or the package's JS entry through the
 * current node — and use it for every agent-browser invocation.
 */
export type ResolvedCli = { command: string; args?: string[] };

const CLI_PACKAGE = "agent-browser";

/** Platform-specific native binary shipped inside the agent-browser package. */
export function agentBrowserNativeExeName(): string {
  const platform = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : "win32";
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "ia32" : "x64";
  return `agent-browser-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
}

function candidateExists(candidate: ResolvedCli): boolean {
  return candidate.args ? existsSync(candidate.args[0] ?? "") : existsSync(candidate.command);
}

/** Native binaries first (no node dependency), then JS entries through node. */
export function agentBrowserCandidates(): ResolvedCli[] {
  const native: ResolvedCli[] = [];
  const js: ResolvedCli[] = [];

  const path = process.env.PATH ?? "";
  const seen = new Set<string>();
  for (const dir of path.split(delimiter)) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    // On Windows only a real executable from PATH is spawnable without a
    // shell; the extensionless sh shim and the .cmd shim are not.
    if (process.platform === "win32") {
      native.push({ command: join(dir, "agent-browser.exe") });
    } else {
      native.push({ command: join(dir, "agent-browser") });
    }
  }

  const home = homedir();
  const ownPkg = join(home, ".agent-browser", "node_modules", CLI_PACKAGE);
  native.push({ command: join(ownPkg, "bin", agentBrowserNativeExeName()) });
  js.push({ command: process.execPath, args: [join(ownPkg, "bin", "agent-browser.js")] });

  const roots: string[] = [];
  if (process.env.APPDATA) roots.push(join(process.env.APPDATA, "npm"));
  if (process.env.NODE_PREFIX) roots.push(process.env.NODE_PREFIX);
  roots.push("/usr/local", "/opt/homebrew", "/usr");
  for (const root of roots) {
    const pkgDir = join(root, "node_modules", CLI_PACKAGE);
    native.push({ command: join(pkgDir, "bin", agentBrowserNativeExeName()) });
    js.push({ command: process.execPath, args: [join(pkgDir, "bin", "agent-browser.js")] });
  }

  return [...native, ...js];
}

let override: ResolvedCli | undefined;

/** Pin the CLI resolution (used by tests; a power user could also set it). */
export function setAgentBrowserCliOverride(value: ResolvedCli | undefined): void {
  override = value;
}

/**
 * First existing, directly spawnable CLI target. Throws when agent-browser is
 * not installed in any known location, with the honest install hint.
 */
export function resolveAgentBrowserCommand(): ResolvedCli {
  if (override) return override;
  for (const candidate of agentBrowserCandidates()) {
    if (candidateExists(candidate)) return candidate;
  }
  throw new Error(
    'agent-browser not found; install it with "npm install -g agent-browser" (and run "agent-browser install" for the test browser)',
  );
}
