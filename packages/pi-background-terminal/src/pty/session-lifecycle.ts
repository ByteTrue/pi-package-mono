import { randomBytes } from "node:crypto";
import * as nodePty from "@lydell/node-pty";
import { DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS } from "../constants.js";
import { RingBuffer } from "./buffer.js";
import type { PTYSession, PTYSessionInfo, SpawnOptions } from "./types.js";

export class SessionLifecycleManager {
  private readonly sessions = new Map<string, PTYSession>();
  private readonly sessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  spawn(
    opts: SpawnOptions,
    onData: (session: PTYSession, data: string) => void,
    onExit: (session: PTYSession, exitCode: number) => void,
  ): PTYSession {
    const sessionId = this.generateSessionId();
    const session: PTYSession = {
      id: sessionId,
      title: opts.title ?? opts.description,
      description: opts.description,
      command: opts.command,
      args: opts.args ?? [],
      workdir: opts.workdir ?? process.cwd(),
      env: opts.env,
      status: "running",
      pid: 0,
      createdAt: new Date(),
      parentSessionId: opts.parentSessionId,
      notifyOnExit: opts.notifyOnExit ?? false,
      timeoutSeconds: normalizeTimeoutSeconds(opts.timeoutSeconds),
      timedOut: false,
      buffer: new RingBuffer(),
      process: null,
    };

    const ptyProcess = nodePty.spawn(session.command, session.args, {
      name: process.env.TERM || "xterm-256color",
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
      cwd: session.workdir,
      env: { ...process.env, ...(session.env ?? {}) },
    });

    session.process = ptyProcess;
    session.pid = ptyProcess.pid;
    this.sessions.set(sessionId, session);
    this.setupEventHandlers(session, onData, onExit);
    this.scheduleTimeout(session, onExit);
    return session;
  }

  getSession(id: string, parentSessionId?: string): PTYSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (parentSessionId !== undefined && session.parentSessionId !== parentSessionId) return null;
    return session;
  }

  listSessions(parentSessionId?: string): PTYSessionInfo[] {
    return Array.from(this.sessions.values())
      .filter((session) => parentSessionId === undefined || session.parentSessionId === parentSessionId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((session) => this.toInfo(session));
  }

  kill(id: string, cleanup = false, parentSessionId?: string): boolean {
    const session = this.getSession(id, parentSessionId);
    if (!session) return false;

    if (session.status === "running") {
      session.status = "killing";
      try {
        session.process?.kill();
      } catch {
        // Ignore platform-specific kill errors.
      }
    }

    if (cleanup) {
      const timeout = this.sessionTimeouts.get(id);
      if (timeout) {
        clearTimeout(timeout);
        this.sessionTimeouts.delete(id);
      }
      session.buffer.clear();
      this.sessions.delete(id);
    }

    return true;
  }

  clearAllSessions(parentSessionId?: string): void {
    for (const session of this.sessions.values()) {
      if (parentSessionId !== undefined && session.parentSessionId !== parentSessionId) continue;
      this.kill(session.id, true, session.parentSessionId);
    }
  }

  toInfo(session: PTYSession): PTYSessionInfo {
    return {
      id: session.id,
      title: session.title,
      description: session.description,
      command: session.command,
      args: session.args,
      workdir: session.workdir,
      status: session.status,
      notifyOnExit: session.notifyOnExit,
      timeoutSeconds: session.timeoutSeconds,
      timedOut: session.timedOut,
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
      pid: session.pid,
      parentSessionId: session.parentSessionId,
      createdAt: session.createdAt.toISOString(),
      lineCount: session.buffer.length,
    };
  }

  private scheduleTimeout(
    session: PTYSession,
    onExit: (session: PTYSession, exitCode: number) => void,
  ): void {
    if (!session.timeoutSeconds || session.timeoutSeconds <= 0) return;
    const timeout = setTimeout(() => {
      const current = this.sessions.get(session.id);
      if (!current || current.status !== "running") return;
      current.timedOut = true;
      current.status = "killing";
      try {
        current.process?.kill();
      } catch {
        current.status = "killed";
        current.exitCode = 124;
        current.process = null;
        onExit(current, 124);
      }
    }, session.timeoutSeconds * 1000);
    this.sessionTimeouts.set(session.id, timeout);
  }

  private setupEventHandlers(
    session: PTYSession,
    onData: (session: PTYSession, data: string) => void,
    onExit: (session: PTYSession, exitCode: number) => void,
  ): void {
    session.process?.onData((data: string) => {
      session.buffer.append(data);
      onData(session, data);
    });

    session.process?.onExit(({ exitCode, signal }) => {
      const timeout = this.sessionTimeouts.get(session.id);
      if (timeout) {
        clearTimeout(timeout);
        this.sessionTimeouts.delete(session.id);
      }

      session.buffer.flush();
      session.status = session.status === "killing" ? "killed" : "exited";
      session.exitCode = exitCode;
      session.exitSignal = signal;
      session.process = null;
      onExit(session, exitCode ?? 0);
    });
  }

  private generateSessionId(): string {
    return `pty_${randomBytes(8).toString("hex")}`;
  }
}

function normalizeTimeoutSeconds(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}
