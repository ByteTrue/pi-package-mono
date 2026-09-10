import { mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manager, sweepOrphanLogs } from "./manager.js";

// The sweep runs against the real production dir; the files it deletes there ARE the
// orphans this feature exists to clean, so exercising the real path is the point.
// Other test files run in parallel and create real tasks there, so cleanup must only
// touch files this suite created — never a blanket wipe.
const DIR = join(tmpdir(), "pi-background-terminal");
const created: string[] = [];

function track(path: string): string {
  created.push(path);
  return path;
}

function makeLog(name: string, mtimeDaysAgo = 0): string {
  mkdirSync(DIR, { recursive: true });
  const path = track(join(DIR, name));
  writeFileSync(path, "x");
  if (mtimeDaysAgo > 0) {
    const stale = new Date(Date.now() - mtimeDaysAgo * 24 * 60 * 60 * 1000);
    utimesSync(path, stale, stale);
  }
  return path;
}

afterEach(() => {
  for (const path of created.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

describe("sweepOrphanLogs", () => {
  it("deletes bg_*.log files older than 24h and keeps fresh ones", () => {
    const oldPath = makeLog("bg_old1234.log", 2);
    const freshPath = makeLog("bg_fresh5678.log");

    sweepOrphanLogs();

    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(freshPath)).toBe(true);
  });

  it("skips output files owned by live tasks in this process, even when their mtime is stale", async () => {
    mkdirSync(DIR, { recursive: true });
    const task = manager.start("sleep 60", process.cwd(), "sweep-live-session");
    track(task.outputPath);
    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(task.outputPath, stale, stale);

    sweepOrphanLogs();

    expect(existsSync(task.outputPath)).toBe(true);
    manager.kill(task.id, "sweep-live-session");
    await manager.clearSession("sweep-live-session");
  });

  it("ignores files that do not match the bg_*.log pattern", () => {
    const stranger = makeLog("not-a-bg-file.log", 2);

    sweepOrphanLogs();

    expect(existsSync(stranger)).toBe(true);
  });

  it("is fail-soft: an unremovable entry (e.g. a directory named like a log) never propagates", () => {
    const awkward = track(join(DIR, "bg_dirlike.log"));
    mkdirSync(awkward, { recursive: true });
    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(awkward, stale, stale);

    expect(() => sweepOrphanLogs()).not.toThrow();
  });
});
