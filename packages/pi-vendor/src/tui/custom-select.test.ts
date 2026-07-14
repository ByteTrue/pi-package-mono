import { describe, expect, it } from "vitest";

import { createCustomInput, createCustomSelect } from "./custom-select.js";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

const keybindings = { matches: () => false };

describe("custom TUI components", () => {
	it("renders select with boxed sections and selected cursor", () => {
		const select = createCustomSelect({ title: "Custom providers", items: ["one", "two"] })(null, theme, keybindings, () => {});
		const lines = select.render(48);

		expect(lines[0]).toMatch(/^┌─+┐$/);
		expect(lines).toContain("├" + "─".repeat(46) + "┤");
		expect(lines.some((line: string) => line.includes("› one"))).toBe(true);
		expect(lines.at(-1)).toMatch(/^└─+┘$/);
	});

	it("renders custom escape hint", () => {
		const select = createCustomSelect({ title: "Vendor", items: ["Back"], escapeLabel: "goes back" })(null, theme, keybindings, () => {});
		const lines = select.render(48);

		expect(lines.some((line: string) => line.includes("Esc goes back"))).toBe(true);
	});

	it("renders input with prompt and footer", () => {
		const input = createCustomInput({ title: "Provider key", placeholder: "provider-id" })(null, theme, keybindings, () => {});
		const lines = input.render(48);

		expect(lines.some((line: string) => line.includes("provider-id"))).toBe(true);
		expect(lines.some((line: string) => line.includes("Enter submits"))).toBe(true);
		expect(lines.at(-1)).toMatch(/^└─+┘$/);
	});

	it("submits empty input as an empty string", () => {
		let result: string | null | undefined;
		const input = createCustomInput({ title: "Search models" })(null, theme, keybindings, (value) => {
			result = value;
		});

		input.handleInput("\n");

		expect(result).toBe("");
	});
});
