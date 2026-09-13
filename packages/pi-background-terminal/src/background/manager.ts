import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { finished } from "node:stream/promises";
import {
  createLocalBashOperations,
  truncateTail,
  DEFAULT_MAX_BYTES,
  formatSize,
  type AgentToolResult,
  type BashToolDetails,
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
  /** Hard lifetime cap in seconds; if set, the task is killed when it expires (foreground or background). */
  timeoutSeconds?: number;
  /** true = never send the exit notification (startAndWait decides after the race). */
  suppressNotify?: boolean;
  /** Shell operations to run the command with; defaults to bash with no custom shellPath. */
  operations?: BashOperations;
  /** Environment for the child process; omit to let the backend use the default shell env. */
  env?: NodeJS.ProcessEnv;
  /** Prepended to the command (the user's shellCommandPrefix, e.g. venv activation). */
  commandPrefix?: string;
}

/** Recent-output preview held in memory for background_status; the full output lives in the file. */
const TAIL_PREVIEW_CHARS = 4000;
/** Upper bound on how much of the output file an inline result reads into memory. */
const INLINE_READ_CAP = 2 * 1024 * 1024;

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
      notifyOnExit: !options?.suppressNotify,
      notified: false,
      done: Promise.resolve(),
    };

    // Without this, a write failure (ENOSPC/EACCES on a long-lived task) is an unhandled stream
    // error, which Node promotes to an uncaught exception that takes down the whole Pi process.
    fileStream.on("error", (error) => {
      task.error = `output file write failed: ${error instanceof Error ? error.message : String(error)}`;
    });

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
          // ponytail: ignores write() backpressure. Only matters if a chatty command outpaces the
          // disk; add a pause/resume shim if that ever shows up in practice.
          fileStream.write(chunk);
          // StringDecoder holds an incomplete multi-byte character until the rest of it arrives,
          // instead of corrupting the preview at chunk boundaries.
          this.appendTail(task, decoder.write(chunk));
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

  /**
   * Runs a command and waits up to `waitMs` for it to finish, returning the complete
   * tool result either way: the inline output when it exits in time, or the demoted
   * background-task report when it does not (its exit notifies the agent later).
   *
   * `signal` aborting mid-wait kills the task and surfaces "Command aborted"
   * with the partial output — the same shape the built-in tool's abort produces,
   * so a cancelled call never leaves a follow-up wake-up behind.
   */
  async runWithWait(
    command: string,
    cwd: string,
    parentSessionId: string,
    options: {
      waitMs: number;
      signal?: AbortSignal;
      settings: { commandPrefix?: string; shellPath?: string };
      env?: NodeJS.ProcessEnv;
      timeoutSeconds?: number;
    },
  ): Promise<AgentToolResult<BashToolDetails | undefined>> {
    const task = this.spawn(command, cwd, parentSessionId, {
      timeoutSeconds: options.timeoutSeconds,
      // The inline path returns the outcome directly, so the exit notification would be a
      // duplicate; only the demoted path re-arms it below.
      suppressNotify: options.waitMs > 0,
      operations: createLocalBashOperations({ shellPath: options.settings.shellPath }),
      env: options.env,
      commandPrefix: options.settings.commandPrefix,
    });

    const done = task.done.then(() => this.toPublic(task));
    if (options.waitMs > 0) {
      const timer = new Promise<null>((resolve) => {
        const handle = setTimeout(() => resolve(null), options.waitMs);
        handle.unref();
      });
      const racers: Array<Promise<BackgroundTask | null>> = [done, timer];
      if (options.signal) {
        racers.push(
          new Promise<null>((resolve) => {
            if (options.signal!.aborted) return resolve(null);
            options.signal!.addEventListener("abort", () => resolve(null), { once: true });
          }),
        );
      }
      const settled = await Promise.race(racers);

      if (options.signal?.aborted) {
        // The user cancelled mid-wait: kill silently, then report like the built-in tool.
        task.notifyOnExit = false;
        task.controller.abort();
        await task.done;
        throw new Error(appendStatus((await this.readTail(task)).output, "Command aborted"));
      }
      if (settled && settled.status !== "running") {
        return await this.inlineResult(settled);
      }
    }
    this.notifyOnSettle(task.id);
    const lead = options.waitMs > 0 ? `Still running after ${options.waitMs / 1000}s; moved to the background.\n` : `Started in the background.\n`;
    return {
      content: [{ type: "text", text: `${lead}Task id: ${task.id}\nOutput file: ${task.outputPath}\nYou will be notified when it exits.` }],
      details: undefined,
    };
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

  /** Re-arms the exit notification for a demoted task (settle may already have happened). */
  private notifyOnSettle(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.notifyOnExit = true;
    if (task.status !== "running") this.maybeNotify(task);
  }

  private maybeNotify(task: InternalTask): void {
    if (task.notified) return;
    if (!task.notifyOnExit) return;
    task.notified = true;
    this.onExit?.(this.toPublic(task));
  }

  /**
   * Formats a settled task as the inline tool result, mirroring the built-in bash tool:
   * tail-truncated output (all three footer variants), non-zero exits and timeouts
   * throw with the output prefixed.
   */
  private async inlineResult(task: BackgroundTask): Promise<AgentToolResult<BashToolDetails | undefined>> {
    const { output, tailCapped } = await this.readTail(task);
    let truncation = truncateTail(output);
    if (tailCapped && !truncation.truncated) {
      // The file exceeded the read cap; honest totals come from the tracked line count.
      truncation = {
        ...truncation,
        truncated: true,
        truncatedBy: "bytes",
        totalLines: task.lineCount + (output.endsWith("\n") ? 0 : 1),
      };
    }
    let text = truncation.content;
    let details: BashToolDetails | undefined;
    if (truncation.truncated) {
      details = { truncation, fullOutputPath: task.outputPath };
      const startLine = truncation.totalLines - truncation.outputLines + 1;
      const endLine = truncation.totalLines;
      if (truncation.lastLinePartial) {
        const lastLineBytes = Buffer.byteLength(output.slice(output.lastIndexOf("\n") + 1));
        text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${formatSize(lastLineBytes)}). Full output: ${task.outputPath}]`;
      } else if (truncation.truncatedBy === "bytes") {
        text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${task.outputPath}]`;
      } else {
        text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${task.outputPath}]`;
      }
    }
    if (task.status === "failed") {
      throw new Error(appendStatus(text, `Command failed: ${task.error ?? "unknown error"}`));
    }
    if (task.status === "timed_out") {
      throw new Error(appendStatus(text, `Command timed out after ${task.timeoutSeconds} seconds`));
    }
    if (task.status === "killed") {
      throw new Error(appendStatus(text, "Command aborted"));
    }
    if (task.exitCode !== 0 && task.exitCode !== null) {
      throw new Error(appendStatus(text, `Command exited with code ${task.exitCode}`));
    }
    return { content: [{ type: "text", text: text || "(no output)" }], details };
  }

  /** Reads the output file for an inline result, capped so a pathological producer cannot OOM the host. */
  private async readTail(task: BackgroundTask): Promise<{ output: string; tailCapped: boolean }> {
    const { open, stat } = await import("node:fs/promises");
    try {
      const size = (await stat(task.outputPath)).size;
      if (size <= INLINE_READ_CAP) {
        return { output: await readFile(task.outputPath, "utf8"), tailCapped: false };
      }
      const handle = await open(task.outputPath, "r");
      try {
        const buffer = Buffer.alloc(INLINE_READ_CAP);
        await handle.read(buffer, 0, INLINE_READ_CAP, size - INLINE_READ_CAP);
        return { output: buffer.toString("utf8"), tailCapped: true };
      } finally {
        await handle.close();
      }
    } catch {
      // The output file is the source of truth, but its absence must not mask the exit status.
      return { output: "", tailCapped: false };
    }
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
const MANAGER_KEY = Symbol.for("@bytetrue/pi-background-terminal.manager");
const globalStore = globalThis as unknown as Record<symbol, BackgroundManager | undefined>;

export const manager: BackgroundManager = (globalStore[MANAGER_KEY] ??= new BackgroundManager());

/** Same layout the built-in bash tool uses when it appends a status to captured output. */
function appendStatus(text: string, status: string): string {
  return text ? `${text}\n\n${status}` : status;
}
