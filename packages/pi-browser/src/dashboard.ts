import http from "node:http";
import { execFile, spawn } from "node:child_process";
import type { ExecFn } from "./env.js";
import { resolveAgentBrowserCommand } from "./cli.js";

export const DEFAULT_DASHBOARD_PORT = 4848;
export const DEFAULT_DASHBOARD_URL = `http://localhost:${DEFAULT_DASHBOARD_PORT}`;

export type DashboardStatus = {
  running: boolean;
  port: number;
  url: string;
};

/**
 * Check whether the local agent-browser observability dashboard is running.
 * Responds in <10ms via a fast localhost HTTP ping.
 */
export function checkDashboardStatus(
  port: number = DEFAULT_DASHBOARD_PORT,
  timeoutMs: number = 500,
): Promise<DashboardStatus> {
  const url = `http://localhost:${port}`;
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}`, { timeout: timeoutMs }, (res) => {
      resolve({
        running: res.statusCode !== undefined && res.statusCode < 500,
        port,
        url,
      });
    });
    req.on("error", () => resolve({ running: false, port, url }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ running: false, port, url });
    });
  });
}

/** Start the local observability dashboard background process. */
export async function startDashboard(
  exec: ExecFn,
  port: number = DEFAULT_DASHBOARD_PORT,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const current = await checkDashboardStatus(port);
  if (current.running) return { ok: true, url: current.url };

  const resolved = resolveAgentBrowserCommand();
  const args = [...(resolved.args ?? []), "dashboard", "start", "--port", String(port)];

  let result;
  try {
    result = await exec(resolved.command, args, { timeout: 15_000 });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (result.code !== 0) {
    const msg = `${result.stdout}\n${result.stderr}`.trim();
    return { ok: false, error: msg || `Failed to start dashboard (exit code ${String(result.code)})` };
  }

  // Poll briefly for HTTP server availability
  const start = Date.now();
  while (Date.now() - start < 3_000) {
    const check = await checkDashboardStatus(port, 300);
    if (check.running) return { ok: true, url: check.url };
    await new Promise((r) => setTimeout(r, 200));
  }

  return { ok: true, url: `http://localhost:${port}` };
}

/** Stop the local observability dashboard process. */
export async function stopDashboard(
  exec: ExecFn,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resolved = resolveAgentBrowserCommand();
  const args = [...(resolved.args ?? []), "dashboard", "stop"];

  try {
    await exec(resolved.command, args, { timeout: 10_000 });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  return { ok: true };
}

/** Open a URL in the user's default OS browser. */
export function openExternalUrl(url: string, platform: NodeJS.Platform = process.platform): void {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  try {
    if (platform === "win32") {
      spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "darwin") {
      execFile("open", [url]);
    } else {
      execFile("xdg-open", [url]);
    }
  } catch {
    // Non-blocking best effort
  }
}
