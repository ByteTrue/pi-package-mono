import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { finished } from "node:stream/promises";
import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";

export type BackgroundStatus = "running" | "exited" | "killed" | "timed_out" | "failed";

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
  error?: string;
}

interface InternalTask extends BackgroundTask {
  controller: AbortController;
  notifyOnExit: boolean;
  done: Promise<void>;
}

/** Recent-output preview held in memory for background_status; the full output lives in the file. */
const TAIL_PREVIEW_CHARS = 4000;

const ops = createLocalBashOperations();
const OUTPUT_DIR = join(tmpdir(), "pi-background-terminal");

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
   * Output streams to a file on disk as it's produced; omitting `timeoutSeconds` leaves the command running
   * until it exits or the owning Pi session ends.
   */
  start(command: string, cwd: string, parentSessionId: string, timeoutSeconds?: number): BackgroundTask {
    // Pi does not validate tool parameters against the TypeBox schema before calling execute(),
    // so this is the real enforcement for an explicitly supplied timeout.
    if (timeoutSeconds !== undefined && (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)) {
      throw new Error("timeoutSeconds must be a positive number when provided.");
    }

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
      controller,
      notifyOnExit: true,
      done: Promise.resolve(),
    };

    // Without this, a write failure (ENOSPC/EACCES on a long-lived task) is an unhandled stream
    // error, which Node promotes to an uncaught exception that takes down the whole Pi process.
    fileStream.on("error", (error) => {
      task.error = `output file write failed: ${error instanceof Error ? error.message : String(error)}`;
    });

    const outputClosed = finished(fileStream, { cleanup: true }).catch(() => {});
    const execution = ops
      .exec(command, cwd, {
        signal: controller.signal,
        timeout: timeoutSeconds,
        onData: (chunk) => {
          // ponytail: ignores write() backpressure. Only matters if a chatty command outpaces the
          // disk; add a pause/resume shim if that ever shows up in practice.
          fileStream.write(chunk);
          // StringDecoder holds an incomplete multi-byte character until the rest of it arrives,
          // instead of corrupting the preview at chunk boundaries.
          this.appendTail(task, decoder.write(chunk));
        },
      })
      .then(({ exitCode }) => {
        // exec throws for the abort and timeout cases, so reaching here is a natural exit.
        task.status = "exited";
        task.exitCode = exitCode;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("timeout:")) {
          task.status = "timed_out";
        } else if (controller.signal.aborted) {
          task.status = "killed";
        } else {
          // Never ran or died before producing an exit code: bad cwd, no shell on this machine,
          // an out-of-range timeout. Reporting this as "exited" would be a lie.
          task.status = "failed";
          task.error = message;
        }
      });

    task.done = execution
      .then(() => {
        fileStream.end();
        return outputClosed;
      })
      .then(() => {
        this.emitChange();
        if (task.notifyOnExit) this.onExit?.(this.toPublic(task));
      })
      // A throwing onExit would otherwise be an unhandled rejection, which Node promotes to an
      // uncaught exception; a failed notification must not take down the host process.
      .catch(() => {});

    this.tasks.set(id, task);
    this.emitChange();
    return this.toPublic(task);
  }

  get(id: string, parentSessionId: string): BackgroundTask | null {
    const task = this.tasks.get(id);
    if (!task || task.parentSessionId !== parentSessionId) return null;
    return this.toPublic(task);
  }

  list(parentSessionId: string): BackgroundTask[] {
    return Array.from(this.tasks.values())
      .filter((task) => task.parentSessionId === parentSessionId)
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
    const { controller: _controller, notifyOnExit: _notifyOnExit, done: _done, ...publicTask } = task;
    return publicTask;
  }
}

// Pi's /reload re-imports every extension through jiti with `moduleCache: false`, which
// re-evaluates this module. A plain module-level instance would therefore be replaced on every
// /reload, orphaning tasks started before it: invisible to background_status, unstoppable by
// background_kill, and never notified. Pinning to a process global keeps one manager across
// re-imports. Tasks stay isolated by parentSessionId, so sharing one manager is safe.
const MANAGER_KEY = Symbol.for("@bytetrue/pi-background-terminal.manager");
const globalStore = globalThis as unknown as Record<symbol, BackgroundManager | undefined>;

export const manager: BackgroundManager = (globalStore[MANAGER_KEY] ??= new BackgroundManager());
