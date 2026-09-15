import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExecFn } from "./env.js";
import { resolveAgentBrowserCommand } from "./cli.js";
import { authDir } from "./paths.js";

export type AuthStateSummary = {
  name: string;
  path: string;
  mtime: Date;
  sizeBytes: number;
  cookieCount: number;
  domains: string[];
  originCount: number;
};

export type AuthValidationResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

const SAFE_NAME_REGEX = /^[a-zA-Z0-9_\u4e00-\u9fa5-]+$/;

/** Sanitize and validate a user-supplied login state name. */
export function validateAuthStateName(raw: string): AuthValidationResult {
  let name = raw.trim();
  if (!name) {
    return { ok: false, error: "Name cannot be empty." };
  }
  if (name.toLowerCase().endsWith(".json")) {
    name = name.slice(0, -5).trim();
  }
  if (!name) {
    return { ok: false, error: "Name cannot be empty." };
  }
  if (!SAFE_NAME_REGEX.test(name)) {
    return {
      ok: false,
      error: "Name can only contain letters, numbers, Chinese characters, hyphens and underscores.",
    };
  }
  return { ok: true, name };
}

function parseAuthStateDomains(parsed: Record<string, unknown>): { cookieCount: number; domains: string[]; originCount: number } {
  const domains = new Set<string>();
  let cookieCount = 0;
  let originCount = 0;

  if (Array.isArray(parsed.cookies)) {
    cookieCount = parsed.cookies.length;
    for (const c of parsed.cookies) {
      if (typeof c === "object" && c !== null && "domain" in c && typeof c.domain === "string") {
        const clean = c.domain.replace(/^\./, "").toLowerCase();
        if (clean) domains.add(clean);
      }
    }
  }

  if (Array.isArray(parsed.origins)) {
    originCount = parsed.origins.length;
    for (const o of parsed.origins) {
      if (typeof o === "object" && o !== null && "origin" in o && typeof o.origin === "string") {
        try {
          const url = new URL(o.origin);
          if (url.hostname) domains.add(url.hostname.toLowerCase());
        } catch {
          // ignore malformed URLs
        }
      }
    }
  }

  return {
    cookieCount,
    domains: Array.from(domains).sort(),
    originCount,
  };
}

/** Summarize one saved login state file. */
export function inspectAuthStateFile(filePath: string): AuthStateSummary | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const stat = statSync(filePath);
    const raw = readFileSync(filePath, "utf8");
    const name = basename(filePath, ".json");
    let cookieCount = 0;
    let originCount = 0;
    let domains: string[] = [];

    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const extracted = parseAuthStateDomains(parsed as Record<string, unknown>);
        cookieCount = extracted.cookieCount;
        originCount = extracted.originCount;
        domains = extracted.domains;
      }
    } catch {
      // Still return summary with 0 domains if JSON is incomplete/corrupted
    }

    return {
      name,
      path: filePath,
      mtime: stat.mtime,
      sizeBytes: stat.size,
      cookieCount,
      domains,
      originCount,
    };
  } catch {
    return undefined;
  }
}

/** List all saved login states from the given or default auth directory. */
export function listAuthStates(dir: string = authDir()): AuthStateSummary[] {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const results: AuthStateSummary[] = [];
  for (const entry of entries) {
    if (entry.toLowerCase().endsWith(".json")) {
      const summary = inspectAuthStateFile(join(dir, entry));
      if (summary) results.push(summary);
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/** Get a single auth state summary by name. */
export function getAuthState(name: string, dir: string = authDir()): AuthStateSummary | undefined {
  return inspectAuthStateFile(join(dir, `${name}.json`));
}

/** Rename an existing login state file. */
export function renameAuthState(
  oldName: string,
  rawNewName: string,
  dir: string = authDir(),
): { ok: true; newName: string } | { ok: false; error: string } {
  const valid = validateAuthStateName(rawNewName);
  if (!valid.ok) return valid;
  const newName = valid.name;

  if (oldName === newName) return { ok: true, newName };

  const oldPath = join(dir, `${oldName}.json`);
  const newPath = join(dir, `${newName}.json`);

  if (!existsSync(oldPath)) {
    return { ok: false, error: `Login state "${oldName}" not found.` };
  }
  if (existsSync(newPath)) {
    return { ok: false, error: `Login state "${newName}" already exists.` };
  }

  try {
    renameSync(oldPath, newPath);
    return { ok: true, newName };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Delete a saved login state file. */
export function deleteAuthState(
  name: string,
  dir: string = authDir(),
): { ok: true } | { ok: false; error: string } {
  const path = join(dir, `${name}.json`);
  if (!existsSync(path)) {
    return { ok: false, error: `Login state "${name}" not found.` };
  }
  try {
    unlinkSync(path);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Format human-friendly line for menu displays. */
export function describeAuthState(state: AuthStateSummary): string {
  const parts: string[] = [state.name];
  if (state.domains.length > 0) {
    const domainPreview = state.domains.slice(0, 3).join(", ");
    const more = state.domains.length > 3 ? ` +${state.domains.length - 3}` : "";
    parts.push(`${domainPreview}${more}`);
  }
  if (state.cookieCount > 0) {
    parts.push(`${state.cookieCount} cookie(s)`);
  }
  const kb = (state.sizeBytes / 1024).toFixed(1);
  parts.push(`${kb} KB`);
  return parts.join(" — ");
}

/**
 * Save authentication state from an active agent-browser session into a named state file.
 */
export async function saveAuthStateFromSession(
  exec: ExecFn,
  configPath: string,
  sessionName: string,
  name: string,
  dir: string = authDir(),
): Promise<{ ok: true; summary: AuthStateSummary } | { ok: false; error: string }> {
  const valid = validateAuthStateName(name);
  if (!valid.ok) return valid;
  const targetPath = join(dir, `${valid.name}.json`);

  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const resolved = resolveAgentBrowserCommand();
  const args = [
    ...(resolved.args ?? []),
    "--config",
    configPath,
    "--session",
    sessionName,
    "state",
    "save",
    targetPath,
  ];

  let result;
  try {
    result = await exec(resolved.command, args, { timeout: 30_000 });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (result.code !== 0 || !existsSync(targetPath)) {
    const msg = `${result.stdout}\n${result.stderr}`.trim();
    return { ok: false, error: msg || `Failed to save state (exit code ${String(result.code)})` };
  }

  const summary = inspectAuthStateFile(targetPath);
  if (!summary) {
    return { ok: false, error: "Saved state file was empty or unreadable." };
  }

  return { ok: true, summary };
}

/**
 * Load an existing named state file into an active agent-browser session.
 */
export async function loadAuthStateIntoSession(
  exec: ExecFn,
  configPath: string,
  sessionName: string,
  name: string,
  dir: string = authDir(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const targetPath = join(dir, `${name}.json`);
  if (!existsSync(targetPath)) {
    return { ok: false, error: `Login state file "${name}.json" not found at ${targetPath}` };
  }

  const resolved = resolveAgentBrowserCommand();
  const args = [
    ...(resolved.args ?? []),
    "--config",
    configPath,
    "--session",
    sessionName,
    "state",
    "load",
    targetPath,
  ];

  let result;
  try {
    result = await exec(resolved.command, args, { timeout: 30_000 });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (result.code !== 0) {
    const msg = `${result.stdout}\n${result.stderr}`.trim();
    return { ok: false, error: msg || `Failed to load state (exit code ${String(result.code)})` };
  }

  return { ok: true };
}
