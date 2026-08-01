import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
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
}

/** Recent-output preview held in memory for background_status; the full output lives in the file. */
const TAIL_PREVIEW_CHARS = 4000;

const ops = createLocalBashOperations();
const OUTPUT_DIR = join(tmpdir(), "pi-background-terminal");

export class BackgroundManager {
  private readonly tasks = new Map<string, InternalTask>();
  private onExit?: (task: BackgroundTask) => void;

  /** Registers a callback invoked once, whenever any background task finishes. */
  init(onExit: (task: BackgroundTask) => void): void {
    this.onExit = onExit;
  }

  /**
   * Starts a command in the background and returns immediately with its task info.
   * Output streams to a file on disk as it's produced; `timeoutSeconds` is required
   * so a hung command is always auto-terminated.
   */
  start(command: string, cwd: string, parentSessionId: string, timeoutSeconds: number): BackgroundTask {
    // Pi does not validate tool parameters against the TypeBox schema before calling execute(),
    // so "required" in the schema is only a hint to the model. This is the real enforcement.
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      throw new Error("timeoutSeconds is required and must be a positive number.");
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
    };

    // Without this, a write failure (ENOSPC/EACCES on a long-lived task) is an unhandled stream
    // error, which Node promotes to an uncaught exception that takes down the whole Pi process.
    fileStream.on("error", (error) => {
      task.error = `output file write failed: ${error instanceof Error ? error.message : String(error)}`;
    });

    ops
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
      })
      .finally(() => {
        fileStream.end();
      })
      .then(() => {
        this.onExit?.(this.toPublic(task));
      })
      // A throwing onExit would otherwise be an unhandled rejection, which Node promotes to an
      // uncaught exception; a failed notification must not take down the host process.
      .catch(() => {});

    this.tasks.set(id, task);
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
    task.controller.abort();
    return true;
  }

  clearSession(parentSessionId: string): void {
    for (const task of this.tasks.values()) {
      if (task.parentSessionId !== parentSessionId) continue;
      if (task.status === "running") task.controller.abort();
      this.tasks.delete(task.id);
      rm(task.outputPath, { force: true }).catch(() => {});
    }
  }

  private appendTail(task: InternalTask, chunk: string): void {
    task.lineCount += (chunk.match(/\n/g) ?? []).length;
    task.tail = (task.tail + chunk).slice(-TAIL_PREVIEW_CHARS);
  }

  private toPublic(task: InternalTask): BackgroundTask {
    const { controller: _controller, ...publicTask } = task;
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
