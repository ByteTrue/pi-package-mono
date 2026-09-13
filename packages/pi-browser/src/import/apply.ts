import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

export type ApplyResult<T> = { ok: true; value: T } | { ok: false; error: string };

const LOCK_FILES = new Set(["SingletonLock", "SingletonSocket", "SingletonCookie"]);

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Chromium holds a profile via a SingletonLock symlink shaped `<hostname>-<pid>`.
 * A lock with a dead pid is stale and does not block an import.
 */
export function isProfileInUse(profileDir: string, isAlive: (pid: number) => boolean = defaultIsAlive): boolean {
  const lock = join(profileDir, "SingletonLock");
  let stats;
  try {
    // lstat: the lock is a dangling symlink by design, so existsSync would lie.
    stats = lstatSync(lock);
  } catch {
    return false;
  }
  if (!stats.isSymbolicLink()) return true; // a plain file (Windows) — assume the browser holds it
  let target: string;
  try {
    target = readlinkSync(lock);
  } catch {
    return true;
  }
  const match = /-(\d+)$/.exec(target);
  const pid = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
  if (!Number.isFinite(pid) || pid <= 0) return true;
  return isAlive(pid);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function createStagingRoot(parent: string, prefix: string): string {
  const path = join(parent, prefix + "-" + stamp() + "-" + randomUUID().slice(0, 8));
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

function copyTree(source: string, target: string): void {
  cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (path) => !LOCK_FILES.has(basename(path)),
  });
}

/**
 * Build the next profile off to the side: keep the live profile (so anything the managed
 * browser wrote survives), then overlay the freshly imported snapshot on top.
 */
export function buildStagingProfile(request: {
  profileDir: string;
  snapshotRoot: string;
}): ApplyResult<{ stagingDir: string }> {
  const stagingDir = request.profileDir + ".importing-" + stamp();
  try {
    if (existsSync(request.profileDir)) copyTree(request.profileDir, stagingDir);
    else mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
    copyTree(request.snapshotRoot, stagingDir);
    chmodSync(stagingDir, 0o700);
    const cookies = join(stagingDir, "Default", "Cookies");
    if (existsSync(cookies)) chmodSync(cookies, 0o600);
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    return { ok: false, error: message(error) };
  }
  return { ok: true, value: { stagingDir } };
}

/** Swap the staged profile in; the previous profile is only deleted after the swap succeeded. */
export function swapIntoPlace(stagingDir: string, profileDir: string): ApplyResult<{ replaced: boolean }> {
  const previous = profileDir + ".previous-" + stamp();
  const hadPrevious = existsSync(profileDir);
  try {
    if (hadPrevious) renameSync(profileDir, previous);
    try {
      renameSync(stagingDir, profileDir);
    } catch (error) {
      if (hadPrevious) renameSync(previous, profileDir);
      return { ok: false, error: message(error) };
    }
    if (hadPrevious) rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  return { ok: true, value: { replaced: hadPrevious } };
}

export function discardStaging(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export function clearProfileData(profileDir: string): ApplyResult<{ existed: boolean }> {
  const existed = existsSync(profileDir);
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  return { ok: true, value: { existed } };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
