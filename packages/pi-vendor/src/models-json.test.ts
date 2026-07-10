import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createNewProviderDraft,
	createProviderDraft,
	getModelsJsonPath,
	readModelsJson,
	upsertProvider,
	writeModelsJson,
} from "./models-json.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-vendor-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	vi.unstubAllEnvs();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("getModelsJsonPath", () => {
	it("uses PI_CODING_AGENT_DIR when present", () => {
		const dir = makeTempDir();
		vi.stubEnv("PI_CODING_AGENT_DIR", dir);
		expect(getModelsJsonPath()).toBe(join(dir, "models.json"));
	});
});

describe("readModelsJson", () => {
	it("defaults a missing file", () => {
		const path = join(makeTempDir(), "models.json");
		expect(readModelsJson(path)).toEqual({ providers: {} });
	});

	it("rejects malformed json", () => {
		const path = join(makeTempDir(), "models.json");
		writeFileSync(path, "{", "utf8");
		expect(() => readModelsJson(path)).toThrow(/Failed to read models\.json/);
	});
});

describe("upsertProvider", () => {
	it("preserves unrelated content and providers", () => {
		const modelsJson = {
			version: 1,
			extra: true,
			providers: {
				existing: {
					baseUrl: "https://example.com/v1",
					models: [{ id: "keep" }],
				},
			},
		};
		const next = upsertProvider(modelsJson, createNewProviderDraft("new"));
		expect(next).toMatchObject({
			version: 1,
			extra: true,
			providers: {
				existing: { baseUrl: "https://example.com/v1" },
				new: { baseUrl: "", api: "openai-completions", apiKey: "$ENV_VAR", models: [] },
			},
		});
	});

	it("removes the old key when renaming a provider", () => {
		const modelsJson = {
			providers: {
				old: { baseUrl: "https://old.example.com", models: [] },
			},
		};
		const draft = createProviderDraft("new", { baseUrl: "https://new.example.com", models: [] });
		const next = upsertProvider(modelsJson, draft, { previousKey: "old" });
		expect(next.providers).toEqual({
			new: { baseUrl: "https://new.example.com", models: [] },
		});
	});

	it("writes formatted json with a trailing newline", () => {
		const path = join(makeTempDir(), "models.json");
		writeModelsJson({ providers: {} }, path);
		expect(readFileSync(path, "utf8")).toBe("{\n  \"providers\": {}\n}\n");
	});
	it("writes models.json with mode 0o600", () => {
		const path = join(makeTempDir(), "models.json");
		writeModelsJson({ providers: {} }, path);
		const mode = statSync(path).mode & 0o777;
		expect(mode).toBe(0o600);
		expect(readFileSync(path, "utf8")).toContain('"providers"');
	});
});

