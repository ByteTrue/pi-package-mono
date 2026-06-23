import { describe, expect, it } from "vitest";

import { patchFrontmatterField, readFrontmatterField } from "./frontmatter.js";

describe("patchFrontmatterField", () => {
	it("preserves body and unrelated fields while setting model", () => {
		const input = "---\ndescription: Keep me\ntools: read, bash\nmodel: old/model\n---\n\n# Prompt\nDo not touch.\n";
		const output = patchFrontmatterField(input, "model", { value: "new/model" });

		expect(output).toBe("---\ndescription: Keep me\ntools: read, bash\nmodel: new/model\n---\n\n# Prompt\nDo not touch.\n");
	});

	it("adds frontmatter when none exists", () => {
		expect(patchFrontmatterField("Body only\n", "model", { value: "inherit" })).toBe("---\nmodel: inherit\n---\n\nBody only\n");
	});

	it("removes thinking for inherit", () => {
		const input = "---\ndescription: Keep\nthinking: high\nmodel: x/y\n---\n\nBody\n";
		expect(patchFrontmatterField(input, "thinking", { value: undefined })).toBe("---\ndescription: Keep\nmodel: x/y\n---\n\nBody\n");
	});

	it("removes model for inherit", () => {
		const input = "---\ndescription: Keep\nmodel: old/model\nthinking: high\n---\n\nBody\n";
		expect(patchFrontmatterField(input, "model", { value: undefined })).toBe("---\ndescription: Keep\nthinking: high\n---\n\nBody\n");
	});

	it("does not treat nested YAML keys as frontmatter fields", () => {
		const input = "---\nmetadata:\n  model: nested\nmodel: old/model\n---\n\nBody\n";

		expect(patchFrontmatterField(input, "model", { value: "new/model" })).toBe(
			"---\nmetadata:\n  model: nested\nmodel: new/model\n---\n\nBody\n",
		);
	});
});

describe("readFrontmatterField", () => {
	it("reads displayed agent config fields without touching nested keys", () => {
		const input = "---\ndescription: 'Explore code'\nmetadata:\n  model: nested\nmodel: bytetrueapi/claude\nthinking: high\n---\n\nBody\n";

		expect(readFrontmatterField(input, "description")).toBe("Explore code");
		expect(readFrontmatterField(input, "model")).toBe("bytetrueapi/claude");
		expect(readFrontmatterField(input, "thinking")).toBe("high");
	});
});
