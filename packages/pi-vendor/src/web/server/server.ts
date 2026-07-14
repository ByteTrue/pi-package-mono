import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { ModelsSnapshot } from "../../config-core.js";
import type { WebModelsDraft, SecretRef, StoredSecretSlot } from "./mask.js";
import { getAsset } from "./assets.js";

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export type WebSessionPhase = "open" | "saving" | "saved" | "cancelled" | "closed";

export type WebSessionState = {
	snapshot: ModelsSnapshot;
	draft: WebModelsDraft;
	secrets: Map<SecretRef, StoredSecretSlot>;
	phase: WebSessionPhase;
	closeAfterResponse: boolean;
};

export type VendorWebResult =
	| { kind: "saved"; snapshot: ModelsSnapshot }
	| { kind: "cancelled" };

export type VendorWebSession = {
	url: string;
	browserOpened: boolean;
	waitForResult(): Promise<VendorWebResult>;
	stop(): void;
};

function sendJSON(res: ServerResponse, code: number, body: unknown): void {
	const data = JSON.stringify(body);
	res.writeHead(code, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": String(Buffer.byteLength(data)),
		"Cache-Control": "no-store",
		"Content-Security-Policy": CSP,
	});
	res.end(data);
}

function observeTerminalResponse(
	res: ServerResponse,
	onObserved: ((event: "finish" | "close") => void) | undefined,
	callback: () => void,
): void {
	let observed = false;
	const finish = (event: "finish" | "close"): void => {
		if (observed) return;
		observed = true;
		res.off("finish", onFinish);
		res.off("close", onClose);
		onObserved?.(event);
		callback();
	};
	const onFinish = (): void => finish("finish");
	const onClose = (): void => finish("close");
	res.once("finish", onFinish);
	res.once("close", onClose);
}

function sendError(res: ServerResponse, code: number, errorCode: string, message: string, details?: Record<string, unknown>): void {
	const payload: Record<string, unknown> = { error: { code: errorCode, message } };
	if (details) payload.error = { ...payload.error as Record<string, unknown>, ...details };
	sendJSON(res, code, payload);
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let total = 0;
		req.on("data", (chunk: Buffer) => {
			total += chunk.length;
			if (total > maxBytes) {
				req.destroy();
				reject(new Error("request entity too large"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			resolve(Buffer.concat(chunks).toString("utf8"));
		});
		req.on("error", reject);
	});
}

function checkAuth(req: IncomingMessage, token: string): boolean {
	const auth = req.headers.authorization;
	return auth === `Bearer ${token}`;
}

function checkOrigin(req: IncomingMessage, expectedOrigin: string, method: string): boolean {
	const origin = req.headers.origin;
	if (method === "GET") {
		// GET: if Origin present, must be exact; absent is ok (same-origin browser omits Origin on GET)
		return origin === undefined || origin === expectedOrigin;
	}
	// PUT/POST: exact Origin required
	return origin === expectedOrigin;
}

function checkHost(req: IncomingMessage, expectedHost: string): boolean {
	return req.headers.host === expectedHost;
}

export type CatalogEntry = { provider: string; modelId: string; model: Record<string, unknown> };
export type EnrichResult = { kind: string; modelId?: string; candidates?: CatalogEntry[]; model?: Record<string, unknown>; source?: string; warning?: string };
export type DiscoverResult = { ids: string[] };

export type VendorWebListen = (server: Server, onListening: () => void) => void;
export type PreparedConfigCommit = () => ModelsSnapshot | Promise<ModelsSnapshot>;

export type CreateVendorWebServerOptions = {
	token: string;
	state: WebSessionState;
	handleState: () => Record<string, unknown>;
	prepareConfig: (body: unknown) => PreparedConfigCommit;
	handleCancel: () => void;
	handleCatalog?: (query: string, limit: number) => Promise<CatalogEntry[]>;
	handleEnrich?: (body: { modelId: string }) => Promise<EnrichResult>;
	handleDiscover?: (body: { providerKey: string; provider: Record<string, unknown> }) => Promise<DiscoverResult>;
	onSaved?: (snapshot: ModelsSnapshot) => void;
	onTerminalResponse?: (event: "finish" | "close") => void;
	assetRoot?: string;
	listen?: VendorWebListen;
};

export type VendorWebServerResult = {
	server: Server;
	port: number;
	sockets: Set<Socket>;
	destroySockets: () => void;
};

export function createVendorWebServer(options: CreateVendorWebServerOptions): Promise<VendorWebServerResult> {
	const { token, state, handleState, prepareConfig, handleCancel } = options;

	return new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			// All API routes require auth
			const url = new URL(req.url ?? "/", `http://localhost`);
			const isApi = url.pathname.startsWith("/api/");

			// Origin check for API routes
			const origin = `http://127.0.0.1:${(server.address() as AddressInfo)?.port ?? 0}`;
			if (isApi && !checkOrigin(req, origin, req.method ?? "GET")) {
				sendError(res, 403, "unauthorized", "Invalid origin");
				return;
			}

			// Host check
			if (isApi && !checkHost(req, origin.replace("http://", ""))) {
				sendError(res, 403, "unauthorized", "Invalid host");
				return;
			}

			// Auth check
			if (isApi && !checkAuth(req, token)) {
				sendError(res, 401, "unauthorized", "Missing or invalid token");
				return;
			}

			// Method check — skip Content-Type for cancel which has no body
			if ((req.method === "PUT" || req.method === "POST") && url.pathname !== "/api/cancel") {
				const ct = req.headers["content-type"];
				if (ct !== "application/json") {
					sendError(res, 415, "invalid_request", "Content-Type must be application/json");
					return;
				}
			}

			// Route: GET /api/state
			if (req.method === "GET" && url.pathname === "/api/state") {
				try {
					const data = handleState();
					sendJSON(res, 200, data);
				} catch (err) {
					sendError(res, 500, "read_failed", "Unable to read configuration");
				}
				return;
			}

		// Route: PUT /api/config
		if (req.method === "PUT" && url.pathname === "/api/config") {
			if (state.phase !== "open") {
				sendError(res, 409, "session_busy", "Session is not accepting writes");
				return;
			}
			readBody(req, 2 * 1024 * 1024)
				.then((raw) => {
					let body: unknown;
					try {
						body = JSON.parse(raw);
					} catch {
						sendError(res, 400, "invalid_request", "Invalid JSON body");
						return;
					}
					if (state.phase !== "open") {
						sendError(res, 409, "session_busy", "Session is not accepting writes");
						return;
					}
					const commit = prepareConfig(body);
					if (state.phase !== "open") {
						sendError(res, 409, "session_busy", "Session is not accepting writes");
						return;
					}
					state.phase = "saving";
					return Promise.resolve(commit()).then((snapshot) => {
						state.phase = "saved";
						observeTerminalResponse(res, options.onTerminalResponse, () => {
							options.onSaved?.(snapshot);
							if (state.closeAfterResponse) handleCancel();
						});
						sendJSON(res, 200, { revision: snapshot.revision });
					});
				})
				.catch((err: unknown) => {
					if (state.phase === "saving") state.phase = "open";
					const code = (err as { code?: string })?.code;
					if (code === "invalid_request") {
						sendError(res, 400, "invalid_request", (err as Error).message);
					} else if (code === "config_changed") {
						sendError(res, 409, "config_changed", "Configuration changed before save");
					} else if (code === "invalid_secret_ref") {
						sendError(res, 400, "invalid_secret_ref", (err as Error).message);
					} else if (code === "invalid_config") {
						const issues = (err as { issues?: unknown[] })?.issues;
						sendError(res, 400, "invalid_config", (err as Error).message, issues ? { issues } : undefined);
					} else if (code === "invalid_revision") {
						sendError(res, 400, "invalid_revision", (err as Error).message);
					} else if (code === "validator_unavailable") {
						sendError(res, 502, "validator_unavailable", (err as Error).message);
					} else if (code === "read_failed") {
						sendError(res, 500, "read_failed", "Unable to read configuration");
					} else {
						sendError(res, 500, "write_failed", "Unable to write configuration");
					}
				});
			return;
			}

		// Route: POST /api/cancel
		if (req.method === "POST" && url.pathname === "/api/cancel") {
			if (state.phase === "open") {
				state.phase = "cancelled";
				observeTerminalResponse(res, options.onTerminalResponse, handleCancel);
				res.writeHead(204, { "Cache-Control": "no-store", "Content-Security-Policy": CSP });
				res.end();
			} else if (state.phase === "saving") {
				// First-terminal-action-wins: save already claimed, don't settle cancelled
				state.closeAfterResponse = true;
				res.writeHead(204, { "Cache-Control": "no-store", "Content-Security-Policy": CSP });
				res.end();
				// Don't call handleCancel — save is in progress
			} else {
				sendError(res, 409, "session_busy", "Session is already terminal");
			}
			return;
		}

			// Route: GET /api/catalog?q={query}&limit={n}
			if (req.method === "GET" && url.pathname === "/api/catalog" && options.handleCatalog) {
				const q = url.searchParams.get("q") ?? "";
				const limitStr = url.searchParams.get("limit");
				const limit = limitStr ? parseInt(limitStr, 10) : undefined;

				if (!q || (limitStr && (isNaN(limit as number) || (limit as number) < 1 || (limit as number) > 100))) {
					sendError(res, 400, "invalid_request", "Invalid query or limit");
					return;
				}

				options.handleCatalog(q, limit ?? 50)
					.then((entries) => sendJSON(res, 200, { entries }))
					.catch((err: unknown) => {
						const code = (err as { code?: string })?.code;
						if (code === "invalid_request") sendError(res, 400, "invalid_request", (err as Error).message);
						else sendError(res, 500, "catalog_unavailable", "Catalog unavailable");
					});
				return;
			}

			// Route: POST /api/enrich
			if (req.method === "POST" && url.pathname === "/api/enrich" && options.handleEnrich) {
				readBody(req, 2 * 1024 * 1024)
					.then((raw) => {
						let body: { modelId?: string };
						try { body = JSON.parse(raw); } catch {
							sendError(res, 400, "invalid_request", "Invalid JSON body");
							return;
						}
						if (!body.modelId || typeof body.modelId !== "string") {
							sendError(res, 400, "invalid_request", "Missing modelId");
							return;
						}
						return options.handleEnrich!({ modelId: body.modelId })
							.then((result) => sendJSON(res, 200, result));
					})
					.catch(() => sendError(res, 500, "catalog_unavailable", "Enrichment failed"));
				return;
			}

			// Route: POST /api/discover
			if (req.method === "POST" && url.pathname === "/api/discover" && options.handleDiscover) {
				readBody(req, 2 * 1024 * 1024)
					.then((raw) => {
						let body: { providerKey?: string; provider?: Record<string, unknown> };
						try { body = JSON.parse(raw); } catch {
							sendError(res, 400, "invalid_request", "Invalid JSON body");
							return;
						}
						if (!body.providerKey || !body.provider) {
							sendError(res, 400, "invalid_request", "Missing providerKey or provider");
							return;
						}
						return options.handleDiscover!(body as { providerKey: string; provider: Record<string, unknown> })
							.then((result) => sendJSON(res, 200, result))
							.catch((err: unknown) => {
								const code = (err as { code?: string })?.code;
								if (code === "invalid_request") sendError(res, 400, "invalid_request", (err as Error).message);
								else if (code === "credential_unresolved") sendError(res, 400, "credential_unresolved", (err as Error).message);
								else if (code === "upstream_timeout") sendError(res, 408, "upstream_timeout", (err as Error).message);
								else if (code === "upstream_too_large") sendError(res, 413, "upstream_too_large", (err as Error).message);
								else sendError(res, 502, "upstream_failed", (err as Error).message);
							});
					})
					.catch(() => sendError(res, 502, "upstream_failed", "Discovery failed"));
				return;
			}

			// 404 for unknown API routes
			if (isApi) {
				sendError(res, 404, "invalid_request", "Not found");
				return;
			}

			// Serve static assets for non-API routes
			const pathname = req.url === "/" ? "/" : (req.url ?? "/");
		const asset = getAsset(pathname, options.assetRoot);
			if (asset) {
				res.writeHead(200, {
					"Content-Type": asset.contentType,
					"Cache-Control": "no-store",
					"Content-Security-Policy": CSP,
				});
				res.end(asset.body);
				return;
			}

			sendError(res, 404, "invalid_request", "Not found");
		});

		// Track active sockets immediately after server creation,
		// before any async operations — so cancellation can destroy them
		const sockets = new Set<Socket>();
		const destroySockets = (): void => {
			for (const sock of sockets) sock.destroy();
			sockets.clear();
		};
		server.on("connection", (socket) => {
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));
		});

		let startupDone = false;
		const failStartup = (error: Error): void => {
			if (startupDone) return;
			startupDone = true;
			destroySockets();
			server.close(() => reject(error));
		};
		server.on("error", failStartup);

		const onListening = (): void => {
			if (startupDone) return;
			startupDone = true;
			const addr = server.address() as AddressInfo;
			resolve({ server, port: addr.port, sockets, destroySockets });
		};
		try {
			(options.listen ?? ((target, ready) => target.listen(0, "127.0.0.1", ready)))(server, onListening);
		} catch (error) {
			failStartup(error instanceof Error ? error : new Error(String(error)));
		}
	});
}
