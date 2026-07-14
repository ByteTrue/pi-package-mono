import { describe, expect, it } from "vitest";
import { showRootMenu, supportsInteractiveUI } from "./quick-root.js";
import { createScriptedQuickUI } from "./quick-adapter.js";

describe("showRootMenu", () => {
	it("returns add-model as default when selected", async () => {
		const ui = createScriptedQuickUI({
			select: (_msg) => "add-model",
		});

		const result = await showRootMenu(ui);
		expect(result).toBe("add-model");
	});

	it("returns add-provider when selected", async () => {
		const ui = createScriptedQuickUI({
			select: (_msg) => "add-provider",
		});

		const result = await showRootMenu(ui);
		expect(result).toBe("add-provider");
	});

	it("returns open-web when selected", async () => {
		const ui = createScriptedQuickUI({
			select: (_msg) => "open-web",
		});

		const result = await showRootMenu(ui);
		expect(result).toBe("open-web");
	});

	it("returns cancel when selected", async () => {
		const ui = createScriptedQuickUI({
			select: (_msg) => "cancel",
		});

		const result = await showRootMenu(ui);
		expect(result).toBe("cancel");
	});

	it("returns null on Esc (cancel)", async () => {
		const ui = createScriptedQuickUI({
			select: (_msg) => null,
		});

		const result = await showRootMenu(ui);
		expect(result).toBeNull();
	});

	it("sends correct message and choices to UI", async () => {
		const ui = createScriptedQuickUI({
			select: (_msg) => "add-model",
		});

		await showRootMenu(ui);
		expect(ui.calls).toHaveLength(1);
		expect(ui.calls[0]!.kind).toBe("select");
		expect(ui.calls[0]!.message).toBe("Manage providers and models");
	});
});

describe("supportsInteractiveUI", () => {
	it("returns true only when hasUI=true and mode=tui", () => {
		expect(supportsInteractiveUI("tui", true)).toBe(true);
		expect(supportsInteractiveUI("tui", false)).toBe(false);
		expect(supportsInteractiveUI("tui", undefined)).toBe(false);
		expect(supportsInteractiveUI("cli", true)).toBe(false);
		expect(supportsInteractiveUI(undefined, true)).toBe(false);
	});
});
