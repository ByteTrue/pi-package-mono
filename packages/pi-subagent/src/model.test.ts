import { describe, expect, it } from "vitest";
import { resolveModel } from "./model.js";
import type { ModelResolveContext, PiModel } from "./types.js";

/** Minimal stub model — only `id`/`provider` matter to the resolver. */
function model(provider: string, id: string): PiModel {
	return { provider, id } as unknown as PiModel;
}

/**
 * Stub a ModelResolveContext: `available` feeds getAvailable(); find() does a
 * straight provider+id lookup over the same list.
 */
function ctx(current: PiModel | undefined, available: PiModel[] = []): ModelResolveContext {
	return {
		model: current,
		modelRegistry: {
			getAvailable: () => available,
			find: (provider: string, id: string) =>
				available.find((m) => m.provider === provider && m.id === id),
		} as unknown as ModelResolveContext["modelRegistry"],
	};
}

const main = model("openai", "gpt-5");

describe("resolveModel", () => {
	it("inherits the main model for undefined", () => {
		const r = resolveModel(undefined, ctx(main));
		expect(r.model).toBe(main);
		expect(r.modelId).toBe("gpt-5");
		expect(r.provider).toBe("openai");
		expect(r.warning).toBeUndefined();
	});

	it('inherits the main model for "inherit"', () => {
		const r = resolveModel("inherit", ctx(main));
		expect(r.model).toBe(main);
		expect(r.warning).toBeUndefined();
	});

	it("reports inherit placeholders when there is no main model", () => {
		const r = resolveModel("inherit", ctx(undefined));
		expect(r.model).toBeUndefined();
		expect(r.modelId).toBe("inherit");
		expect(r.provider).toBe("inherit");
	});

	it("resolves an explicit provider/model-id", () => {
		const target = model("bytetrueapi", "deepseek-v4-flash");
		const r = resolveModel("bytetrueapi/deepseek-v4-flash", ctx(main, [target, main]));
		expect(r.model).toBe(target);
		expect(r.modelId).toBe("deepseek-v4-flash");
		expect(r.provider).toBe("bytetrueapi");
		expect(r.warning).toBeUndefined();
	});

	it("falls back with a warning when provider/model-id is unknown", () => {
		const r = resolveModel("openai/does-not-exist", ctx(main, [main]));
		expect(r.model).toBe(main);
		expect(r.modelId).toBe("gpt-5");
		expect(r.provider).toBe("openai");
		expect(r.warning).toMatch(/not found/i);
	});

	it("falls back with a warning for a bare token (no provider, no alias)", () => {
		const r = resolveModel("opus", ctx(main, []));
		expect(r.model).toBe(main);
		expect(r.warning).toMatch(/provider\/model-id/i);
	});

	it("never throws and degrades to inherit placeholders without a main model", () => {
		const r = resolveModel("openai/missing", ctx(undefined, []));
		expect(r.model).toBeUndefined();
		expect(r.modelId).toBe("inherit");
		expect(r.provider).toBe("inherit");
		expect(r.warning).toBeDefined();
	});
});
