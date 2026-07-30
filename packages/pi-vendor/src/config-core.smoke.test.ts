// Guards the save path against the Pi-version break that produced
// "Failed to save: Models validator is unavailable" on Pi 0.82.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitModelsSnapshot, readModelsSnapshot } from "./config-core.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-vendor-commit-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("commitModelsSnapshot on the production path", () => {
	it("writes a provider without depending on removed Pi validator APIs", () => {
		const path = join(dir, "models.json");
		const before = readModelsSnapshot(path);
		expect(before.revision).toBe("missing");

		const models = {
			providers: {
				relay: {
					baseUrl: "https://relay.example.test/v1",
					api: "openai-completions",
					apiKey: "sk-test",
					models: [{ id: "opus", name: "opus", api: "openai-completions", contextWindow: 128000, maxTokens: 16384 }],
				},
			},
		};

		const after = commitModelsSnapshot({ models, expectedRevision: before.revision }, path);
		expect(after.revision).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(models);
	});

	it("still rejects a structurally invalid config before writing", () => {
		const path = join(dir, "models.json");
		expect(() => commitModelsSnapshot({ models: {} as never, expectedRevision: "missing" }, path)).toThrow(
			/invalid/i,
		);
		expect(() => readFileSync(path)).toThrow();
	});
});
