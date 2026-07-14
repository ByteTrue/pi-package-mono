import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { TextDecoder } from "node:util";

import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

import { getModelsJsonPath } from "./models-json.js";
import type { ModelsJson } from "./models-json.js";

export type ConfigRevision = "missing" | `sha256:${string}`;

export type ModelsSnapshot = {
	models: ModelsJson;
	revision: ConfigRevision;
};

export type ConfigIssueCode = "invalid_structure" | "duplicate_model_id" | "pi_incompatible" | "validator_unavailable";

export type ConfigIssue = {
	path: string;
	code: ConfigIssueCode;
	message: string;
};

export type ConfigErrorCode =
	| "invalid_config"
	| "invalid_revision"
	| "config_changed"
	| "read_failed"
	| "write_failed"
	| "validator_unavailable";

export class ConfigCoreError extends Error {
	readonly code: ConfigErrorCode;
	readonly path?: string;
	readonly issues?: ConfigIssue[];

	constructor(code: ConfigErrorCode, message: string, options: { path?: string; issues?: ConfigIssue[] } = {}) {
		super(message);
		this.name = "ConfigCoreError";
		this.code = code;
		this.path = options.path;
		this.issues = options.issues;
	}
}

export type PiOracle = (path: string) => string | undefined;

type ConfigCoreDependencies = {
	oracle: PiOracle;
	readFile: typeof readFileSync;
	writeFile: typeof writeFileSync;
	rename: typeof renameSync;
	unlink: typeof unlinkSync;
	mkdir: typeof mkdirSync;
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

function hashBytes(bytes: Buffer): ConfigRevision {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issue(path: string, code: ConfigIssueCode, message: string): ConfigIssue {
	return { path, code, message };
}

export function validateModelsJson(models: unknown): ConfigIssue[] {
	if (!isObject(models)) return [issue("$", "invalid_structure", "Models configuration must be an object")];
	if (!("providers" in models) || !isObject(models.providers)) {
		return [issue("/providers", "invalid_structure", "Models configuration must contain a providers object")];
	}
	const issues: ConfigIssue[] = [];
	for (const [providerKey, provider] of Object.entries(models.providers)) {
		if (!isObject(provider) || !Array.isArray(provider.models)) continue;
		const seen = new Set<string>();
		for (const [index, model] of provider.models.entries()) {
			if (!isObject(model) || typeof model.id !== "string") continue;
			if (seen.has(model.id)) {
				issues.push(issue(`/providers/${escapePointer(providerKey)}/models/${index}/id`, "duplicate_model_id", "Model id is duplicated"));
			} else {
				seen.add(model.id);
			}
		}
	}
	return issues;
}

function escapePointer(value: string): string {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function revisionFromBytes(bytes: Buffer): ConfigRevision {
	return hashBytes(bytes);
}

function readRevision(path: string, deps: ConfigCoreDependencies): ConfigRevision {
	let bytes: Buffer;
	try {
		bytes = deps.readFile(path);
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") return "missing";
		throw new ConfigCoreError("read_failed", "Unable to read models configuration");
	}
	return revisionFromBytes(bytes);
}

function parseSnapshot(path: string, deps: ConfigCoreDependencies): ModelsSnapshot {
	let bytes: Buffer;
	try {
		bytes = deps.readFile(path);
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
			return { models: { providers: {} }, revision: "missing" };
		}
		throw new ConfigCoreError("read_failed", "Unable to read models configuration");
	}

	// Reject UTF-8 BOM explicitly before decoding
	if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		throw new ConfigCoreError("read_failed", "Unable to parse models configuration");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(utf8.decode(bytes));
	} catch {
		throw new ConfigCoreError("read_failed", "Unable to parse models configuration");
	}
	const issues = validateModelsJson(parsed);
	if (issues.length > 0) throw new ConfigCoreError("invalid_config", "Models configuration is invalid", { issues });
	return { models: parsed as ModelsJson, revision: revisionFromBytes(bytes) };
}

function defaultOracle(path: string): string | undefined {
	try {
		return ModelRegistry.create(AuthStorage.inMemory(), path).getError();
	} catch (error) {
		throw error instanceof Error ? error : new Error("validator unavailable");
	}
}

function canonicalBytes(models: ModelsJson): Buffer {
	try {
		return Buffer.from(`${JSON.stringify(models, null, 2)}\n`, "utf8");
	} catch {
		throw new ConfigCoreError("invalid_config", "Models configuration cannot be serialized");
	}
}

function tempPath(path: string, prefix: string): string {
	return `${path}.${prefix}-${randomBytes(16).toString("hex")}.tmp`;
}

function validateWithOracle(models: ModelsJson, path: string, deps: ConfigCoreDependencies): void {
	const localIssues = validateModelsJson(models);
	if (localIssues.length > 0) throw new ConfigCoreError("invalid_config", "Models configuration is invalid", { issues: localIssues });

	const temp = tempPath(path, "oracle");
	try {
		const bytes = canonicalBytes(models);
		deps.mkdir(dirname(path), { recursive: true });
		deps.writeFile(temp, bytes, { encoding: "utf8", mode: 0o600 });
		let oracleError: string | undefined;
		try {
			oracleError = deps.oracle(temp);
		} catch {
			throw new ConfigCoreError("validator_unavailable", "Models validator is unavailable");
		}
		if (oracleError) {
			const oracleIssue = issue("$", "pi_incompatible", "Models configuration is incompatible with Pi");
			throw new ConfigCoreError("invalid_config", "Models configuration is invalid", { issues: [oracleIssue] });
		}
	} catch (error) {
		if (error instanceof ConfigCoreError) throw error;
		throw new ConfigCoreError("validator_unavailable", "Models validator is unavailable");
	} finally {
		try {
			deps.unlink(temp);
		} catch {
			// Cleanup is best effort; never expose a temporary pathname.
		}
	}
}

function commitWithDependencies(
	input: { models: ModelsJson; expectedRevision: ConfigRevision },
	path: string,
	deps: ConfigCoreDependencies,
): ModelsSnapshot {
	if (input.expectedRevision !== "missing" && !/^sha256:[0-9a-f]{64}$/.test(input.expectedRevision)) {
		throw new ConfigCoreError("invalid_revision", "Invalid models configuration revision");
	}
	validateWithOracle(input.models, path, deps);
	const currentRevision = readRevision(path, deps);
	if (currentRevision !== input.expectedRevision) {
		throw new ConfigCoreError("config_changed", "Models configuration changed before save");
	}

	const bytes = canonicalBytes(input.models);
	const temp = tempPath(path, "commit");
	try {
		deps.mkdir(dirname(path), { recursive: true });
		deps.writeFile(temp, bytes, { encoding: "utf8", mode: 0o600 });
		deps.rename(temp, path);
	} catch {
		throw new ConfigCoreError("write_failed", "Unable to write models configuration");
	} finally {
		try {
			deps.unlink(temp);
		} catch {
			// rename removes the temporary path on success.
		}
	}
	return { models: input.models, revision: revisionFromBytes(bytes) };
}

const productionDependencies: ConfigCoreDependencies = {
	oracle: defaultOracle,
	readFile: readFileSync,
	writeFile: writeFileSync,
	rename: renameSync,
	unlink: unlinkSync,
	mkdir: mkdirSync,
};

export function readModelsSnapshot(path = getModelsJsonPath()): ModelsSnapshot {
	return parseSnapshot(path, productionDependencies);
}

export function commitModelsSnapshot(
	input: { models: ModelsJson; expectedRevision: ConfigRevision },
	path = getModelsJsonPath(),
): ModelsSnapshot {
	return commitWithDependencies(input, path, productionDependencies);
}

export function createConfigCoreForTesting(dependencies: Partial<ConfigCoreDependencies> = {}) {
	const deps = { ...productionDependencies, ...dependencies };
	return {
		readModelsSnapshot: (path: string) => parseSnapshot(path, deps),
		commitModelsSnapshot: (input: { models: ModelsJson; expectedRevision: ConfigRevision }, path: string) =>
			commitWithDependencies(input, path, deps),
	};
}
