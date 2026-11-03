import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as modelsJson from "pi-vendor";
import { getModelsJsonPath } from "pi-vendor";

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

describe("models-json persistence path", () => {
	it("keeps path resolution and transactional persistence in the single-file bundle", () => {
		expect(modelsJson.getModelsJsonPath).toBeTypeOf("function");
		expect(modelsJson.readModelsSnapshot).toBeTypeOf("function");
		expect(modelsJson.commitModelsSnapshot).toBeTypeOf("function");
	});
});
