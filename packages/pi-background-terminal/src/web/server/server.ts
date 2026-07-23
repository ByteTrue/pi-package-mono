import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { DEFAULT_WEB_HOST, DEFAULT_WEB_PORT } from "../../constants.js";
import { manager, type RawOutputCallback, type SessionUpdateCallback } from "../../pty/manager.js";
import { checkCommandPermission, checkWorkdirPermission } from "../../pty/permissions.js";
import { ASSET_CONTENT_TYPES } from "../shared/constants.js";
import { routes } from "../shared/routes.js";
import type {
  CreateSessionRequestBody,
  InputRequestBody,
  SessionPlainBufferResponse,
  SessionRawBufferResponse,
  WSMessageClient,
  WSMessageClientInput,
  WSMessageClientReadRaw,
  WSMessageClientSpawnSession,
  WSMessageClientSubscribeSession,
  WSMessageClientUnsubscribeSession,
  WSMessageServer,
  WSMessageServerError,
  WSMessageServerRawData,
  WSMessageServerReadRawResponse,
  WSMessageServerSessionList,
  WSMessageServerSessionUpdate,
  WSMessageServerSubscribedSession,
  WSMessageServerUnsubscribedSession,
} from "../shared/types.js";

interface StaticAsset {
  body: Buffer;
  contentType: string;
}

export interface PtyWebServerOptions {
  parentSessionId: string;
  defaultWorkdir: string;
  host?: string;
  port?: number;
}

export class PtyWebServer {
  private readonly token = randomBytes(24).toString("base64url");
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly httpServer = createServer((req, res) => {
    void this.handleRequest(req, res);
  });
  private readonly wsServer = new WebSocketServer({ noServer: true });
  private readonly sockets = new Set<Socket>();
  private readonly clients = new Set<WebSocket>();
  private readonly subscriptions = new Map<WebSocket, Set<string>>();
  private readonly staticAssets = new Map<string, StaticAsset>();
  private actualPort = 0;
  private readonly onSessionUpdate: SessionUpdateCallback = (session) => {
    if (session.parentSessionId !== this.options.parentSessionId) return;
    const message: WSMessageServerSessionUpdate = { type: "session_update", session };
    this.broadcast(message);
  };
  private readonly onRawOutput: RawOutputCallback = (session, rawData) => {
    if (session.parentSessionId !== this.options.parentSessionId) return;
    const message: WSMessageServerRawData = { type: "raw_data", session, rawData };
    for (const client of this.clients) {
      const topics = this.subscriptions.get(client);
      if (!topics?.has(session.id)) continue;
      this.send(client, message);
    }
  };

  constructor(private readonly options: PtyWebServerOptions) {
    this.host = options.host ?? DEFAULT_WEB_HOST;
    this.requestedPort = options.port ?? DEFAULT_WEB_PORT;
  }

  get url(): string {
    return `${this.origin}/#token=${this.token}`;
  }

  get origin(): string {
    return `http://${this.host}:${this.actualPort}`;
  }

  async start(): Promise<void> {
    await this.loadStaticAssets();

    manager.registerSessionUpdateCallback(this.onSessionUpdate);
    manager.registerRawOutputCallback(this.onRawOutput);

    this.httpServer.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
    });

    this.httpServer.on("upgrade", (req, socket, head) => {
      const url = this.getRequestUrl(req);
      if (!url || url.pathname !== routes.websocket) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      if (!this.isExpectedHost(req) || !this.isExpectedOrigin(req) || url.searchParams.get("token") !== this.token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wsServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        this.wsServer.emit("connection", ws, req);
      });
    });

    this.wsServer.on("connection", (ws: WebSocket) => {
      this.clients.add(ws);
      this.subscriptions.set(ws, new Set());
      ws.on("message", (data: WebSocket.RawData) => this.handleWebSocketMessage(ws, data));
      ws.on("close", () => {
        this.clients.delete(ws);
        this.subscriptions.delete(ws);
      });
    });

    await new Promise<void>((resolveListen, rejectListen) => {
      this.httpServer.once("error", rejectListen);
      this.httpServer.listen(this.requestedPort, this.host, () => {
        this.httpServer.off("error", rejectListen);
        resolveListen();
      });
    });

    const address = this.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Failed to resolve PTY web server address");
    this.actualPort = address.port;
  }

  async stop(): Promise<void> {
    manager.removeSessionUpdateCallback(this.onSessionUpdate);
    manager.removeRawOutputCallback(this.onRawOutput);

    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        // Ignore close errors.
      }
    }
    this.clients.clear();
    this.subscriptions.clear();

    await new Promise<void>((resolveClose) => {
      this.httpServer.close(() => resolveClose());
      for (const socket of this.sockets) socket.destroy();
    });
    await new Promise<void>((resolveClose) => this.wsServer.close(() => resolveClose()));
  }

  private async loadStaticAssets(): Promise<void> {
    const assetDir = resolve(dirname(fileURLToPath(import.meta.url)), "../assets");
    const files: Array<[string, string]> = [
      ["/", "index.html"],
      ["/index.html", "index.html"],
      ["/assets/app.js", "app.js"],
      ["/assets/app.css", "app.css"],
    ];

    for (const [routePath, fileName] of files) {
      const filePath = resolve(assetDir, fileName);
      try {
        const body = await readFile(filePath);
        const contentType = ASSET_CONTENT_TYPES[extname(fileName)] ?? "application/octet-stream";
        this.staticAssets.set(routePath, { body, contentType });
      } catch (error) {
        if (fileName === "app.css") continue;
        throw new Error(`Missing web asset ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = this.getRequestUrl(req);
    if (!url) {
      this.sendJson(res, 400, { error: "Invalid request URL" });
      return;
    }

    if (!this.isExpectedHost(req)) {
      this.sendJson(res, 403, { error: "Unexpected host" });
      return;
    }

    if (url.pathname === routes.health) {
      this.sendJson(res, 200, {
        ok: true,
        sessions: manager.list(this.options.parentSessionId).length,
      });
      return;
    }

    const staticAsset = this.staticAssets.get(url.pathname);
    if (staticAsset) {
      this.sendBytes(res, 200, staticAsset.body, staticAsset.contentType);
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      this.sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (!this.isExpectedOrigin(req) || !this.isAuthorizedApiRequest(req, url)) {
      this.sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    await this.handleApiRequest(req, res, url);
  }

  private async handleApiRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    const path = url.pathname;

    if (method === "GET" && path === routes.sessions) {
      this.sendJson(res, 200, manager.list(this.options.parentSessionId));
      return;
    }

    if (method === "POST" && path === routes.sessions) {
      const body = await this.readJson<CreateSessionRequestBody>(req, res);
      if (!body) return;
      if (!body.command || typeof body.command !== "string" || body.command.trim() === "") {
        this.sendJson(res, 400, { error: "Command is required" });
        return;
      }
      if (!body.description || typeof body.description !== "string" || body.description.trim() === "") {
        this.sendJson(res, 400, { error: "Description is required" });
        return;
      }
      try {
        const args = body.args ?? [];
        await checkCommandPermission(body.command, args);
        if (body.workdir) await checkWorkdirPermission(body.workdir);
        const session = manager.spawn({
          command: body.command,
          args,
          description: body.description,
          workdir: body.workdir ?? this.options.defaultWorkdir,
          env: body.env,
          title: body.title,
          notifyOnExit: body.notifyOnExit,
          timeoutSeconds: body.timeoutSeconds,
          parentSessionId: this.options.parentSessionId,
        });
        this.sendJson(res, 200, session);
      } catch (error) {
        this.sendJson(res, 400, { error: getErrorMessage(error) });
      }
      return;
    }

    if (method === "DELETE" && path === routes.sessions) {
      manager.clearAllSessions(this.options.parentSessionId);
      this.sendJson(res, 200, { success: true });
      return;
    }

    const sessionRoute = this.matchSessionRoute(path);
    if (!sessionRoute) {
      this.sendJson(res, 404, { error: "Not found" });
      return;
    }

    const { id, suffix } = sessionRoute;
    if (method === "GET" && suffix === "") {
      const session = manager.get(id, this.options.parentSessionId);
      if (!session) {
        this.sendJson(res, 404, { error: "Session not found" });
        return;
      }
      this.sendJson(res, 200, session);
      return;
    }

    if (method === "DELETE" && suffix === "") {
      const success = manager.kill(id, this.options.parentSessionId, false);
      this.sendJson(res, success ? 200 : 404, success ? { success: true } : { error: "Session not found" });
      return;
    }

    if (method === "DELETE" && suffix === "/cleanup") {
      const success = manager.kill(id, this.options.parentSessionId, true);
      this.sendJson(res, success ? 200 : 404, success ? { success: true } : { error: "Session not found" });
      return;
    }

    if (method === "POST" && suffix === "/input") {
      const body = await this.readJson<InputRequestBody>(req, res);
      if (!body) return;
      if (typeof body.data !== "string") {
        this.sendJson(res, 400, { error: "Data must be a string" });
        return;
      }
      const success = manager.write(id, this.options.parentSessionId, body.data);
      this.sendJson(res, success ? 200 : 404, success ? { success: true } : { error: "Session not found" });
      return;
    }

    if (method === "GET" && suffix === "/buffer/raw") {
      const raw = manager.getRawBuffer(id, this.options.parentSessionId);
      if (!raw) {
        this.sendJson(res, 404, { error: "Session not found" });
        return;
      }
      this.sendJson<SessionRawBufferResponse>(res, 200, raw);
      return;
    }

    if (method === "GET" && suffix === "/buffer/plain") {
      const raw = manager.getRawBuffer(id, this.options.parentSessionId);
      if (!raw) {
        this.sendJson(res, 404, { error: "Session not found" });
        return;
      }
      const plain = stripAnsi(raw.raw);
      this.sendJson<SessionPlainBufferResponse>(res, 200, {
        plain,
        byteLength: Buffer.byteLength(plain, "utf8"),
      });
      return;
    }

    this.sendJson(res, 405, { error: "Method not allowed" });
  }

  private handleWebSocketMessage(ws: WebSocket, data: WebSocket.RawData): void {
    if (typeof data !== "string" && !Buffer.isBuffer(data)) {
      this.sendError(ws, "Binary messages are not supported.");
      return;
    }

    const text = typeof data === "string" ? data : data.toString("utf8");
    let message: WSMessageClient;
    try {
      message = JSON.parse(text) as WSMessageClient;
    } catch {
      this.sendError(ws, "Invalid JSON message.");
      return;
    }

    switch (message.type) {
      case "subscribe":
        this.handleSubscribe(ws, message);
        return;
      case "unsubscribe":
        this.handleUnsubscribe(ws, message);
        return;
      case "session_list":
        this.sendSessionList(ws);
        return;
      case "spawn":
        void this.handleSpawn(ws, message);
        return;
      case "input":
        this.handleInput(ws, message);
        return;
      case "readRaw":
        this.handleReadRaw(ws, message);
        return;
      default:
        this.sendError(ws, `Unknown message type ${(message as { type?: string }).type ?? "unknown"}.`);
    }
  }

  private handleSubscribe(ws: WebSocket, message: WSMessageClientSubscribeSession): void {
    const session = manager.get(message.sessionId, this.options.parentSessionId);
    if (!session) {
      this.sendError(ws, `Session ${message.sessionId} not found.`);
      return;
    }
    this.subscriptions.get(ws)?.add(message.sessionId);
    const response: WSMessageServerSubscribedSession = { type: "subscribed", sessionId: message.sessionId };
    this.send(ws, response);
  }

  private handleUnsubscribe(ws: WebSocket, message: WSMessageClientUnsubscribeSession): void {
    this.subscriptions.get(ws)?.delete(message.sessionId);
    const response: WSMessageServerUnsubscribedSession = { type: "unsubscribed", sessionId: message.sessionId };
    this.send(ws, response);
  }

  private sendSessionList(ws: WebSocket): void {
    const message: WSMessageServerSessionList = {
      type: "session_list",
      sessions: manager.list(this.options.parentSessionId),
    };
    this.send(ws, message);
  }

  private async handleSpawn(ws: WebSocket, message: WSMessageClientSpawnSession): Promise<void> {
    if (!message.command || !message.description) {
      this.sendError(ws, "command and description are required.");
      return;
    }
    try {
      const args = message.args ?? [];
      await checkCommandPermission(message.command, args);
      if (message.workdir) await checkWorkdirPermission(message.workdir);
      const session = manager.spawn({
        command: message.command,
        args,
        description: message.description,
        workdir: message.workdir ?? this.options.defaultWorkdir,
        env: message.env,
        title: message.title,
        notifyOnExit: message.notifyOnExit,
        timeoutSeconds: message.timeoutSeconds,
        parentSessionId: this.options.parentSessionId,
      });
      if (message.subscribe) {
        this.subscriptions.get(ws)?.add(session.id);
        const response: WSMessageServerSubscribedSession = { type: "subscribed", sessionId: session.id };
        this.send(ws, response);
      }
    } catch (error) {
      this.sendError(ws, getErrorMessage(error));
    }
  }

  private handleInput(ws: WebSocket, message: WSMessageClientInput): void {
    const success = manager.write(message.sessionId, this.options.parentSessionId, message.data);
    if (!success) this.sendError(ws, `Session ${message.sessionId} not found.`);
  }

  private handleReadRaw(ws: WebSocket, message: WSMessageClientReadRaw): void {
    const raw = manager.getRawBuffer(message.sessionId, this.options.parentSessionId);
    if (!raw) {
      this.sendError(ws, `Session ${message.sessionId} not found.`);
      return;
    }
    const response: WSMessageServerReadRawResponse = {
      type: "readRawResponse",
      sessionId: message.sessionId,
      rawData: raw.raw,
    };
    this.send(ws, response);
  }

  private send(ws: WebSocket, message: WSMessageServer): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  private broadcast(message: WSMessageServer): void {
    for (const client of this.clients) this.send(client, message);
  }

  private sendError(ws: WebSocket, message: string): void {
    const payload: WSMessageServerError = { type: "error", error: { name: "Error", message } };
    this.send(ws, payload);
  }

  private getRequestUrl(req: IncomingMessage): URL | null {
    try {
      const host = req.headers.host;
      if (!host || !req.url) return null;
      return new URL(req.url, `http://${host}`);
    } catch {
      return null;
    }
  }

  private isAuthorizedApiRequest(req: IncomingMessage, url: URL): boolean {
    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${this.token}`) return true;
    return url.searchParams.get("token") === this.token;
  }

  private isExpectedHost(req: IncomingMessage): boolean {
    return req.headers.host === `${this.host}:${this.actualPort || this.requestedPort}`;
  }

  private isExpectedOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    return origin === this.origin;
  }

  private async readJson<T>(req: IncomingMessage, res: ServerResponse): Promise<T | null> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
    } catch {
      this.sendJson(res, 400, { error: "Invalid JSON body" });
      return null;
    }
  }

  private matchSessionRoute(pathname: string): { id: string; suffix: string } | null {
    const prefix = "/api/sessions/";
    if (!pathname.startsWith(prefix)) return null;
    const rest = pathname.slice(prefix.length);
    if (rest === "") return null;
    const slashIndex = rest.indexOf("/");
    if (slashIndex === -1) return { id: decodeURIComponent(rest), suffix: "" };
    return {
      id: decodeURIComponent(rest.slice(0, slashIndex)),
      suffix: rest.slice(slashIndex),
    };
  }

  private sendJson<T>(res: ServerResponse, status: number, body: T): void {
    const bytes = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self' ws:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'",
      "Content-Length": String(bytes.length),
    });
    res.end(bytes);
  }

  private sendBytes(res: ServerResponse, status: number, body: Buffer, contentType: string): void {
    res.writeHead(status, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self' ws:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'",
      "Content-Length": String(body.length),
    });
    res.end(body);
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
