import type { ExecFn } from "../env.js";

export type SmokeResult = { ok: true } | { ok: false; detail: string };

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

/** Launch the imported profile once so a broken config or profile surfaces right away. */
export async function runImportSmoke(exec: ExecFn, session = "pi-browser-check"): Promise<SmokeResult> {
  let detail: string | undefined;
  try {
    const opened = await exec("playwright-cli", ["-s=" + session, "open", "about:blank"], { timeout: 90_000 });
    if (opened.code !== 0) {
      detail = tail(opened.stdout + "\n" + opened.stderr) || "exit code " + String(opened.code);
    }
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
  }
  await closeQuietly(exec, session);
  return detail === undefined ? { ok: true } : { ok: false, detail: tail(detail) };
}
