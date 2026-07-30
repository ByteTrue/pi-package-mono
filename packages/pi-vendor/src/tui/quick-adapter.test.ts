import { describe, expect, it } from "vitest";
import { createProductionQuickUI } from "./quick-adapter.js";

/** Records what the adapter actually hands to Pi's ctx.ui. */
function recorder(returns: { select?: string; input?: string; confirm?: boolean } = {}) {
	const seen: { method: string; args: unknown[] }[] = [];
	const raw = {
		select: (...args: unknown[]) => {
			seen.push({ method: "select", args });
			return Promise.resolve(returns.select);
		},
		input: (...args: unknown[]) => {
			seen.push({ method: "input", args });
			return Promise.resolve(returns.input);
		},
		confirm: (...args: unknown[]) => {
			seen.push({ method: "confirm", args });
			return Promise.resolve(returns.confirm ?? false);
		},
		notify: (...args: unknown[]) => {
			seen.push({ method: "notify", args });
		},
	};
	return { ui: createProductionQuickUI(raw as never), seen };
}

describe("createProductionQuickUI", () => {
	it("passes the placeholder string, not the options object", async () => {
		const { ui, seen } = recorder({ input: "typed" });
		const value = await ui.input({ message: "Model id:", placeholder: "e.g. gpt-5" });

		expect(value).toBe("typed");
		expect(seen[0]!.args).toEqual(["Model id:", "e.g. gpt-5"]);
	});

	it("passes undefined when there is no placeholder", async () => {
		const { ui, seen } = recorder({ input: "x" });
		await ui.input({ message: "Provider key:" });

		expect(seen[0]!.args).toEqual(["Provider key:", undefined]);
	});

	it("sends labels to Pi and maps the answer back to its value", async () => {
		const { ui, seen } = recorder({ select: "Add provider" });
		const value = await ui.select({
			message: "Manage providers and models",
			choices: [
				{ value: "add-provider", label: "Add provider" },
				{ value: "add-model", label: "Add model" },
			],
			default: "add-provider",
		});

		expect(value).toBe("add-provider");
		expect(seen[0]!.args[1]).toEqual(["Add provider", "Add model"]);
		expect(seen[0]!.args[2]).toEqual({ default: "Add provider" });
	});

	it("shows ten choices per page and uses left/right to move by a page", async () => {
		let rendered = "";
		const raw = {
			custom: (factory: Function) =>
				new Promise<string | null>((resolve) => {
					const component = factory(
						{ requestRender() {} },
						{
							fg: (_color: string, text: string) => text,
							bold: (text: string) => text,
						},
						{},
						resolve,
					);
					rendered = component.render(120).join("\n");
					component.handleInput("\x1b[C"); // page 1 → 2
					component.handleInput("\x1b[C"); // page 2 → 3
					component.handleInput("\x1b[D"); // page 3 → 2
					component.handleInput("\r");
				}),
		};
		const ui = createProductionQuickUI(raw as never);
		const choices = Array.from({ length: 23 }, (_, i) => ({ value: `model-${i}`, label: `model-${i}` }));

		await expect(ui.select({ message: "Select model:", choices })).resolves.toBe("model-10");
		expect(rendered).toContain("(1/23)");
		expect(rendered.match(/^  model-|^→ model-/gm)).toHaveLength(10);
		expect(rendered).toContain("←→ page");
	});

	it("returns null when the user escapes a select", async () => {
		const { ui } = recorder({});
		const value = await ui.select({ message: "Select model:", choices: [{ value: "a", label: "A" }] });

		expect(value).toBeNull();
	});

	it("returns null when the user escapes an input", async () => {
		const { ui } = recorder({});
		expect(await ui.input({ message: "Model id:" })).toBeNull();
	});
});
