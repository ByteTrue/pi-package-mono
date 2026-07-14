import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { Agent, type Server, request as httpRequest } from "node:http";
import { createConnection, type AddressInfo, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVendorWebServer, type WebSessionState } from "./server.js";
import { startVendorWebSession, clearActiveSession, createSessionShutdownHandler, getActiveSession } from "./session.js";
import type { ModelsJson } from "../../models-json.js";
import type { ModelsSnapshot } from "../../config-core.js";
import { runWebSession } from "../../command.js";
import registerVendor from "../../index.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const dummySnapshot: ModelsSnapshot = {
	models: { providers: {} },
	revision: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
};

function createState(draft?: ModelsJson): WebSessionState {
	return {
		snapshot: dummySnapshot,
		draft: draft ?? { providers: {} } as ModelsJson,
		secrets: new Map(),
		phase: "open",
		closeAfterResponse: false,
	};
}

function makeTempConfig(models: ModelsJson): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-vendor-test-"));
	const path = join(dir, "models.json");
	writeFileSync(path, JSON.stringify(models, null, 2) + "\n", { mode: 0o600 });
	return path;
}

function fetchOnce(port: number, path: string, opts: RequestInit = {}): Promise<Response> {
	return fetch(`http://127.0.0.1:${port}${path}`, {
		...opts,
		redirect: "manual",
	});
}


function waitForSocketClose(socket: Socket): Promise<void> {
	return new Promise((resolve, reject) => {
		let timeout: ReturnType<typeof setTimeout>;
		const onClose = (): void => {
			clearTimeout(timeout);
			resolve();
		};
		timeout = setTimeout(() => {
			socket.off("close", onClose);
			reject(new Error("Timed out waiting for socket close"));
		}, 1_000);
		socket.once("close", onClose);
	});
}

describe("VendorWebServer HTTP", () => {
	const token = randomBytes(32).toString("base64url");
	let server: Server;
	let port: number;
	let state: WebSessionState;

	beforeEach(async () => {
		state = createState();
		const result = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => () => dummySnapshot,
			handleCancel: () => {},
		});
		server = result.server;
		port = result.port;
	});

	afterEach(() => {
		server.close();
	});

	function headers(extra?: Record<string, string>): Record<string, string> {
		return {
			Authorization: `Bearer ${token}`,
			Host: `127.0.0.1:${port}`,
			Origin: `http://127.0.0.1:${port}`,
			...extra,
		};
	}

	it("returns 401 without token", async () => {
		const res = await fetchOnce(port, "/api/state");
		expect(res.status).toBe(401);
	});

	it("returns 401 with wrong token", async () => {
		const res = await fetchOnce(port, "/api/state", {
			headers: { Authorization: "Bearer wrong" },
		});
		expect(res.status).toBe(401);
	});

	it("returns 403 with wrong Origin", async () => {
		const res = await fetchOnce(port, "/api/state", {
			headers: { ...headers(), Origin: "http://evil.com" },
		});
		expect(res.status).toBe(403);
	});

	it("returns 403 with wrong Host header via raw HTTP", async () => {
		expect(state.phase).toBe("open");

		const evilRes = await new Promise<{ statusCode: number }>((resolve, reject) => {
			const req = httpRequest({
				hostname: "127.0.0.1",
				port,
				path: "/api/state",
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
					Host: "evil.example",
					Origin: `http://127.0.0.1:${port}`,
				},
			}, (res) => {
				res.resume();
				resolve({ statusCode: res.statusCode! });
			});
			req.on("error", reject);
			req.end();
		});
		expect(evilRes.statusCode).toBe(403);

		expect(state.phase).toBe("open");

		const legalRes = await fetchOnce(port, "/api/state", { headers: headers() });
		expect(legalRes.status).toBe(200);
	});

	it("returns 415 with wrong Content-Type for PUT", async () => {
		const res = await fetchOnce(port, "/api/config", {
			method: "PUT",
			headers: { ...headers(), "Content-Type": "text/plain" },
			body: "hello",
		});
		expect(res.status).toBe(415);
	});

	it("rejects oversized body", async () => {
		try {
			const big = "x".repeat(3 * 1024 * 1024);
			await fetchOnce(port, "/api/config", {
				method: "PUT",
				headers: { ...headers(), "Content-Type": "application/json" },
				body: JSON.stringify({ models: {}, expectedRevision: big }),
			});
		} catch {
			// EPIPE from server destroying the connection is acceptable
		}
		expect(state.phase).toBe("open");
	});

	it("returns 200 for GET /api/state", async () => {
		const res = await fetchOnce(port, "/api/state", { headers: headers() });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.draft).toBeDefined();
		expect(body.revision).toBeDefined();
	});

	it("returns 200 for successful PUT /api/config", async () => {
		const res = await fetchOnce(port, "/api/config", {
			method: "PUT",
			headers: { ...headers(), "Content-Type": "application/json" },
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});
		expect(res.status).toBe(200);
	});


	it("keeps malformed and invalid-ref preparation failures recoverable", async () => {
		const recoveryState = createState();
		let commits = 0;
		const recovery = await createVendorWebServer({
			token,
			state: recoveryState,
			handleState: () => ({ draft: recoveryState.draft, revision: recoveryState.snapshot.revision, slots: [] }),
			prepareConfig: (body) => {
				if ((body as { invalidRef?: boolean }).invalidRef) {
					throw Object.assign(new Error("Invalid secret reference"), { code: "invalid_secret_ref" });
				}
				return () => {
					commits++;
					return dummySnapshot;
				};
			},
			handleCancel: () => {},
		});
		const recoveryHeaders = {
			Authorization: `Bearer ${token}`,
			Host: `127.0.0.1:${recovery.port}`,
			Origin: `http://127.0.0.1:${recovery.port}`,
			"Content-Type": "application/json",
		};
		try {
			const malformed = await fetchOnce(recovery.port, "/api/config", { method: "PUT", headers: recoveryHeaders, body: "{" });
			expect(malformed.status).toBe(400);
			expect(recoveryState.phase).toBe("open");

			const invalidRef = await fetchOnce(recovery.port, "/api/config", {
				method: "PUT",
				headers: recoveryHeaders,
				body: JSON.stringify({ invalidRef: true }),
			});
			expect(invalidRef.status).toBe(400);
			expect(recoveryState.phase).toBe("open");
			expect(commits).toBe(0);

			const valid = await fetchOnce(recovery.port, "/api/config", {
				method: "PUT",
				headers: recoveryHeaders,
				body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
			});
			expect(valid.status).toBe(200);
			expect(commits).toBe(1);
		} finally {
			recovery.server.close();
		}
	});

	it("returns 409 when phase is not open", async () => {
		state.phase = "saving";
		const res = await fetchOnce(port, "/api/config", {
			method: "PUT",
			headers: { ...headers(), "Content-Type": "application/json" },
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});
		expect(res.status).toBe(409);
	});

	it("returns 400 for invalid_config with issues", async () => {
		const server2 = await createVendorWebServer({
			token,
			state: createState(),
			handleState: () => ({ draft: {}, revision: dummySnapshot.revision, slots: [] }),
			prepareConfig: () => async () => {
				throw Object.assign(new Error("Invalid config"), {
					code: "invalid_config",
					issues: [{ path: "/providers/p1", code: "bad_provider", message: "Provider p1 is malformed" }],
				});
			},
			handleCancel: () => {},
		});
		const res = await fetchOnce(server2.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server2.port}`,
				Origin: `http://127.0.0.1:${server2.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("invalid_config");
		expect(body.error.issues).toBeDefined();
		expect(body.error.issues[0].code).toBe("bad_provider");
		server2.server.close();
	});

	it("returns 409 for config_changed", async () => {
		const server2 = await createVendorWebServer({
			token,
			state: createState(),
			handleState: () => ({ draft: {}, revision: dummySnapshot.revision, slots: [] }),
			prepareConfig: () => async () => {
				throw Object.assign(new Error("Config changed"), { code: "config_changed" });
			},
			handleCancel: () => {},
		});
		const res = await fetchOnce(server2.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server2.port}`,
				Origin: `http://127.0.0.1:${server2.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error.code).toBe("config_changed");
		expect(server2.port).toBeGreaterThan(0);
		server2.server.close();
	});

	it("returns 204 for successful POST /api/cancel", async () => {
		const res = await fetchOnce(port, "/api/cancel", {
			method: "POST",
			headers: headers(),
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("content-type")).toBeNull();
	});

	it("returns 404 for unknown API route", async () => {
		const res = await fetchOnce(port, "/api/nonexistent", { headers: headers() });
		expect(res.status).toBe(404);
	});

	it("serves static assets with known fixture", async () => {
		const assetDir = mkdtempSync(join(tmpdir(), "pi-vendor-test-assets-"));
		const html = "<!DOCTYPE html><html><head><title>Test</title></head><body>Vendor</body></html>";
		writeFileSync(join(assetDir, "index.html"), html);

		const assetServer = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => () => dummySnapshot,
			handleCancel: () => {},
			assetRoot: assetDir,
		});

		try {
			const assetPort = assetServer.port;

			const res = await fetchOnce(assetPort, "/");
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
			expect(res.headers.get("cache-control")).toBe("no-store");
			expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");

			const unknown = await fetchOnce(assetPort, "/nonexistent");
			expect(unknown.status).toBe(404);

			const traversal = await fetchOnce(assetPort, "/../evil");
			expect(traversal.status).toBe(404);
		} finally {
			assetServer.server.close();
			rmSync(assetDir, { recursive: true });
		}
	});
});

describe("VendorWebServer session lifecycle", () => {
	const token = randomBytes(32).toString("base64url");

	it("cancel-first: cancel wins when save not yet started", async () => {
		let cancelled = false;
		const state = createState();
		const server = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => async () => {
				throw new Error("Should not reach here");
			},
			handleCancel: () => {
				cancelled = true;
			},
		});

		const cancelRes = await fetchOnce(server.port, "/api/cancel", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server.port}`,
				Origin: `http://127.0.0.1:${server.port}`,
			},
		});
		expect(cancelRes.status).toBe(204);
		expect(cancelled).toBe(true);
		expect(state.phase).toBe("cancelled");

		const saveRes = await fetchOnce(server.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server.port}`,
				Origin: `http://127.0.0.1:${server.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});
		expect(saveRes.status).toBe(409);

		server.server.close();
	});

	it("save-first: cancel during save does not settle cancelled", async () => {
		let saved = false;
		let cancelled = false;
		const state = createState();
		let resolveSave: (() => void) | undefined;

		const server = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => async () => {
				await new Promise<void>((resolve) => {
					resolveSave = resolve;
				});
				return dummySnapshot;
			},
			handleCancel: () => {
				cancelled = true;
			},
			onSaved: () => {
				saved = true;
			},
		});

		const savePromise = fetchOnce(server.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server.port}`,
				Origin: `http://127.0.0.1:${server.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});

		await new Promise((r) => setTimeout(r, 50));

		const cancelRes = await fetchOnce(server.port, "/api/cancel", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server.port}`,
				Origin: `http://127.0.0.1:${server.port}`,
			},
		});
		expect(cancelRes.status).toBe(204);
		expect(cancelled).toBe(false);
		expect(state.closeAfterResponse).toBe(true);

		resolveSave!();
		const saveRes = await savePromise;
		expect(saveRes.status).toBe(200);
		expect(saved).toBe(true);
		expect(cancelled).toBe(true);

		server.server.close();
	});

	it("response-before-close: server stays open until response completes", async () => {
		const state = createState();
		let resolveSave: (() => void) | undefined;

		const server = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => async () => {
				await new Promise<void>((resolve) => {
					resolveSave = resolve;
				});
				return dummySnapshot;
			},
			handleCancel: () => {},
		});

		const savePromise = fetchOnce(server.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server.port}`,
				Origin: `http://127.0.0.1:${server.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});

		await new Promise((r) => setTimeout(r, 50));
		expect(server.server.listening).toBe(true);

		resolveSave!();
		const saveRes = await savePromise;
		expect(saveRes.status).toBe(200);

		server.server.close();
	});

	it("stop() during open phase settles cancelled", () => {
		const state = createState();
		let settled = false;

		const stop = (): void => {
			if (state.phase === "open") {
				state.phase = "cancelled";
				settled = true;
			}
		};

		stop();
		expect(state.phase).toBe("cancelled");
		expect(settled).toBe(true);
	});

	it("stop() during saving phase does not settle", () => {
		const state = createState();
		state.phase = "saving";
		let settled = false;

		const stop = (): void => {
			if (state.phase === "open") {
				state.phase = "cancelled";
				settled = true;
			} else if (state.phase === "saving") {
				state.closeAfterResponse = true;
				return;
			}
		};

		stop();
		expect(state.phase).toBe("saving");
		expect(settled).toBe(false);
		expect(state.closeAfterResponse).toBe(true);
	});

	it("finish event fires before onSaved: onSaved not called while handleConfig is deferred", async () => {
		// Falsifiability: if onSaved was called synchronously before res.end(),
		// this deferred-handleConfig test would show onSaved called before the
		// response body is sent. By deferring handleConfig, we prove onSaved
		// fires in the finish event (after res.end), not before.
		const state = createState();
		let savedSnapshot: ModelsSnapshot | undefined;
		let onSavedCalled = false;
		let resolveConfig: (() => void) | undefined;
		const timeline: string[] = [];

		const server2 = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => async () => {
				await new Promise<void>((r) => { resolveConfig = r; });
				return dummySnapshot;
			},
			handleCancel: () => {},
			onTerminalResponse: (event) => timeline.push(event),
			onSaved: (snapshot) => {
				savedSnapshot = snapshot;
				onSavedCalled = true;
				timeline.push("saved");
			},
		});

		const savePromise = fetchOnce(server2.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server2.port}`,
				Origin: `http://127.0.0.1:${server2.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});

		await new Promise((r) => setTimeout(r, 50));

		// Before handleConfig resolves, onSaved must NOT have been called
		expect(onSavedCalled).toBe(false);

		resolveConfig!();
		const res = await savePromise;

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.revision).toBeDefined();
		expect(onSavedCalled).toBe(true);
		expect(timeline).toEqual(["finish", "saved"]);
		expect(savedSnapshot!.revision).toBe(body.revision);

		server2.server.close();
	});

	it("onSaved fires after response: client receives complete body regardless of onSaved timing", async () => {
		// Falsifiability: if onSaved was called BEFORE res.end(), a blocking
		// onSaved would delay the response. We prove finish-event ordering by
		// observing that the response arrives even when onSaved is called.
		const state = createState();
		let savedSnapshot: ModelsSnapshot | undefined;

		const server2 = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => () => dummySnapshot,
			handleCancel: () => {},
			onSaved: (snapshot) => { savedSnapshot = snapshot; },
		});

		const res = await fetchOnce(server2.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server2.port}`,
				Origin: `http://127.0.0.1:${server2.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});

		expect(res.status).toBe(200);
		const body = await res.json();

		// Both response body and onSaved should be available
		expect(savedSnapshot).toBeDefined();
		expect(savedSnapshot!.revision).toBe(body.revision);

		server2.server.close();
	});
});

describe("Typed ConfigCoreError → HTTP mapping", () => {
	const token = randomBytes(32).toString("base64url");

	it("maps invalid_request to 400", async () => {
		const state = createState();
		const server = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => async () => {
				throw Object.assign(new Error("Missing models"), { code: "invalid_request" });
			},
			handleCancel: () => {},
		});

		const res = await fetchOnce(server.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server.port}`,
				Origin: `http://127.0.0.1:${server.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("invalid_request");
		expect(state.phase).toBe("open");
		server.server.close();
	});

	it("maps invalid_revision to 400", async () => {
		const state = createState();
		const server = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => async () => {
				throw Object.assign(new Error("Invalid revision"), { code: "invalid_revision" });
			},
			handleCancel: () => {},
		});

		const res = await fetchOnce(server.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server.port}`,
				Origin: `http://127.0.0.1:${server.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("invalid_revision");
		expect(state.phase).toBe("open");
		server.server.close();
	});

	it("maps validator_unavailable to 502", async () => {
		const state = createState();
		const server = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => async () => {
				throw Object.assign(new Error("Validator unavailable"), { code: "validator_unavailable" });
			},
			handleCancel: () => {},
		});

		const res = await fetchOnce(server.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server.port}`,
				Origin: `http://127.0.0.1:${server.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});
		expect(res.status).toBe(502);
		const body = await res.json();
		expect(body.error.code).toBe("validator_unavailable");
		expect(state.phase).toBe("open");
		server.server.close();
	});

	it("maps read_failed to 500", async () => {
		const state = createState();
		const server = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => async () => {
				throw Object.assign(new Error("Read failed"), { code: "read_failed" });
			},
			handleCancel: () => {},
		});

		const res = await fetchOnce(server.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server.port}`,
				Origin: `http://127.0.0.1:${server.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error.code).toBe("read_failed");
		expect(state.phase).toBe("open");
		server.server.close();
	});

	it("maps write_failed to 500", async () => {
		const state = createState();
		const server = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => async () => {
				throw Object.assign(new Error("Write failed"), { code: "write_failed" });
			},
			handleCancel: () => {},
		});

		const res = await fetchOnce(server.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server.port}`,
				Origin: `http://127.0.0.1:${server.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error.code).toBe("write_failed");
		expect(state.phase).toBe("open");
		server.server.close();
	});
});

describe("Socket tracking and cleanup", () => {
	const token = randomBytes(32).toString("base64url");

	it("server close destroys tracked sockets", async () => {
		const state = createState();
		const server = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => () => dummySnapshot,
			handleCancel: () => {},
		});

		const res = await fetchOnce(server.port, "/api/state", {
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server.port}`,
				Origin: `http://127.0.0.1:${server.port}`,
			},
		});
		expect(res.status).toBe(200);
		await res.text();

		await new Promise<void>((resolve) => {
			server.server.close(() => resolve());
		});
	});

	it("server still listening during save", async () => {
		const state = createState();
		let resolveSave: (() => void) | undefined;
		const server = await createVendorWebServer({
			token,
			state,
			handleState: () => ({ draft: state.draft, revision: state.snapshot.revision, slots: [] }),
			prepareConfig: () => async () => {
				await new Promise<void>((resolve) => { resolveSave = resolve; });
				return dummySnapshot;
			},
			handleCancel: () => {},
		});

		const savePromise = fetchOnce(server.port, "/api/config", {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${token}`,
				Host: `127.0.0.1:${server.port}`,
				Origin: `http://127.0.0.1:${server.port}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ models: { providers: {} }, expectedRevision: dummySnapshot.revision }),
		});

		await new Promise((r) => setTimeout(r, 50));
		expect(server.server.listening).toBe(true);

		resolveSave!();
		const saveRes = await savePromise;
		expect(saveRes.status).toBe(200);

		server.server.close();
	});
});

describe("startVendorWebSession concurrent claim", () => {
	it("rejects second concurrent start (sequential verification)", async () => {
		const tempPath = makeTempConfig({ providers: {} });
		try {
			const session1 = await startVendorWebSession({ modelsPath: tempPath, openBrowser: async () => true });
			try {
				await expect(
					startVendorWebSession({ modelsPath: tempPath, openBrowser: async () => true }),
				).rejects.toThrow(/already active/);
			} finally {
				session1.stop();
				await session1.waitForResult();
			}
		} finally {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});

	it("allows new session after first completes (via HTTP cancel)", async () => {
		const tempPath = makeTempConfig({ providers: {} });
		try {
			const session1 = await startVendorWebSession({ modelsPath: tempPath, openBrowser: async () => true });
			const port = new URL(session1.url).port;
			const token = session1.url.split("#")[1]!;
			await fetchOnce(Number(port), "/api/cancel", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					Host: `127.0.0.1:${port}`,
					Origin: `http://127.0.0.1:${port}`,
				},
			});
			const r1 = await session1.waitForResult();
			expect(r1.kind).toBe("cancelled");

			const session2 = await startVendorWebSession({ modelsPath: tempPath, openBrowser: async () => true });
			session2.stop();
			await session2.waitForResult();
		} finally {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});

	it("allows new session after first is stopped", async () => {
		const tempPath = makeTempConfig({ providers: {} });
		try {
			const session1 = await startVendorWebSession({ modelsPath: tempPath, openBrowser: async () => true });
			session1.stop();
			await session1.waitForResult();

			const session2 = await startVendorWebSession({ modelsPath: tempPath, openBrowser: async () => true });
			session2.stop();
			await session2.waitForResult();
		} finally {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});

	it("truly concurrent: Promise.all proves claim wins", async () => {
		const tempPath1 = makeTempConfig({ providers: { p1: {} } });
		const tempPath2 = makeTempConfig({ providers: { p2: {} } });
		try {
			const results = await Promise.allSettled([
				startVendorWebSession({ modelsPath: tempPath1, openBrowser: async () => true }),
				startVendorWebSession({ modelsPath: tempPath2, openBrowser: async () => true }),
			]);

			const succeeded = results.filter((r) => r.status === "fulfilled");
			const failed = results.filter((r) => r.status === "rejected");

			expect(succeeded.length).toBe(1);
			expect(failed.length).toBe(1);

			const err = (failed[0] as PromiseRejectedResult).reason as Error;
			expect(err.message).toContain("already active");

			const session = (succeeded[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof startVendorWebSession>>>).value;
			session.stop();
			await session.waitForResult();
		} finally {
			if (existsSync(tempPath1)) unlinkSync(tempPath1);
			if (existsSync(tempPath2)) unlinkSync(tempPath2);
		}
	});

	it("cleans a listening startup failure before rejection and permits a later start", async () => {
		const tempPath = makeTempConfig({ providers: {} });
		let startupServer: Server | undefined;
		let startupSocket: Socket | undefined;
		let startupSocketClosed: Promise<void> | undefined;
		let startupConnections = 0;
		try {
			await expect(startVendorWebSession({
				modelsPath: tempPath,
				openBrowser: async () => true,
				listen: (server) => {
					startupServer = server;
					server.listen(0, "127.0.0.1", () => {
						const port = (server.address() as AddressInfo).port;
						server.once("connection", () => {
							server.getConnections((_error, count) => {
								startupConnections = count;
								server.emit("error", new Error("forced startup failure"));
							});
						});
						startupSocket = createConnection(port, "127.0.0.1");
						startupSocketClosed = waitForSocketClose(startupSocket);
						startupSocket.on("error", () => {});
					});
				},
			})).rejects.toThrow("forced startup failure");

			await startupSocketClosed;

			expect(startupConnections).toBeGreaterThan(0);
			expect(startupSocket?.destroyed).toBe(true);
			expect(startupServer?.listening).toBe(false);
			expect(await new Promise<number>((resolve) => startupServer!.getConnections((_error, count) => resolve(count)))).toBe(0);
			expect(getActiveSession()).toBeNull();

			const later = await startVendorWebSession({ modelsPath: tempPath, openBrowser: async () => true });
			later.stop();
			await later.waitForResult();
		} finally {
			startupSocket?.destroy();
			startupServer?.close();
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});
});

describe("startVendorWebSession injected opener", () => {
	it("calls injected openBrowser and reports browserOpened true", async () => {
		let openedUrl = "";
		const tempPath = makeTempConfig({ providers: {} });
		try {
			const session = await startVendorWebSession({
				modelsPath: tempPath,
				openBrowser: async (url: string) => {
					openedUrl = url;
					return true;
				},
			});
			expect(session.browserOpened).toBe(true);
			expect(openedUrl).toContain("127.0.0.1");
			expect(openedUrl).toContain("#");
			session.stop();
			await session.waitForResult();
		} finally {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});

	it("reports browserOpened false when opener fails", async () => {
		const tempPath = makeTempConfig({ providers: {} });
		try {
			const session = await startVendorWebSession({
				modelsPath: tempPath,
				openBrowser: async () => false,
			});
			expect(session.browserOpened).toBe(false);
			expect(session.url).toContain("127.0.0.1");
			session.stop();
			await session.waitForResult();
		} finally {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});

	it("still returns usable session when opener throws", async () => {
		const tempPath = makeTempConfig({ providers: {} });
		try {
			const session = await startVendorWebSession({
				modelsPath: tempPath,
				openBrowser: async () => {
					throw new Error("open failed");
				},
			});
			expect(session.browserOpened).toBe(false);
			expect(session.url).toContain("127.0.0.1");
			session.stop();
			await session.waitForResult();
		} finally {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});
});

describe("Command-level: Esc and session shutdown", () => {
	let capturedShutdownHandler: ((event?: { reason?: string }) => void) | undefined;

	beforeAll(async () => {
		const mockPi = {
			on: (event: string, handler: (event?: { reason?: string }) => void) => {
				if (event === "session_shutdown") capturedShutdownHandler = handler;
			},
			registerCommand: () => {},
		} as unknown as ExtensionAPI;
		await registerVendor(mockPi);
		expect(capturedShutdownHandler).toBeDefined();
	});
	it("runWebSession: Esc via ctx.ui.custom triggers cancel and resolves cancelled", async () => {
		// Falsifiability: exercises the actual runWebSession command handler path
		// with ctx.ui.custom, not just session.stop() directly. If runWebSession
		// doesn't wire tui.select.cancel → session.stop() → doneFn(null) →
		// resolve({ kind: "cancelled" }), this test fails.
		const tempPath = makeTempConfig({ providers: {} });
		try {
			let escHandler: ((key: string) => void) | undefined;
			let doneResolve: ((val: unknown) => void) | undefined;
			const notifyMessages: string[] = [];

			const mockCtx = {
				ui: {
					notify: (msg: string, _level: string) => { notifyMessages.push(msg); },
					custom: (
						renderFn: unknown,
						_opts?: unknown,
					): Promise<unknown> => {
						const fn = renderFn as (
							_tui: unknown,
							_theme: unknown,
							keybindings: { matches: (key: string, binding: string) => boolean },
							done: (val: unknown) => void,
						) => { handleInput: (key: string) => void };

						const component = fn(
							null,
							null,
							{
								matches: (key: string, binding: string) =>
									binding === "tui.select.cancel" && key === "tui.select.cancel",
							},
							(val: unknown) => { doneResolve!(val); },
						);

						escHandler = component.handleInput;

						return new Promise((resolve) => {
							doneResolve = resolve;
						});
					},
				},
				modelRegistry: {
					refresh: () => {},
					getError: () => undefined,
				},
			};

			const runPromise = runWebSession(mockCtx as any, { modelsPath: tempPath, openBrowser: async () => true });

			// Give time for session to start and custom UI to register
			await new Promise((r) => setTimeout(r, 100));

			// Simulate user pressing Esc
			expect(escHandler).toBeDefined();
			escHandler!("tui.select.cancel");

			await runPromise;

			expect(notifyMessages).toContain("Session cancelled. Configuration unchanged.");
		} finally {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});

	it("session_shutdown handler calls active session stop", async () => {
		const tempPath = makeTempConfig({ providers: {} });
		try {
			const session = await startVendorWebSession({ modelsPath: tempPath, openBrowser: async () => true });
			expect(getActiveSession()).toBe(session);

			const handler = createSessionShutdownHandler();
			handler();

			const result = await session.waitForResult();
			expect(result.kind).toBe("cancelled");
			expect(getActiveSession()).toBeNull();
		} finally {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});


	it("session_shutdown during save does not corrupt write", async () => {
		const tempPath = makeTempConfig({ providers: {} });
		try {
			const session = await startVendorWebSession({ modelsPath: tempPath, openBrowser: async () => true });
			const port = new URL(session.url).port;
			const token = session.url.split("#")[1]!;

			// Get actual revision from state endpoint
			const stateRes = await fetchOnce(Number(port), "/api/state", {
				headers: {
					Authorization: `Bearer ${token}`,
					Host: `127.0.0.1:${port}`,
					Origin: `http://127.0.0.1:${port}`,
				},
			});
			const stateBody = await stateRes.json() as { revision: string };
			const actualRevision = stateBody.revision;

			const saveRes = await fetchOnce(Number(port), "/api/config", {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
					Host: `127.0.0.1:${port}`,
					Origin: `http://127.0.0.1:${port}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ models: { providers: {} }, expectedRevision: actualRevision }),
			});

			expect(saveRes.status).toBe(200);
			await saveRes.text();

			capturedShutdownHandler!({ reason: "quit" });

			const result = await session.waitForResult();
			expect(result.kind).toBe("saved");
			expect(getActiveSession()).toBeNull();
		} finally {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});

	const shutdownReasons = ["quit", "reload", "new", "resume", "fork"] as const;
	for (const reason of shutdownReasons) {
		it(`session_shutdown reason "${reason}" stops session cleanly`, async () => {
			const tempPath = makeTempConfig({ providers: {} });
			try {
				const session = await startVendorWebSession({ modelsPath: tempPath, openBrowser: async () => true });
				expect(getActiveSession()).toBe(session);

				capturedShutdownHandler!({ reason });

				const result = await session.waitForResult();
				expect(result.kind).toBe("cancelled");
				expect(getActiveSession()).toBeNull();
			} finally {
				if (existsSync(tempPath)) unlinkSync(tempPath);
			}
		});
	}

	it("registered shutdown handler is safe when no active session", () => {
		expect(getActiveSession()).toBeNull();
		expect(() => capturedShutdownHandler!({ reason: "quit" })).not.toThrow();
	});

	it("clearActiveSession is identity-aware", async () => {
		const tempPath = makeTempConfig({ providers: {} });
		try {
			const session1 = await startVendorWebSession({ modelsPath: tempPath, openBrowser: async () => true });
			expect(getActiveSession()).toBe(session1);

			const fakeSession = { url: "", browserOpened: false, stop() {}, waitForResult: async () => ({ kind: "cancelled" as const }) };

			clearActiveSession(fakeSession);
			expect(getActiveSession()).toBe(session1);

			clearActiveSession(session1);
			expect(getActiveSession()).toBeNull();
		} finally {
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});
});

describe("Keep-alive / active socket cleanup", () => {
	it("stop() closes a real keep-alive socket and an incomplete raw request server-side", async () => {
		const tempPath = makeTempConfig({ providers: {} });
		const agent = new Agent({ keepAlive: true });
		let server: Server | undefined;
		let keepAliveSocket: Socket | undefined;
		let partialSocket: Socket | undefined;
		try {
			const session = await startVendorWebSession({
				modelsPath: tempPath,
				openBrowser: async () => true,
				listen: (target, ready) => {
					server = target;
					target.listen(0, "127.0.0.1", ready);
				},
			});
			const port = Number(new URL(session.url).port);
			const token = session.url.split("#")[1]!;

			await new Promise<void>((resolve, reject) => {
				const req = httpRequest({
					host: "127.0.0.1",
					port,
					path: "/api/state",
					agent,
					headers: { Authorization: `Bearer ${token}`, Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` },
				}, (res) => {
					res.resume();
					res.on("end", resolve);
				});
				req.on("socket", (socket) => { keepAliveSocket = socket; });
				req.on("error", reject);
				req.end();
			});

			partialSocket = createConnection(port, "127.0.0.1");
			await new Promise<void>((resolve, reject) => {
				partialSocket!.once("connect", resolve);
				partialSocket!.once("error", reject);
			});
			partialSocket.write(`GET /api/state HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n`);
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(await new Promise<number>((resolve) => server!.getConnections((_error, count) => resolve(count)))).toBe(2);

			session.stop();
			expect((await session.waitForResult()).kind).toBe("cancelled");
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(server!.listening).toBe(false);
			expect(await new Promise<number>((resolve) => server!.getConnections((_error, count) => resolve(count)))).toBe(0);
			expect(keepAliveSocket!.destroyed).toBe(true);
			expect(partialSocket.destroyed).toBe(true);
		} finally {
			agent.destroy();
			partialSocket?.destroy();
			server?.close();
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});

	it("stop() cancels an incomplete authenticated PUT before it can claim save", async () => {
		const tempPath = makeTempConfig({ providers: {} });
		let server: Server | undefined;
		let saveSocket: Socket | undefined;
		try {
			const session = await startVendorWebSession({
				modelsPath: tempPath,
				openBrowser: async () => true,
				listen: (target, ready) => {
					server = target;
					target.listen(0, "127.0.0.1", ready);
				},
			});
			const port = Number(new URL(session.url).port);
			const token = session.url.split("#")[1]!;
			const stateRes = await fetchOnce(port, "/api/state", {
				headers: { Authorization: `Bearer ${token}`, Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` },
			});
			const stateBody = await stateRes.json() as { revision: string };
			const body = JSON.stringify({ models: { providers: { written: {} } }, expectedRevision: stateBody.revision });
			saveSocket = createConnection(port, "127.0.0.1", () => {
				saveSocket!.write([
					"PUT /api/config HTTP/1.1",
					`Host: 127.0.0.1:${port}`,
					`Origin: http://127.0.0.1:${port}`,
					`Authorization: Bearer ${token}`,
					"Content-Type: application/json",
					`Content-Length: ${Buffer.byteLength(body)}`,
					"Connection: close",
					"",
					body.slice(0, 1),
				].join("\r\n"));
			});
			await new Promise<void>((resolve, reject) => {
				saveSocket!.once("connect", resolve);
				saveSocket!.once("error", reject);
			});
			await new Promise((resolve) => setTimeout(resolve, 20));
			const saveSocketClosed = waitForSocketClose(saveSocket);

			session.stop();
			expect((await session.waitForResult()).kind).toBe("cancelled");
			await saveSocketClosed;
			expect(server!.listening).toBe(false);
			expect(saveSocket.destroyed).toBe(true);
			expect(JSON.parse(readFileSync(tempPath, "utf8"))).toEqual({ providers: {} });
		} finally {
			saveSocket?.destroy();
			server?.close();
			if (existsSync(tempPath)) unlinkSync(tempPath);
		}
	});
});
