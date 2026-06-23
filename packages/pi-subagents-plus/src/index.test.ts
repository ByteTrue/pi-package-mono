import { describe, expect, it } from "vitest";

import { hasGotgenesAgentsCommand } from "./index.js";

describe("gotgenes install detection", () => {
	it("detects the gotgenes /agents extension command", () => {
		expect(hasGotgenesAgentsCommand([{ name: "agents", source: "extension" }])).toBe(true);
	});

	it("ignores non-extension or unrelated commands", () => {
		expect(
			hasGotgenesAgentsCommand([
				{ name: "agents", source: "prompt" },
				{ name: "agents-plus", source: "extension" },
			]),
		).toBe(false);
	});
});
