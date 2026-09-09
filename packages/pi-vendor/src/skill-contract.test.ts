import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skill = readFileSync(join(import.meta.dirname, "../skills/pi-vendor/SKILL.md"), "utf8");

describe("pi-vendor Skill exact synchronization contract", () => {
	it("uses a canonical machine-generated plan with stale and final assertions", () => {
		expect(skill).toContain("## Exact synchronization templates");
		expect(skill).toContain("PI_VENDOR_SYNC_PLAN_FILE");
		expect(skill).toContain("plan_stale");
		expect(skill).toContain("plan_after_mismatch");
		expect(skill).toContain("discovery_union_mismatch");
		expect(skill).toContain("Never hand-copy, rename, summarize, or reconstruct its model ID sets in prose.");
	});

	it("keeps the AI-facing script surface limited to catalog and discover", () => {
		expect(skill).toContain("catalog '<keyword>'");
		expect(skill).toContain("discover '<provider-key>'");
		expect(skill).toContain("There is no AI-facing CRUD, compare, or lint command.");
	});

	it("documents the mandatory Anthropic Messages trailing /v1 baseUrl rule and audit requirement", () => {
		expect(skill).toContain("Anthropic Messages `baseUrl` Rule");
		expect(skill).toContain("stripped of the trailing `/v1`");
		expect(skill).toContain("/v1/v1/messages");
		expect(skill).toContain("Verify routing constraints, especially the Anthropic Messages rule");
	});

	it("enforces strict-patch integrity, 100% official template key order preservation, and model ordering gates", () => {
		expect(skill).toContain("Strict-Patch Rule (In-Place Integrity)");
		expect(skill).toContain("preserve 100% of the official template's non-routing metadata verbatim");
		expect(skill).toContain("Retain the exact original key order of the official template");
		expect(skill).toContain("Run the mandatory Model ordering check");
		expect(skill).toContain("Enforcement Gate");
		expect(skill).toContain("conclude or report final success silently");
	});
});
