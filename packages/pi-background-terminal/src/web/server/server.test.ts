import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { manager } from "../../pty/manager.js";
import { routes } from "../shared/routes.js";
import type { PTYSessionInfo } from "../../pty/types.js";
import type { WSMessageServer } from "../shared/types.js";
import { PtyWebServer } from "./server.js";

const WEB_SESSION_ID = "web-session";

describe("PtyWebServer", () => {
  let server: PtyWebServer | null = null;

  afterEach(async () => {
    manager.clearAllSessions(WEB_SESSION_ID);
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("serves session APIs and websocket updates", async () => {
    server = new PtyWebServer({
      parentSessionId: WEB_SESSION_ID,
      defaultWorkdir: process.cwd(),
    });
    await server.start();

    const url = new URL(server.url);
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    expect(token).toBeTruthy();

    const health = await fetch(new URL(routes.health, server.origin));
    expect(health.status).toBe(200);

    const unauthorized = await fetch(new URL(routes.sessions, server.origin));
    expect(unauthorized.status).toBe(401);

    const created = await fetch(new URL(routes.sessions, server.origin), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: process.execPath,
        args: ["-e", 'console.log("web hello")'],
        description: "web hello",
      }),
    });
    expect(created.status).toBe(200);
    const session = await created.json() as PTYSessionInfo;
    expect(session.description).toBe("web hello");

    const rawText = await waitForApiOutput(server.origin, token!, session.id);
    expect(rawText).toContain("web hello");

    const socket = new WebSocket(`ws://${url.host}${routes.websocket}?token=${encodeURIComponent(token!)}`);
    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "session_list" }));
    const listMessage = await waitForMessage(socket, (message): message is Extract<WSMessageServer, { type: "session_list" }> => message.type === "session_list");
    expect(listMessage.sessions.some((item) => item.id === session.id)).toBe(true);

    socket.send(JSON.stringify({ type: "subscribe", sessionId: session.id }));
    socket.send(JSON.stringify({ type: "readRaw", sessionId: session.id }));
    const rawMessage = await waitForMessage(socket, (message): message is Extract<WSMessageServer, { type: "readRawResponse" }> => message.type === "readRawResponse");
    expect(rawMessage.rawData).toContain("web hello");

    socket.close();
  });
});

async function waitForOpen(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

async function waitForApiOutput(origin: string, token: string, sessionId: string, timeoutMs = 8_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(new URL(routes.sessionBufferRaw(sessionId), origin), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const body = await response.json() as { raw: string };
      if (body.raw.includes("web hello")) return body.raw;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for PTY output over HTTP");
}

async function waitForMessage<T extends WSMessageServer>(
  socket: WebSocket,
  predicate: (message: WSMessageServer) => message is T,
  timeoutMs = 8_000,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message"));
    }, timeoutMs);

    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(String(data)) as WSMessageServer;
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}
