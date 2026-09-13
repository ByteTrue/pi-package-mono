import type { ExecFn } from "./env.js";

export type CliSession = {
  name: string;
  status: string;
  browserType?: string;
  userDataDir?: string;
  headed?: boolean;
  attached?: boolean;
  workspace?: string;
};

export type ListSessionsResult = { ok: true; sessions: CliSession[] } | { ok: false; error: string };
export type CloseSessionsResult = { ok: true; output: string } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `playwright-cli list --all --json` → browsers[]; tolerate anything unexpected. */
export function parseSessionList(value: unknown): CliSession[] {
  if (!isRecord(value) || !Array.isArray(value.browsers)) return [];
  const sessions: CliSession[] = [];
  for (const entry of value.browsers) {
    if (!isRecord(entry) || typeof entry.name !== "string" || entry.name.length === 0) continue;
    sessions.push({
      name: entry.name,
      status: typeof entry.status === "string" ? entry.status : "unknown",
      ...(typeof entry.browserType === "string" ? { browserType: entry.browserType } : {}),
      ...(typeof entry.userDataDir === "string" ? { userDataDir: entry.userDataDir } : {}),
      ...(typeof entry.headed === "boolean" ? { headed: entry.headed } : {}),
      ...(typeof entry.attached === "boolean" ? { attached: entry.attached } : {}),
      ...(typeof entry.workspace === "string" ? { workspace: entry.workspace } : {}),
    });
  }
  return sessions;
}

export function describeSession(session: CliSession): string {
  const bits = [session.name, session.status];
  if (session.browserType) bits.push(session.browserType + (session.attached ? " (attached)" : ""));
  if (session.headed) bits.push("headed");
  return bits.join(" — ");
}

export async function listCliSessions(
  exec: ExecFn,
  options: { all?: boolean } = {},
): Promise<ListSessionsResult> {
  const args = options.all === false ? ["list", "--json"] : ["list", "--all", "--json"];
  let result;
  try {
    result = await exec("playwright-cli", args, { timeout: 20_000 });
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  if (result.code !== 0) {
    const output = (result.stdout + "\n" + result.stderr).trim();
    return { ok: false, error: output || "exit code " + String(result.code) };
  }
  try {
    return { ok: true, sessions: parseSessionList(JSON.parse(result.stdout)) };
  } catch (error) {
    return { ok: false, error: "could not parse playwright-cli list output: " + message(error) };
  }
}

async function runSessionCommand(exec: ExecFn, args: string[]): Promise<CloseSessionsResult> {
  let result;
  try {
    result = await exec("playwright-cli", args, { timeout: 60_000 });
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  const output = (result.stdout + "\n" + result.stderr).trim();
  return result.code === 0 ? { ok: true, output } : { ok: false, error: output || "exit code " + String(result.code) };
}

export function closeCliSessions(exec: ExecFn): Promise<CloseSessionsResult> {
  return runSessionCommand(exec, ["close-all"]);
}

/** Force-stops sessions in every workspace (the CLI's own escape hatch for stale browsers). */
export function killAllCliSessions(exec: ExecFn): Promise<CloseSessionsResult> {
  return runSessionCommand(exec, ["kill-all"]);
}

export type SessionView = CliSession & { local: boolean };

/**
 * Sessions as shown in the menu. `close` only reaches the current workspace, so mark
 * sessions from other workspaces and let the caller offer kill-all for those.
 */
export async function collectSessionViews(
  exec: ExecFn,
): Promise<{ ok: true; views: SessionView[] } | { ok: false; error: string }> {
  const all = await listCliSessions(exec);
  if (!all.ok) return all;
  const local = await listCliSessions(exec, { all: false });
  const localWorkspaces = new Set(
    (local.ok ? local.sessions : []).map((session) => session.workspace).filter((workspace): workspace is string => !!workspace),
  );
  return {
    ok: true,
    views: all.sessions.map((session) => ({
      ...session,
      local: localWorkspaces.size > 0 && !!session.workspace && localWorkspaces.has(session.workspace),
    })),
  };
}

/** Attached sessions detach; launched sessions close. */
export function closeCliSession(exec: ExecFn, session: CliSession): Promise<CloseSessionsResult> {
  return runSessionCommand(exec, ["-s=" + session.name, session.attached ? "detach" : "close"]);
}

/** Startup heads-up only: never closes anything on its own. */
export async function notifyLeftoverSessions(
  exec: ExecFn,
  notify: (message: string, level: "info" | "warning" | "error") => void,
): Promise<void> {
  const listed = await listCliSessions(exec);
  if (!listed.ok || listed.sessions.length === 0) return;
  const names = listed.sessions.slice(0, 3).map((session) => session.name).join(", ");
  const more = listed.sessions.length > 3 ? ", …" : "";
  notify(
    listed.sessions.length + " playwright-cli session(s) are still open (" + names + more + "). Use /browser → Sessions to inspect or close them.",
    "warning",
  );
}
