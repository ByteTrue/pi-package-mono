import type { SubagentTaskRecord } from "./index.js";

/**
 * BySpace report bridge (pi first-class adaptation).
 *
 * When BySpace launches a pi agent it injects BYSPACE_SUBAGENT_REPORT_URL and
 * BYSPACE_SUBAGENT_REPORT_TOKEN into the process env. The extension then POSTs a
 * small snapshot per task change so the daemon can track running subagents and
 * locate the child session log (sessionId + cwd) for its timeline tab. The token
 * alone identifies the agent — the daemon minted it per pi launch. Without the
 * env pair (plain pi usage) this module never sends anything.
 */

const REPORT_ENV_URL = "BYSPACE_SUBAGENT_REPORT_URL";
const REPORT_ENV_TOKEN = "BYSPACE_SUBAGENT_REPORT_TOKEN";

export interface ByspaceReportRecord {
  id: string;
  status: SubagentTaskRecord["status"];
  sessionId?: string;
  cwd?: string;
  /** Absolute path to the child's persisted session jsonl, so the daemon skips its own lookup. */
  sessionFile?: string;
}

function childSession(
  record: SubagentTaskRecord,
  resolveSessionFile:
    | ((run: { sessionId: string; cwd?: string }) => string | undefined)
    | undefined,
): { sessionId?: string; cwd?: string; sessionFile?: string } {
  const run = record.progress?.runs[0];
  if (!run?.sessionId) return {};
  const sessionFile = resolveSessionFile?.(run);
  return {
    sessionId: run.sessionId,
    ...(run.cwd ? { cwd: run.cwd } : {}),
    ...(sessionFile ? { sessionFile } : {}),
  };
}

/**
 * resolveSessionFile is injected (index.ts passes sessionLogPath) rather than imported —
 * importing it here would make the index.js dependency a runtime cycle.
 */
export function buildByspaceReportRecord(
  task: SubagentTaskRecord,
  resolveSessionFile?: (run: {
    sessionId: string;
    cwd?: string;
  }) => string | undefined,
): ByspaceReportRecord {
  return {
    id: task.id,
    status: task.status,
    ...childSession(task, resolveSessionFile),
  };
}

export class ByspaceReporter {
  private readonly url: string | undefined;
  private readonly token: string | undefined;
  /** Last running snapshot sent per task, to skip duplicate progress churn. */
  private readonly lastRunning = new Map<string, string>();

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const url = env[REPORT_ENV_URL]?.trim();
    const token = env[REPORT_ENV_TOKEN]?.trim();
    this.url = url && token ? url : undefined;
    this.token = url && token ? token : undefined;
  }

  /**
   * Fire-and-forget; reporting must never affect task execution. Running snapshots
   * are deduped (progress churn resends the same shape); terminal snapshots always
   * go out so a lost request can't strand a finished task as running forever.
   */
  report(record: ByspaceReportRecord): void {
    if (!this.url || !this.token) return;
    if (record.status === "running") {
      const key = JSON.stringify(record);
      if (this.lastRunning.get(record.id) === key) return;
      this.lastRunning.set(record.id, key);
    } else {
      this.lastRunning.delete(record.id);
    }
    try {
      void fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: this.token, observations: [record] }),
      }).catch(() => {});
    } catch {
      /* fetch may throw synchronously in exotic runtimes; never propagate */
    }
  }
}
