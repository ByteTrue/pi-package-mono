import type { ExecFn } from "./env.js";
import { resolveAgentBrowserCommand } from "./cli.js";


export type AgentBrowserSession = {
  name: string;
  active: boolean;
  pid?: number;
  pageCount?: number;
  engine?: string;
  version?: string;
};

export type SessionResult<T> = { ok: true; value: T } | { ok: false; error: string };
export type CommandResult = { ok: true; output: string } | { ok: false; error: string };

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function outputOf(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function envelopeError(value: unknown): string | undefined {
  if (!isRecord(value) || value.success !== false) return undefined;
  if (typeof value.error === "string" && value.error) return value.error;
  if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  return "agent-browser reported a failure";
}

export function parseSessionNames(value: unknown): string[] {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.sessions)) return [];
  const names: string[] = [];
  for (const entry of value.data.sessions) {
    const name =
      typeof entry === "string"
        ? entry
        : isRecord(entry) && typeof entry.name === "string"
          ? entry.name
          : undefined;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function parseSessionInfo(value: unknown, fallbackName: string): AgentBrowserSession {
  const data = isRecord(value) && isRecord(value.data) ? value.data : {};
  const runtime = isRecord(data.runtime) ? data.runtime : undefined;
  const effectiveLaunch = runtime && isRecord(runtime.effectiveLaunch) ? runtime.effectiveLaunch : undefined;
  return {
    name: typeof data.session === "string" ? data.session : fallbackName,
    active: data.active === true,
    ...(typeof data.pid === "number" ? { pid: data.pid } : {}),
    ...(runtime && typeof runtime.pageCount === "number" ? { pageCount: runtime.pageCount } : {}),
    ...(effectiveLaunch && typeof effectiveLaunch.engine === "string"
      ? { engine: effectiveLaunch.engine }
      : {}),
    ...(typeof data.version === "string" ? { version: data.version } : {}),
  };
}

async function runJson(
  exec: ExecFn,
  args: string[],
  timeout: number = 20_000,
): Promise<SessionResult<unknown>> {
  let result;
  try {
    const resolved = resolveAgentBrowserCommand();
    result = await exec(resolved.command, [...(resolved.args ?? []), ...args], { timeout });
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
  const output = outputOf(result);
  if (result.code !== 0) return { ok: false, error: output || `exit code ${String(result.code)}` };
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    const failure = envelopeError(parsed);
    return failure ? { ok: false, error: failure } : { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, error: `could not parse agent-browser JSON: ${errorMessage(error)}` };
  }
}

function baseArgs(configPath: string): string[] {
  return ["--config", configPath];
}

export async function listAgentBrowserSessions(
  exec: ExecFn,
  configPath: string,
): Promise<SessionResult<string[]>> {
  const result = await runJson(exec, [...baseArgs(configPath), "session", "list", "--json"]);
  return result.ok ? { ok: true, value: parseSessionNames(result.value) } : result;
}

export async function getAgentBrowserSession(
  exec: ExecFn,
  configPath: string,
  name: string,
): Promise<SessionResult<AgentBrowserSession>> {
  const result = await runJson(exec, [
    ...baseArgs(configPath),
    "--session",
    name,
    "session",
    "info",
    "--json",
  ]);
  return result.ok
    ? { ok: true, value: parseSessionInfo(result.value, name) }
    : result;
}

export async function collectAgentBrowserSessions(
  exec: ExecFn,
  configPath: string,
): Promise<SessionResult<AgentBrowserSession[]>> {
  const listed = await listAgentBrowserSessions(exec, configPath);
  if (!listed.ok) return listed;
  const sessions: AgentBrowserSession[] = [];
  for (const name of listed.value) {
    const info = await getAgentBrowserSession(exec, configPath, name);
    sessions.push(info.ok ? info.value : { name, active: true });
  }
  return { ok: true, value: sessions };
}

export function describeSession(session: AgentBrowserSession): string {
  const details = [session.name, session.active ? "running" : "stale"];
  if (session.pageCount !== undefined) details.push(`${session.pageCount} page(s)`);
  if (session.pid !== undefined) details.push(`pid ${session.pid}`);
  return details.join(" — ");
}

async function runCommand(
  exec: ExecFn,
  args: string[],
  timeout: number = 60_000,
): Promise<CommandResult> {
  let result;
  try {
    const resolved = resolveAgentBrowserCommand();
    result = await exec(resolved.command, [...(resolved.args ?? []), ...args], { timeout });
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
  const output = outputOf(result);
  if (result.code !== 0) return { ok: false, error: output || `exit code ${String(result.code)}` };
  if (result.stdout.trim().startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      const failure = envelopeError(parsed);
      if (failure) return { ok: false, error: failure };
    } catch {
      // A successful close may emit human-readable text in older compatible versions.
    }
  }
  return { ok: true, output };
}

export function closeAgentBrowserSession(
  exec: ExecFn,
  configPath: string,
  name: string,
): Promise<CommandResult> {
  return runCommand(exec, [
    ...baseArgs(configPath),
    "--session",
    name,
    "close",
    "--json",
  ]);
}

/** Closes every session in the namespace selected by the managed config. */
export function closeAllAgentBrowserSessions(
  exec: ExecFn,
  configPath: string,
): Promise<CommandResult> {
  return runCommand(exec, [...baseArgs(configPath), "close", "--all", "--json"]);
}

/** Official non-destructive stale pid/socket cleanup; never installs or repairs browser files. */
export function cleanStaleAgentBrowserState(
  exec: ExecFn,
  configPath: string,
): Promise<CommandResult> {
  return runCommand(
    exec,
    [...baseArgs(configPath), "doctor", "--offline", "--quick", "--json"],
    60_000,
  );
}

/** Startup heads-up only. Explicit idleTimeout remains the automatic cleanup mechanism. */
export async function notifyLeftoverSessions(
  exec: ExecFn,
  configPath: string,
  notify: (message: string, level: "info" | "warning" | "error") => void,
): Promise<void> {
  const listed = await listAgentBrowserSessions(exec, configPath);
  if (!listed.ok || listed.value.length === 0) return;
  const names = listed.value.slice(0, 3).join(", ");
  const more = listed.value.length > 3 ? ", …" : "";
  notify(
    `${listed.value.length} agent-browser session(s) are still running (${names}${more}). They will close after the configured idle timeout; use /browser → Sessions to close them now.`,
    "warning",
  );
}
