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
		expect(skill).toContain("the machine-generated plan JSON is the only mutation authority");
	});

	it("keeps the AI-facing script surface limited to catalog, discover, and drift", () => {
		expect(skill).toContain("catalog '<keyword>'");
		expect(skill).toContain("discover '<provider-key>'");
		expect(skill).toContain("drift '<provider-key>' ['<official-provider>,...']");
		expect(skill).toContain("There is no AI-facing CRUD or lint command.");
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
		expect(skill).toContain("Retain the exact key order of the official template");
		expect(skill).toContain("Run the mandatory Model ordering check");
		expect(skill).toContain("Enforcement Gate");
		expect(skill).toContain("explicitly alert the user to the detected disorder");
	});

	it("requires table-based plan presentation named by model ID", () => {
		expect(skill).toContain("machine-generated summary table");
		expect(skill).toContain("Machine-generated tables are relayed as-is, and user-facing references name each model by its exact ID.");
		expect(skill).toContain("Every model ID the user sees comes from that machine output, quoted as-is; prose refers to models by their exact ID.");
	});

	it("requires the kept-model drift check with per-field user approval", () => {
		expect(skill).toContain("**Kept-model drift check.**");
		expect(skill).toContain("A drifted model is a question");
		expect(skill).toContain("the update waits for the user's per-field approval");
		expect(skill).toContain("its updates land only after the user approves them field by field");
	});

	it("bounds environment-failure diagnosis to one recovery attempt", () => {
		expect(skill).toContain("make at most one documented recovery attempt");
		expect(skill).toContain("report to the user in one short message what failed and what you tried");
	});
});
