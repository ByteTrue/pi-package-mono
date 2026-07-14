import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createVendorWebServer, type VendorWebListen, type WebSessionState, type VendorWebResult, type VendorWebSession } from "./server.js";
import type { WebModelsDraft, SecretRef, SecretSlot } from "./mask.js";
import { maskSnapshot, hydrateCommitDraft } from "./mask.js";
import { readModelsSnapshot, commitModelsSnapshot } from "../../config-core.js";
import type { ModelsSnapshot } from "../../config-core.js";
import { getModelsJsonPath } from "../../models-json.js";
import { listModelFields, listProviderFields } from "../../config-document.js";

// Module-scoped active-session slot
let activeSession: VendorWebSession | null = null;

export function getActiveSession(): VendorWebSession | null {
	return activeSession;
}

export function clearActiveSession(session: VendorWebSession): void {
	if (activeSession === session) {
		activeSession = null;
	}
}

// Shared browser opener helper (used by both /vendor web and open-web menu action)
export async function openBrowser(url: string): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
		const args = process.platform === "win32" ? ["/c", "start", url.replace(/&/g, "^&")] : [url];
		const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
		child.unref();
		child.on("error", () => resolve(false));
		child.on("close", (code) => resolve(code === 0));
		setTimeout(() => resolve(true), 500);
	});
}

export function createSessionShutdownHandler(): () => void {
	return () => {
		if (activeSession) {
			activeSession.stop();
		}
	};
}

// Internal placeholder with safe stop()/url for the window between claim and real session.
// Shutdown during server/opener awaits must not throw and must not proceed after cancel.
function createPlaceholder(): VendorWebSession & { cancelled: boolean } {
	let cancelled = false;
	return {
		url: "",
		browserOpened: false,
		get cancelled() { return cancelled; },
		waitForResult: async () => ({ kind: "cancelled" as const }),
		stop(): void { cancelled = true; },
	};
}

export async function startVendorWebSession(options?: {
	modelsPath?: string;
	openBrowser?: (url: string) => Promise<boolean>;
	listen?: VendorWebListen;
}): Promise<VendorWebSession> {
	// Synchronous active-session claim before any await
	if (activeSession) {
		throw Object.assign(
			new Error(`A vendor web session is already active. Open ${activeSession.url} or cancel the existing session first.`),
			{ code: "session_active" as const },
		);
	}
	// Placeholder to reserve the slot identity-aware, with safe stop()/url for shutdown during awaits
	const placeholder = createPlaceholder();
	activeSession = placeholder;

	const path = options?.modelsPath ?? getModelsJsonPath();
	let snapshot: ModelsSnapshot;
	try {
		snapshot = readModelsSnapshot(path);
	} catch (err) {
		clearActiveSession(placeholder);
		throw err;
	}

	// Mask: create SecretRefs and build opaque draft
	const { draft, secrets } = maskSnapshot(snapshot);
	const state: WebSessionState = {
		snapshot,
		draft,
		secrets,
		phase: "open",
		closeAfterResponse: false,
	};

	const token = randomBytes(32).toString("base64url");

	let settleResolve: ((value: VendorWebResult) => void) | undefined;
	let settled = false;

	const settle = (value: VendorWebResult): void => {
		if (settled) return;
		settled = true;
		settleResolve?.(value);
	};

	const settlePromise = new Promise<VendorWebResult>((resolve) => {
		settleResolve = resolve;
	});

	const handleState = (): Record<string, unknown> => {
		// Client ApiState contract: models + secretSlots + field descriptors.
		const secretSlots: SecretSlot[] = [];
		for (const [, slot] of state.secrets) {
			secretSlots.push({ ref: slot.ref, path: slot.path });
		}
		return {
			models: state.draft,
			revision: state.snapshot.revision,
			secretSlots,
			providerFields: listProviderFields(),
			modelFields: listModelFields(),
			catalogAvailable: true,
		};
	};

	const prepareConfig = (body: unknown): (() => ModelsSnapshot) => {
		if (body === null || typeof body !== "object" || Array.isArray(body)) {
			throw Object.assign(new Error("Missing models or expectedRevision"), { code: "invalid_request" as const });
		}
		const input = body as { models?: unknown; expectedRevision?: unknown };
		if (input.models === null || typeof input.models !== "object" || Array.isArray(input.models) || typeof input.expectedRevision !== "string" || !input.expectedRevision) {
			throw Object.assign(new Error("Missing models or expectedRevision"), { code: "invalid_request" as const });
		}
		const expectedRevision = input.expectedRevision as typeof snapshot.revision;
		const hydrated = hydrateCommitDraft(input.models as WebModelsDraft, state.secrets, expectedRevision);
		return () => commitModelsSnapshot({ models: hydrated, expectedRevision }, path);
	};

	const handleCancel = (): void => {
		settle({ kind: "cancelled" });
	};


	// Create server + open browser, with identity-aware cleanup on any failure
	let serverResult: Awaited<ReturnType<typeof createVendorWebServer>>;
	try {
		serverResult = await createVendorWebServer({
			token,
			state,
			handleState,
			prepareConfig,
			handleCancel,
			onSaved: (saved) => {
				settle({ kind: "saved", snapshot: saved });
			},
			listen: options?.listen,
		});

		if (placeholder.cancelled) {
			serverResult.server.close();
			serverResult.destroySockets();
			state.secrets.clear();
			clearActiveSession(placeholder);
			throw Object.assign(new Error("Session cancelled during startup"), { code: "session_cancelled" as const });
		}
	} catch (err) {
		// Identity-aware cleanup on any failure
		clearActiveSession(placeholder);
		state.secrets.clear();
		throw err;
	}

	const server = serverResult.server;

	const addr = server.address();
	if (!addr || typeof addr === "string") {
		server.close();
		serverResult.destroySockets();
		state.secrets.clear();
		clearActiveSession(placeholder);
		throw new Error("Server failed to bind");
	}
	const port = addr.port;
	const url = `http://127.0.0.1:${port}/#token=${token}`;

	let stopped = false;
	const stop = (): void => {
		if (stopped) return;
		stopped = true;
		// Stop accepting new connections
		server.close();
		// Immediately destroy tracked sockets so keep-alive/active connections don't block close
		serverResult.destroySockets();
	};

	// Call injected browser opener (defaults to shared openBrowser)
	const opener = options?.openBrowser ?? openBrowser;
	let browserOpened = false;
	try {
		browserOpened = await opener(url);
	} catch {
		// Opener failure is non-fatal: session/url still usable
	}
	// Check if placeholder was cancelled during the opener await (runs regardless of opener outcome)
	if (placeholder.cancelled) {
		stop();
		state.secrets.clear();
		clearActiveSession(placeholder);
		throw Object.assign(new Error("Session cancelled during startup"), { code: "session_cancelled" as const });
	}

	const result: VendorWebSession = {
		url,
		browserOpened,
		async waitForResult(): Promise<VendorWebResult> {
			try {
				const value = await settlePromise;
				stop();
				return value;
			} finally {
				clearActiveSession(result);
				state.secrets.clear();
			}
		},
		stop(): void {
			if (settled) return;
			// First-terminal-action-wins
			if (state.phase === "open") {
				state.phase = "cancelled";
				settle({ kind: "cancelled" });
			} else if (state.phase === "saving") {
				// Save already claimed — don't settle, don't clear secrets
				state.closeAfterResponse = true;
				return;
			}
			// Already terminal — just clean up
			stop();
			state.secrets.clear();
		},
	};

	// Replace placeholder with real session
	activeSession = result;

	return result;
}
