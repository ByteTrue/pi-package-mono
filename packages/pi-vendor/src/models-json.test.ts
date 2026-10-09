import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as modelsJson from "./models-json.js";
import { getModelsJsonPath } from "./models-json.js";

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

describe("models-json module surface", () => {
	// The write layer was removed as dead code (audit BYTE-4 #10): persistence
	// must go through config-core's sha256 optimistic lock. If a write/read
	// helper reappears here it would bypass that contract, so pin the surface.
	it("exports only the path helper (no second persistence path)", () => {
		expect(Object.keys(modelsJson).sort()).toEqual(["getModelsJsonPath"]);
	});
});
