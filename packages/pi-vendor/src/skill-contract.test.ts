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
});
