import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	commitModelsSnapshot,
	ConfigCoreError,
	createConfigCoreForTesting,
	readModelsSnapshot,
	validateModelsJson,
} from "./config-core.js";
import type { ModelsJson } from "./models-json.js";

const tempDirs: string[] = [];

function tempPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-vendor-core-"));
	tempDirs.push(dir);
	return join(dir, "models.json");
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("models snapshots and local validation", () => {
	it("represents a missing path without creating it", () => {
		const path = tempPath();
		expect(readModelsSnapshot(path)).toEqual({ models: { providers: {} }, revision: "missing" });
		expect(() => statSync(path)).toThrow();
	});

	it("uses raw bytes for revision and preserves unknown/missing fields", () => {
		const path = tempPath();
		const models = { rootUnknown: { keep: true }, providers: { p: { providerUnknown: 1 } } };
		writeFileSync(path, `${JSON.stringify(models)}\n`, { mode: 0o600 });
		const snapshot = readModelsSnapshot(path);
		expect(snapshot.models).toEqual(models);
		expect(snapshot.revision).toMatch(/^sha256:[0-9a-f]{64}$/);
		const core = createConfigCoreForTesting({ oracle: () => undefined });
		const next = core.commitModelsSnapshot({ models, expectedRevision: snapshot.revision }, path);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(models);
		expect(next.revision).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(models, null, 2)}\n`);
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	it("rejects malformed strict JSON and duplicate string ids locally", () => {
		const path = tempPath();
		writeFileSync(path, "{ providers: {} }", "utf8");
		expect(() => readModelsSnapshot(path)).toThrowError(ConfigCoreError);
		expect((() => {
		try {
			readModelsSnapshot(path);
		} catch (error) {
			return error;
		}
		return undefined;
	})()).toMatchObject({ code: "read_failed" });
		expect(validateModelsJson({ providers: { p: { models: [{ id: "x" }, { id: "x" }] } } })).toMatchObject([
		{ code: "duplicate_model_id", path: "/providers/p/models/1/id" },
	]);
	});

	it("rejects files with UTF-8 BOM and does not write", () => {
		const path = tempPath();
		const bom = Buffer.from([0xef, 0xbb, 0xbf]);
		writeFileSync(path, Buffer.concat([bom, Buffer.from('{"providers":{}}\n', "utf8")]));
		expect(() => readModelsSnapshot(path)).toThrowError(ConfigCoreError);
		expect((() => {
			try {
				readModelsSnapshot(path);
			} catch (error) {
				return error;
			}
			return undefined;
		})()).toMatchObject({ code: "read_failed" });
		// Verify zero-write: file unchanged
		const raw = readFileSync(path);
		expect(raw[0]).toBe(0xef);
		expect(raw[1]).toBe(0xbb);
		expect(raw[2]).toBe(0xbf);
	});
});

describe("conditional commit", () => {
	it("rejects malformed and stale revisions without changing the target", () => {
		const path = tempPath();
		const original = '{"providers":{}}\n';
		writeFileSync(path, original, "utf8");
		const core = createConfigCoreForTesting({ oracle: () => undefined });
		expect(() => core.commitModelsSnapshot({ models: { providers: {} }, expectedRevision: "sha256:bad" }, path)).toThrowError(
			new ConfigCoreError("invalid_revision", "Invalid models configuration revision"),
		);
		const snapshot = readModelsSnapshot(path);
		writeFileSync(path, '{"providers":{"changed":{}}}\n', "utf8");

		try {
			core.commitModelsSnapshot({ models: { providers: {} }, expectedRevision: snapshot.revision }, path);
		} catch (error) {
			expect(error).toMatchObject({ code: "config_changed" });
		}
		expect(readFileSync(path, "utf8")).not.toBe(`${JSON.stringify({ providers: {} }, null, 2)}\n`);
	});

	it("maps oracle errors and cleans oracle temp files", () => {
		const path = tempPath();
		const models: ModelsJson = { providers: {} };
		const seen: string[] = [];
		const core = createConfigCoreForTesting({
			oracle: (oraclePath) => {
				seen.push(oraclePath);
				return "invalid";
			},
		});
		expect(() => core.commitModelsSnapshot({ models, expectedRevision: "missing" }, path)).toThrowError(ConfigCoreError);
		try {
			core.commitModelsSnapshot({ models, expectedRevision: "missing" }, path);
		} catch (error) {
			expect(error).toMatchObject({ code: "invalid_config", issues: [{ code: "pi_incompatible", path: "$" }] });
		}
		expect(seen).toHaveLength(2);
		expect(readdirSync(join(path, ".."))).not.toContain(seen[0]!.split("/").pop());

		const unavailable = createConfigCoreForTesting({ oracle: () => { throw new Error("boom"); } });
		expect(() => unavailable.commitModelsSnapshot({ models, expectedRevision: "missing" }, path)).toThrowError(ConfigCoreError);
		try {
			unavailable.commitModelsSnapshot({ models, expectedRevision: "missing" }, path);
		} catch (error) {
			expect(error).toMatchObject({ code: "validator_unavailable" });
		}
	});

	it("maps commit write and rename failures without leaving temp files", () => {
		const path = tempPath();
		writeFileSync(path, '{"providers":{}}\n', "utf8");
		const snapshot = readModelsSnapshot(path);
		const failingWrite = createConfigCoreForTesting({
			oracle: () => undefined,
			writeFile: (file, data, options) => {
				if (String(file).includes(".commit-")) throw new Error("write failed");
				return writeFileSync(file, data, options);
			},
		});
		expect(() => failingWrite.commitModelsSnapshot({ models: { providers: {} }, expectedRevision: snapshot.revision }, path)).toThrowError(
			/Unable to write models configuration/,
		);
		expect(readdirSync(join(path, "..")).filter((entry) => entry.includes(".tmp"))).toEqual([]);

		const failingRename = createConfigCoreForTesting({
			oracle: () => undefined,
			rename: () => {
				throw new Error("rename failed");
			},
		});
		expect(() => failingRename.commitModelsSnapshot({ models: { providers: {} }, expectedRevision: snapshot.revision }, path)).toThrowError(
			/Unable to write models configuration/,
		);
		expect(readdirSync(join(path, "..")).filter((entry) => entry.includes(".tmp"))).toEqual([]);
	});

	it("runs the installed Pi oracle on the public path", () => {
		const path = tempPath();
		const models = {
			unknownRoot: true,
			providers: { custom: { unknownProvider: true, api: "openai-completions", baseUrl: "https://example.test/v1", apiKey: "$ENV_VAR", models: [{ id: "one", unknownModel: 1 }] } },
		};
		const result = commitModelsSnapshot({ models, expectedRevision: "missing" }, path);
		expect(result.models).toEqual(models);
	});
});
