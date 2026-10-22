import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	commitModelsSnapshot,
	ConfigCoreError,
	createConfigCoreForTesting,
	MODELS_JSON_SCHEMA_URL,
	readModelsSnapshot,
	validateModelsJson,
	withSchemaHint,
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
	it("represents a missing path without creating it, seeded with the schema hint", () => {
		const path = tempPath();
		expect(readModelsSnapshot(path)).toEqual({
			models: { $schema: MODELS_JSON_SCHEMA_URL, providers: {} },
			revision: "missing",
		});
		expect(() => statSync(path)).toThrow();
	});

	it("uses raw bytes for revision and preserves unknown/missing fields", () => {
		const path = tempPath();
		const models = { rootUnknown: { keep: true }, providers: { p: { providerUnknown: 1 } } };
		writeFileSync(path, `${JSON.stringify(models)}\n`, { mode: 0o600 });
		const snapshot = readModelsSnapshot(path);
		expect(snapshot.models).toEqual(models);
		expect(snapshot.revision).toMatch(/^sha256:[0-9a-f]{64}$/);
		const core = createConfigCoreForTesting();
		const next = core.commitModelsSnapshot({ models, expectedRevision: snapshot.revision }, path);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(models);
		expect(next.revision).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(models, null, 2)}\n`);
		if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
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
		const core = createConfigCoreForTesting();
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


	it("maps commit write and rename failures without leaving temp files", () => {
		const path = tempPath();
		writeFileSync(path, '{"providers":{}}\n', "utf8");
		const snapshot = readModelsSnapshot(path);
		const failingWrite = createConfigCoreForTesting({
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
			rename: () => {
				throw new Error("rename failed");
			},
		});
		expect(() => failingRename.commitModelsSnapshot({ models: { providers: {} }, expectedRevision: snapshot.revision }, path)).toThrowError(
			/Unable to write models configuration/,
		);
		expect(readdirSync(join(path, "..")).filter((entry) => entry.includes(".tmp"))).toEqual([]);
	});

	it("commits through the public API", () => {
		const path = tempPath();
		const models = {
			unknownRoot: true,
			providers: { custom: { unknownProvider: true, api: "openai-completions", baseUrl: "https://example.test/v1", apiKey: "$ENV_VAR", models: [{ id: "one", unknownModel: 1 }] } },
		};
		const result = commitModelsSnapshot({ models, expectedRevision: "missing" }, path);
		expect(result.models).toEqual(models);
	});
});

describe("schema alignment", () => {
	it("keeps a top-level $schema from an existing file instead of rewriting it", () => {
		const path = tempPath();
		const models = { $schema: "https://example.test/other.schema.json", providers: {} };
		writeFileSync(path, `${JSON.stringify(models)}\n`, { mode: 0o600 });
		const snapshot = readModelsSnapshot(path);
		expect(snapshot.models).toEqual(models);
		commitModelsSnapshot({ models: snapshot.models, expectedRevision: snapshot.revision }, path);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(models);
	});

	it("seeds a brand-new document with the published schema URL", () => {
		const path = tempPath();
		const snapshot = readModelsSnapshot(path);
		expect(snapshot.models.$schema).toBe(MODELS_JSON_SCHEMA_URL);
		commitModelsSnapshot({ models: snapshot.models, expectedRevision: snapshot.revision }, path);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ $schema: MODELS_JSON_SCHEMA_URL, providers: {} });
	});

	it("lets a seeded document accept unknown fields", () => {
		expect(withSchemaHint({ rootUnknown: { keep: true }, providers: {} })).toEqual({
			$schema: MODELS_JSON_SCHEMA_URL,
			rootUnknown: { keep: true },
			providers: {},
		});
	});

	// Pi validates models.json against its published schema, so a `cost` object
	// missing one of the four base prices makes the whole file fail to load.
	it("rejects a partial models cost before writing", () => {
		expect(validateModelsJson({ providers: { p: { models: [{ id: "x", cost: { input: 1 } }] } } })).toMatchObject([
			{ code: "invalid_cost", path: "/providers/p/models/0/cost/output" },
			{ code: "invalid_cost", path: "/providers/p/models/0/cost/cacheRead" },
			{ code: "invalid_cost", path: "/providers/p/models/0/cost/cacheWrite" },
		]);
		const path = tempPath();
		writeFileSync(path, `${JSON.stringify({ providers: {} })}\n`, { mode: 0o600 });
		const snapshot = readModelsSnapshot(path);
		expect(() =>
			commitModelsSnapshot(
				{ models: { providers: { p: { models: [{ id: "x", cost: { input: 1 } as never }] } } }, expectedRevision: snapshot.revision },
				path,
			),
		).toThrowError(ConfigCoreError);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ providers: {} });
	});

	it("accepts a complete cost with tiers and rejects non-numeric prices", () => {
		const complete = {
			input: 1,
			output: 2,
			cacheRead: 0.1,
			cacheWrite: 0.2,
			tiers: [{ inputTokensAbove: 200000, input: 2, output: 4, cacheRead: 0.2, cacheWrite: 0.4 }],
		};
		expect(validateModelsJson({ providers: { p: { models: [{ id: "x", cost: complete }] } } })).toEqual([]);
		expect(validateModelsJson({ providers: { p: { models: [{ id: "x", cost: { ...complete, output: "2" } }] } } })).toMatchObject([
			{ code: "invalid_cost", path: "/providers/p/models/0/cost/output" },
		]);
	});

	it("allows a partial modelOverrides cost but still checks its types", () => {
		expect(validateModelsJson({ providers: { p: { modelOverrides: { m: { cost: { input: 1 } } } } } })).toEqual([]);
		expect(validateModelsJson({ providers: { p: { modelOverrides: { m: { cost: { input: null } } } } } })).toMatchObject([
			{ code: "invalid_cost", path: "/providers/p/modelOverrides/m/cost/input" },
		]);
	});

	it("accepts the newer metadata fields without cost", () => {
		expect(
			validateModelsJson({
				providers: {
					p: {
						models: [
							{
								id: "x",
								inputLimits: { images: { resize: { maxWidth: 100 } } },
								promptCache: { short: 300, long: 3600 },
								samplingParamsByThinkingLevel: { high: { top_k: 20 } },
							},
						],
					},
				},
			}),
		).toEqual([]);
	});
});
