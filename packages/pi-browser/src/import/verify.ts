import type { ExecFn } from "../env.js";
import { mergePlaywrightConfig, writePlaywrightConfig, type ManagedBrowserConfig } from "../config.js";
import { profileDir } from "../paths.js";

export type SmokeResult = { ok: true } | { ok: false; detail: string };

const SMOKE_SESSION = "pi-browser-check";

function tail(text: string, limit = 400): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return "…" + trimmed.slice(-limit);
}

async function closeQuietly(exec: ExecFn, session: string): Promise<void> {
  try {
    await exec("playwright-cli", ["-s=" + session, "close"], { timeout: 30_000 });
  } catch {
    /* nothing to clean up */
  }
}

/**
 * Prove the managed profile is launchable, using a scratch copy of the CLI config that
 * points at it. It must never reuse the live config: the current target may be the user's
 * daily profile, and launching that is exactly what this package must not do behind their
 * back (see codestable/epics/005…/issues/001 — a real-profile launch both timed out and
 * rewrote 111 files of their data).
 */
export async function runImportSmoke(
  exec: ExecFn,
  managed: ManagedBrowserConfig,
  smokeConfigPath: string,
  session = SMOKE_SESSION,
): Promise<SmokeResult> {
  const merged = mergePlaywrightConfig(undefined, { ...managed, userDataDir: profileDir(), headless: true });
  if (!merged.ok) return { ok: false, detail: merged.error };
  const written = writePlaywrightConfig(smokeConfigPath, merged.value);
  if (!written.ok) return { ok: false, detail: written.error };

  let detail: string | undefined;
  try {
    const opened = await exec(
      "playwright-cli",
      ["-s=" + session, "--config=" + smokeConfigPath, "open", "about:blank"],
      { timeout: 90_000 },
    );
    if (opened.code !== 0) {
      detail = tail(opened.stdout + "\n" + opened.stderr) || "exit code " + String(opened.code);
    }
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
  }
  await closeQuietly(exec, session);
  return detail === undefined ? { ok: true } : { ok: false, detail: tail(detail) };
}

/** Dedicated session for the manual sign-in window, so Sessions can single it out. */
export const LOGIN_SESSION = "pi-browser-login";

/**
 * Open a target in a visible window so the user can sign in by hand (sites whose logins
 * cannot be imported). It takes an explicit config path: sign-in always targets the copy
 * profile, never whatever the agent is currently driving. `closeLoginWindow` ends the flow —
 * closing the window by hand does NOT free the profile.
 */
export async function openLoginWindow(exec: ExecFn, configPath: string, session = LOGIN_SESSION): Promise<SmokeResult> {
  try {
    const opened = await exec(
      "playwright-cli",
      ["-s=" + session, "--config=" + configPath, "open", "--headed", "about:blank"],
      { timeout: 90_000 },
    );
    if (opened.code !== 0) {
      return { ok: false, detail: tail(opened.stdout + "\n" + opened.stderr) || "exit code " + String(opened.code) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: tail(error instanceof Error ? error.message : String(error)) };
  }
}

/**
 * Close the sign-in window so the profile is released. Safe to call when the user already
 * closed the window: on 0.1.19 that leaves the browser process and its SingletonLock alive,
 * and `close` is what actually tears them down.
 */
export async function closeLoginWindow(exec: ExecFn, session = LOGIN_SESSION): Promise<SmokeResult> {
  try {
    const closed = await exec("playwright-cli", ["-s=" + session, "close"], { timeout: 60_000 });
    if (closed.code !== 0) {
      return { ok: false, detail: tail(closed.stdout + "\n" + closed.stderr) || "exit code " + String(closed.code) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: tail(error instanceof Error ? error.message : String(error)) };
  }
}
