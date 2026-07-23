import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { OutputManager } from "./output-manager.js";
import { SessionLifecycleManager } from "./session-lifecycle.js";
import { NotificationManager } from "./notification-manager.js";
import type { PTYSessionInfo, ReadResult, SearchResult, SpawnOptions } from "./types.js";

export type SessionUpdateCallback = (session: PTYSessionInfo) => void;
export type RawOutputCallback = (session: PTYSessionInfo, rawData: string) => void;

export class PTYManager {
  private readonly lifecycle = new SessionLifecycleManager();
  private readonly output = new OutputManager();
  private readonly notifications = new NotificationManager();
  private readonly sessionUpdateCallbacks = new Set<SessionUpdateCallback>();
  private readonly rawOutputCallbacks = new Set<RawOutputCallback>();

  init(pi: ExtensionAPI): void {
    this.notifications.init(pi);
  }

  setCurrentSessionId(sessionId: string | null): void {
    this.notifications.setCurrentSessionId(sessionId);
  }

  spawn(opts: SpawnOptions): PTYSessionInfo {
    const session = this.lifecycle.spawn(
      opts,
      (current, rawData) => {
        const info = this.lifecycle.toInfo(current);
        for (const callback of this.rawOutputCallbacks) callback(info, rawData);
      },
      (current, exitCode) => {
        const info = this.lifecycle.toInfo(current);
        for (const callback of this.sessionUpdateCallbacks) callback(info);
        this.notifications.sendExitNotification(current, exitCode);
      },
    );

    const info = this.lifecycle.toInfo(session);
    for (const callback of this.sessionUpdateCallbacks) callback(info);
    return info;
  }

  list(parentSessionId?: string): PTYSessionInfo[] {
    return this.lifecycle.listSessions(parentSessionId);
  }

  get(id: string, parentSessionId?: string): PTYSessionInfo | null {
    const session = this.lifecycle.getSession(id, parentSessionId);
    return session ? this.lifecycle.toInfo(session) : null;
  }

  getRawBuffer(id: string, parentSessionId?: string): { raw: string; byteLength: number } | null {
    const session = this.lifecycle.getSession(id, parentSessionId);
    if (!session) return null;
    const raw = session.buffer.readRaw();
    return { raw, byteLength: session.buffer.byteLength };
  }

  read(id: string, parentSessionId: string, offset = 0, limit?: number): ReadResult | null {
    const session = this.lifecycle.getSession(id, parentSessionId);
    return session ? this.output.read(session, offset, limit) : null;
  }

  search(id: string, parentSessionId: string, pattern: RegExp, offset = 0, limit?: number): SearchResult | null {
    const session = this.lifecycle.getSession(id, parentSessionId);
    return session ? this.output.search(session, pattern, offset, limit) : null;
  }

  write(id: string, parentSessionId: string, data: string): boolean {
    const session = this.lifecycle.getSession(id, parentSessionId);
    if (!session) return false;
    return this.output.write(session, data);
  }

  kill(id: string, parentSessionId: string, cleanup = false): boolean {
    const success = this.lifecycle.kill(id, cleanup, parentSessionId);
    if (!success) return false;
    const info = this.get(id, parentSessionId);
    if (info) {
      for (const callback of this.sessionUpdateCallbacks) callback(info);
    }
    return true;
  }

  clearAllSessions(parentSessionId?: string): void {
    this.lifecycle.clearAllSessions(parentSessionId);
  }

  registerSessionUpdateCallback(callback: SessionUpdateCallback): void {
    this.sessionUpdateCallbacks.add(callback);
  }

  removeSessionUpdateCallback(callback: SessionUpdateCallback): void {
    this.sessionUpdateCallbacks.delete(callback);
  }

  registerRawOutputCallback(callback: RawOutputCallback): void {
    this.rawOutputCallbacks.add(callback);
  }

  removeRawOutputCallback(callback: RawOutputCallback): void {
    this.rawOutputCallbacks.delete(callback);
  }
}

export const manager = new PTYManager();
