import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WEBSOCKET_RETRY_DELAY } from "../../constants.js";
import { routes } from "../shared/routes.js";
import type {
  SessionRawBufferResponse,
  WSMessageClient,
  WSMessageServer,
} from "../shared/types.js";
import type { PTYSessionInfo } from "../../pty/types.js";

type ConnectionState = "connecting" | "open" | "closed";

interface AppState {
  sessions: PTYSessionInfo[];
  activeSessionId: string | null;
  connectionState: ConnectionState;
  statusMessage: string;
  statusIsError: boolean;
  snapshotLoadingFor: string | null;
}

const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
const root = document.getElementById("app");
if (!root) throw new Error("Missing app root");

root.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-title">PTY Sessions</div>
        <div class="sidebar-subtitle">OpenCode-style background terminals for this Pi session</div>
        <div class="connection-chip" id="connection-chip" data-state="connecting">Connecting</div>
      </div>
      <div class="session-list" id="session-list"></div>
    </aside>
    <main class="main">
      <header class="toolbar">
        <div class="toolbar-copy">
          <div class="toolbar-title" id="session-title">No PTY session selected</div>
          <div class="toolbar-description" id="session-description">Start a background terminal with pty_spawn, then inspect it here.</div>
          <div class="toolbar-meta" id="session-meta"></div>
        </div>
        <div class="toolbar-actions">
          <button id="btn-refresh">Refresh</button>
          <button id="btn-kill" class="btn-danger">Kill</button>
          <button id="btn-cleanup">Cleanup</button>
        </div>
      </header>
      <section class="terminal-panel">
        <div class="terminal-frame">
          <div class="terminal-root" id="terminal-root"></div>
          <div class="empty-state visible" id="empty-state">No PTY session selected.</div>
        </div>
      </section>
      <div class="status-bar" id="status-bar">Ready.</div>
    </main>
  </div>
`;

const connectionChip = document.getElementById("connection-chip") as HTMLDivElement;
const sessionListEl = document.getElementById("session-list") as HTMLDivElement;
const titleEl = document.getElementById("session-title") as HTMLDivElement;
const descriptionEl = document.getElementById("session-description") as HTMLDivElement;
const metaEl = document.getElementById("session-meta") as HTMLDivElement;
const statusBarEl = document.getElementById("status-bar") as HTMLDivElement;
const emptyStateEl = document.getElementById("empty-state") as HTMLDivElement;
const refreshButton = document.getElementById("btn-refresh") as HTMLButtonElement;
const killButton = document.getElementById("btn-kill") as HTMLButtonElement;
const cleanupButton = document.getElementById("btn-cleanup") as HTMLButtonElement;

const terminal = new Terminal({
  convertEol: false,
  cursorBlink: true,
  allowTransparency: true,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 13,
  lineHeight: 1.25,
  theme: {
    background: "#0c1117",
    foreground: "#e6edf3",
    cursor: "#7ae0cb",
    selectionBackground: "rgba(122, 224, 203, 0.2)",
  },
});
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(document.getElementById("terminal-root") as HTMLElement);
fitAddon.fit();

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
const state: AppState = {
  sessions: [],
  activeSessionId: null,
  connectionState: token ? "connecting" : "closed",
  statusMessage: token ? "Connecting to PTY web monitor…" : "Missing auth token in URL.",
  statusIsError: !token,
  snapshotLoadingFor: null,
};

window.addEventListener("resize", () => fitAddon.fit());
terminal.onData((data) => {
  const active = getActiveSession();
  if (!active || active.status !== "running") return;
  sendWs({ type: "input", sessionId: active.id, data });
});

refreshButton.addEventListener("click", () => {
  requestSessionList();
  if (state.activeSessionId) requestSessionSnapshot(state.activeSessionId);
});
killButton.addEventListener("click", async () => {
  const active = getActiveSession();
  if (!active) return;
  await apiFetch(routes.session(active.id), { method: "DELETE" });
  setStatus(`Sent kill to ${active.id}.`, false);
  requestSessionList();
});
cleanupButton.addEventListener("click", async () => {
  const active = getActiveSession();
  if (!active) return;
  await apiFetch(routes.sessionCleanup(active.id), { method: "DELETE" });
  if (state.activeSessionId === active.id) {
    state.activeSessionId = null;
    terminal.clear();
  }
  setStatus(`Removed ${active.id}.`, false);
  requestSessionList();
  render();
});

render();
if (token) connect();

function connect(): void {
  clearReconnectTimer();
  state.connectionState = "connecting";
  render();
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}${routes.websocket}?token=${encodeURIComponent(token)}`;
  socket = new WebSocket(wsUrl);
  socket.addEventListener("open", () => {
    state.connectionState = "open";
    setStatus("Connected.", false);
    requestSessionList();
    if (state.activeSessionId) {
      sendWs({ type: "subscribe", sessionId: state.activeSessionId });
      requestSessionSnapshot(state.activeSessionId);
    }
    render();
  });
  socket.addEventListener("message", (event) => {
    handleServerMessage(JSON.parse(String(event.data)) as WSMessageServer);
  });
  socket.addEventListener("close", () => {
    state.connectionState = "closed";
    setStatus("Connection closed. Retrying…", true);
    render();
    reconnectTimer = window.setTimeout(connect, WEBSOCKET_RETRY_DELAY * 10);
  });
  socket.addEventListener("error", () => {
    setStatus("WebSocket error.", true);
    render();
  });
}

function handleServerMessage(message: WSMessageServer): void {
  switch (message.type) {
    case "session_list": {
      state.sessions = sortSessions(message.sessions);
      ensureActiveSession();
      render();
      if (state.activeSessionId) requestSessionSnapshot(state.activeSessionId);
      return;
    }
    case "session_update": {
      upsertSession(message.session);
      ensureActiveSession();
      render();
      return;
    }
    case "raw_data": {
      upsertSession(message.session);
      if (state.activeSessionId === message.session.id && state.snapshotLoadingFor !== message.session.id) {
        terminal.write(message.rawData);
      }
      render();
      return;
    }
    case "readRawResponse": {
      if (state.activeSessionId !== message.sessionId) return;
      terminal.clear();
      terminal.write(message.rawData);
      state.snapshotLoadingFor = null;
      fitAddon.fit();
      render();
      return;
    }
    case "subscribed":
    case "unsubscribed":
      return;
    case "error": {
      setStatus(message.error.message, true);
      render();
      return;
    }
  }
}

function requestSessionList(): void {
  sendWs({ type: "session_list" });
}

function requestSessionSnapshot(sessionId: string): void {
  if (state.connectionState !== "open") return;
  state.snapshotLoadingFor = sessionId;
  sendWs({ type: "subscribe", sessionId });
  sendWs({ type: "readRaw", sessionId });
  render();
}

function ensureActiveSession(): void {
  if (state.activeSessionId && state.sessions.some((session) => session.id === state.activeSessionId)) return;
  state.activeSessionId = state.sessions[0]?.id ?? null;
  if (state.activeSessionId) requestSessionSnapshot(state.activeSessionId);
  if (!state.activeSessionId) {
    state.snapshotLoadingFor = null;
    terminal.clear();
  }
}

function selectSession(sessionId: string): void {
  if (state.activeSessionId === sessionId) return;
  if (state.activeSessionId) sendWs({ type: "unsubscribe", sessionId: state.activeSessionId });
  state.activeSessionId = sessionId;
  terminal.clear();
  requestSessionSnapshot(sessionId);
  render();
}

function upsertSession(next: PTYSessionInfo): void {
  const index = state.sessions.findIndex((session) => session.id === next.id);
  if (index === -1) {
    state.sessions = sortSessions([...state.sessions, next]);
    return;
  }
  state.sessions = sortSessions([
    ...state.sessions.slice(0, index),
    next,
    ...state.sessions.slice(index + 1),
  ]);
}

function getActiveSession(): PTYSessionInfo | null {
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? null;
}

function render(): void {
  connectionChip.dataset.state = state.connectionState;
  connectionChip.textContent = state.connectionState === "open"
    ? "Connected"
    : state.connectionState === "connecting"
      ? "Connecting"
      : "Disconnected";

  sessionListEl.innerHTML = state.sessions.length === 0
    ? '<div class="session-card"><div class="session-card-title">No sessions</div><div class="session-card-desc">Use pty_spawn in Pi to create one.</div></div>'
    : state.sessions.map((session) => renderSessionCard(session)).join("");

  sessionListEl.querySelectorAll<HTMLButtonElement>("[data-session-id]").forEach((button) => {
    button.addEventListener("click", () => selectSession(button.dataset.sessionId!));
  });

  const active = getActiveSession();
  emptyStateEl.classList.toggle("visible", !active);
  if (!active) {
    titleEl.textContent = "No PTY session selected";
    descriptionEl.textContent = "Start a background terminal with pty_spawn, then inspect it here.";
    metaEl.innerHTML = "";
    killButton.disabled = true;
    cleanupButton.disabled = true;
  } else {
    titleEl.textContent = active.title;
    descriptionEl.textContent = active.description;
    metaEl.innerHTML = [
      pill(active.status + (active.timedOut ? " · timed out" : "")),
      pill(active.workdir),
      pill(`${active.command}${active.args.length ? ` ${active.args.join(" ")}` : ""}`),
      pill(`lines ${active.lineCount}`),
      active.timeoutSeconds ? pill(`timeout ${active.timeoutSeconds}s`) : "",
      active.exitCode !== undefined ? pill(`exit ${active.exitCode}`) : "",
    ].filter(Boolean).join("");
    killButton.disabled = active.status !== "running";
    cleanupButton.disabled = false;
  }

  statusBarEl.textContent = state.statusMessage;
  statusBarEl.classList.toggle("error", state.statusIsError);
}

function renderSessionCard(session: PTYSessionInfo): string {
  const active = session.id === state.activeSessionId ? " active" : "";
  const command = `${session.command}${session.args.length ? ` ${session.args.join(" ")}` : ""}`;
  return `
    <button class="session-card${active}" data-session-id="${escapeHtml(session.id)}">
      <div class="session-card-title">
        <span>${escapeHtml(session.title)}</span>
        <span class="session-card-status" data-status="${escapeHtml(session.status)}">${escapeHtml(session.status)}</span>
      </div>
      <div class="session-card-desc">${escapeHtml(session.description)}</div>
      <div class="session-card-command">${escapeHtml(command)}</div>
      <div class="session-card-meta">${escapeHtml(session.workdir)}</div>
    </button>
  `;
}

function pill(text: string): string {
  return `<span class="toolbar-pill">${escapeHtml(text)}</span>`;
}

function sendWs(message: WSMessageClient): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    let errorText = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) errorText = body.error;
    } catch {
      // Ignore parse errors.
    }
    throw new Error(errorText);
  }
  return response;
}

function sortSessions(sessions: PTYSessionInfo[]): PTYSessionInfo[] {
  return [...sessions].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function setStatus(message: string, isError: boolean): void {
  state.statusMessage = message;
  state.statusIsError = isError;
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
