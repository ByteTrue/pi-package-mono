import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { finished } from "node:stream/promises";
import {
  createLocalBashOperations,
  type BashOperations,
} from "@earendil-works/pi-coding-agent";

export type BackgroundStatus = "running" | "exited" | "killed" | "failed" | "timed_out";

export interface BackgroundTask {
  id: string;
  command: string;
  cwd: string;
  parentSessionId: string;
  status: BackgroundStatus;
  exitCode: number | null;
  createdAt: Date;
  outputPath: string;
  lineCount: number;
  tail: string;
  /** Hard lifetime cap in seconds, when one was set. */
  timeoutSeconds?: number;
  error?: string;
}

interface InternalTask extends BackgroundTask {
  controller: AbortController;
  notifyOnExit: boolean;
  notified: boolean;
  done: Promise<void>;
}

export interface StartOptions {
  /** Hard lifetime cap in seconds; the task is killed when it expires. */
  timeoutSeconds?: number;
  /** Shell operations to run the command with; defaults to bash with no custom shellPath. */
  operations?: BashOperations;
  /** Environment for the child process; omit to let the backend use the default shell env. */
  env?: NodeJS.ProcessEnv;
  /** Prepended to the command (the user's shellCommandPrefix, e.g. venv activation). */
  commandPrefix?: string;
}

/** Recent-output preview held in memory for background_status; the full output lives in the file. */
const TAIL_PREVIEW_CHARS = 4000;
/** Output-file cap: beyond this the file stops growing and a truncation marker is appended. */
export const OUTPUT_FILE_CAP_BYTES = 50 * 1024 * 1024;

const OUTPUT_DIR = join(tmpdir(), "pi-background-terminal");
/** Orphan logs older than this are swept at extension load. $TMPDIR is OS-cleaned eventually; this only bounds the gap. */
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Removes bg_*.log files left behind by crashed Pi processes. Crash paths
 * (uncaughtException, terminal EIO) kill detached children without firing
 * session_shutdown, so the extension's normal cleanup never runs. Files owned by
 * live tasks in this process are skipped; a task from another Pi process that
 * stays silent for over 24h can still be swept — accepted, since $TMPDIR cleanup
 * would eventually remove it too.
 */
export function sweepOrphanLogs(): void {
  let entries: string[];
  try {
    entries = readdirSync(OUTPUT_DIR);
  } catch {
    return; // No dir yet, or unreadable — nothing to sweep.
  }
  const live = new Set(manager.listAll().map((task) => task.outputPath));
  const cutoff = Date.now() - ORPHAN_MAX_AGE_MS;
  for (const entry of entries) {
    if (!entry.startsWith("bg_") || !entry.endsWith(".log")) continue;
    const path = join(OUTPUT_DIR, entry);
    if (live.has(path)) continue;
    try {
      if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
    } catch {
      // A single unreadable/unremovable file must not abort the sweep.
    }
  }
}

export class BackgroundManager {
  private readonly tasks = new Map<string, InternalTask>();
  private onExit?: (task: BackgroundTask) => void;
  private onChange?: () => void;

  /** Registers callbacks for completion notifications and task-count changes. */
  init(onExit: (task: BackgroundTask) => void, onChange?: () => void): void {
    this.onExit = onExit;
    this.onChange = onChange;
  }

  /**
   * Starts a command in the background and returns immediately with its task info.
   * Output streams to a file on disk until the command exits or the owning Pi session ends.
   */
  start(command: string, cwd: string, parentSessionId: string, options?: StartOptions): BackgroundTask {
    return this.toPublic(this.spawn(command, cwd, parentSessionId, options));
  }

  private spawn(command: string, cwd: string, parentSessionId: string, options?: StartOptions): InternalTask {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const id = `bg_${randomBytes(8).toString("hex")}`;
    const outputPath = join(OUTPUT_DIR, `${id}.log`);
    // Create the file synchronously so callers can rely on it existing the moment start() returns;
    // createWriteStream opens asynchronously and would otherwise race the caller.
    writeFileSync(outputPath, "");
    const fileStream = createWriteStream(outputPath, { flags: "a" });
    const controller = new AbortController();
    const decoder = new StringDecoder("utf8");

    const task: InternalTask = {
      id,
      command,
      cwd,
      parentSessionId,
      status: "running",
      exitCode: null,
      createdAt: new Date(),
      outputPath,
      lineCount: 0,
      tail: "",
      timeoutSeconds: options?.timeoutSeconds,
      controller,
      notifyOnExit: true,
      notified: false,
      done: Promise.resolve(),
    };

    // Without this, a write failure (ENOSPC/EACCES on a long-lived task) is an unhandled stream
    // error, which Node promotes to an uncaught exception that takes down the whole Pi process.
    fileStream.on("error", (error) => {
      task.error = `output file write failed: ${error instanceof Error ? error.message : String(error)}`;
    });
    // Output-file cap: a pathological producer (`yes`) running for the full 600s default
    // lifetime would otherwise write tens of GB. Past the cap the file stops growing and a
    // marker line records what was dropped; the task itself keeps running to its exit.
    let fileBytes = 0;
    let fileCapped = false;

    const ops = options?.operations ?? createLocalBashOperations();
    const outputClosed = finished(fileStream, { cleanup: true }).catch(() => {});
    const execution = ops
      .exec(options?.commandPrefix ? `${options.commandPrefix}\n${command}` : command, cwd, {
        signal: controller.signal,
        env: options?.env,
        // ops.exec owns the hard-kill timeout: it kills the process tree and rejects with
        // `timeout:<seconds>` — the same mechanism the built-in bash tool relies on.
        timeout: options?.timeoutSeconds,
        onData: (chunk) => {
          // StringDecoder holds an incomplete multi-byte character until the rest of it arrives,
          // instead of corrupting the preview at chunk boundaries.
          this.appendTail(task, decoder.write(chunk));
          if (fileCapped) return;
          fileBytes += chunk.length;
          if (fileBytes > OUTPUT_FILE_CAP_BYTES) {
            fileCapped = true;
            // ponytail: ignores write() backpressure. Only matters if a chatty command outpaces the
            // disk; add a pause/resume shim if that ever shows up in practice.
            fileStream.write(`\n[output truncated: ${fileBytes - OUTPUT_FILE_CAP_BYTES} bytes dropped, producer kept running]\n`);
            return;
          }
          fileStream.write(chunk);
        },
      })
      .then(({ exitCode }) => {
        task.status = "exited";
        task.exitCode = exitCode;
      })
      .catch((error) => {
        if (error instanceof Error && error.message.startsWith("timeout:")) {
          task.status = "timed_out";
        } else if (controller.signal.aborted) {
          task.status = "killed";
        } else {
          task.status = "failed";
          task.error = error instanceof Error ? error.message : String(error);
        }
      });

    task.done = execution
      .then(() => {
        fileStream.end();
        return outputClosed;
      })
      .then(() => {
        this.emitChange();
        this.maybeNotify(task);
      })
      // A throwing onExit would otherwise be an unhandled rejection, which Node promotes to an
      // uncaught exception; a failed notification must not take down the host process.
      .catch(() => {});

    this.tasks.set(id, task);
    this.emitChange();
    return task;
  }

  get(id: string, parentSessionId: string): BackgroundTask | null {
    const task = this.tasks.get(id);
    if (!task || task.parentSessionId !== parentSessionId) return null;
    return this.toPublic(task);
  }

  list(parentSessionId: string): BackgroundTask[] {
    return this.listAll().filter((task) => task.parentSessionId === parentSessionId);
  }

  /** All tasks across sessions — used by the orphan sweep to protect live output files. */
  listAll(): BackgroundTask[] {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((task) => this.toPublic(task));
  }

  kill(id: string, parentSessionId: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.parentSessionId !== parentSessionId) return false;
    if (task.status !== "running") return false;
    task.notifyOnExit = false;
    task.controller.abort();
    return true;
  }

  private maybeNotify(task: InternalTask): void {
    if (task.notified) return;
    if (!task.notifyOnExit) return;
    task.notified = true;
    this.onExit?.(this.toPublic(task));
  }

  async clearSession(parentSessionId: string): Promise<void> {
    const tasks = Array.from(this.tasks.values()).filter((task) => task.parentSessionId === parentSessionId);

    for (const task of tasks) {
      task.notifyOnExit = false;
      if (task.status === "running") task.controller.abort();
      this.tasks.delete(task.id);
    }

    await Promise.all(
      tasks.map(async (task) => {
        await task.done;
        await rm(task.outputPath, { force: true }).catch(() => {});
      }),
    );
  }

  private emitChange(): void {
    try {
      this.onChange?.();
    } catch {
      // UI callbacks must not disrupt process lifecycle.
    }
  }

  private appendTail(task: InternalTask, chunk: string): void {
    task.lineCount += (chunk.match(/\n/g) ?? []).length;
    task.tail = (task.tail + chunk).slice(-TAIL_PREVIEW_CHARS);
  }

  private toPublic(task: InternalTask): BackgroundTask {
    const { controller: _controller, notifyOnExit: _notifyOnExit, notified: _notified, done: _done, ...publicTask } = task;
    return publicTask;
  }
}

// Pi's /reload re-imports every extension through jiti with `moduleCache: false`, which
// re-evaluates this module. A plain module-level instance would therefore be replaced on every
// /reload, orphaning tasks started before it: invisible to background_status, unstoppable by
// background_kill, and never notified. Pinning to a process global keeps one manager across
// re-imports. Tasks stay isolated by parentSessionId, so sharing one manager is safe.
//
// A stale install of an older version (e.g. an outdated npm cache) can load first in the same
// process and occupy the symbol with an instance that lacks newer methods, which would crash
// this module at load ("manager.listAll is not a function"). Reuse the global only if it has
// the methods this module needs; otherwise replace it — safe, because extensions all load at
// startup before any task can start. The check is by capability, not instanceof: /reload
// re-evaluates the class, so instances worth keeping are not instanceof this module's class.
const MANAGER_KEY = Symbol.for("@bytetrue/pi-background-terminal.manager");
const globalStore = globalThis as unknown as Record<symbol, BackgroundManager | undefined>;

function isCompatibleManager(instance: BackgroundManager | undefined): instance is BackgroundManager {
  return typeof instance?.listAll === "function";
}

export const manager: BackgroundManager = isCompatibleManager(globalStore[MANAGER_KEY])
  ? globalStore[MANAGER_KEY]
  : (globalStore[MANAGER_KEY] = new BackgroundManager());

