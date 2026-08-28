import { describe, expect, it } from "vitest";

import type { ModelsJson } from "./models-json.js";
import { addModel, createProvider, replaceModel } from "./config-document.js";

const base: ModelsJson = {
	rootUnknown: { keep: true },
	providers: {
		alpha: { providerUnknown: 1, models: [{ id: "source", modelUnknown: true }, { id: "x" }, { id: "target" }, { id: "y" }] },
		withoutModels: { baseUrl: "https://example.test" },
	},
};

describe("config document mutations", () => {
	it("creates without implicit upsert, trims identity, and never mutates input", () => {
		const created = createProvider(base, " new ", { custom: true });
		expect(created).toEqual({ ok: true, value: expect.objectContaining({ providers: expect.objectContaining({ new: { custom: true } }) }) });
		expect(createProvider(base, "alpha", {})).toMatchObject({ ok: false, error: { code: "provider_exists", path: "/providers/alpha" } });
		expect(createProvider(base, "   ", {})).toMatchObject({ ok: false, error: { code: "invalid_provider_key" } });
		expect(base.providers?.new).toBeUndefined();
	});

	it("adds models without implicit upsert and validates trimmed ids", () => {
		expect(addModel(base, "missing", { id: "a" })).toMatchObject({ ok: false, error: { code: "provider_not_found" } });
		expect(addModel(base, "alpha", { id: "source" })).toMatchObject({ ok: false, error: { code: "model_exists" } });
		expect(addModel(base, "alpha", { id: " " })).toMatchObject({ ok: false, error: { code: "invalid_model_id" } });
		const added = addModel(base, "withoutModels", { id: " added ", unknown: 1 });
		expect(added.ok && added.value.providers?.withoutModels?.models).toEqual([{ id: "added", unknown: 1 }]);
	});

	it.each([
		[["source", "x", "target", "y"], "source", "target", ["replacement", "x", "y"]],
		[["target", "x", "source", "y"], "source", "target", ["replacement", "x", "y"]],
	])("keeps overwrite-confirmed ordering for %j", (ids, previousId, targetId, expected) => {
		const models = { providers: { p: { models: ids.map((id) => ({ id })) } } };
		const result = replaceModel(models, "p", previousId, { id: targetId, name: "replacement", marker: true }, { conflict: "overwrite-confirmed" });
		expect(result.ok && result.value.providers?.p?.models?.map((model) => model.name ?? model.id)).toEqual(expected);
	});

	it("replaces same/missing targets and rejects implicit overwrite", () => {
		expect(replaceModel(base, "alpha", "missing", { id: "new" })).toMatchObject({ ok: false, error: { code: "model_not_found" } });
		expect(replaceModel(base, "alpha", "source", { id: "target" })).toMatchObject({ ok: false, error: { code: "model_exists" } });
		const same = replaceModel(base, "alpha", "source", { id: " source ", name: "changed" });
		expect(same.ok && same.value.providers?.alpha?.models?.[0]).toEqual({ id: "source", name: "changed" });
	});

	it("treats prototype-named provider keys as own identities", () => {
		for (const key of ["constructor", "toString"]) {
			const created = createProvider(base, key, { baseUrl: `https://${key}.test` });
			expect(created).toMatchObject({ ok: true });
			expect(created.ok && Object.hasOwn(created.value.providers ?? {}, key)).toBe(true);
			expect(Object.hasOwn(base.providers ?? {}, key)).toBe(false);

			const source = JSON.parse(JSON.stringify({ providers: { [key]: { models: [{ id: "a" }] } } })) as ModelsJson;
			const before = JSON.stringify(source);
			const added = addModel(source, key, { id: "b" });
			expect(added.ok && added.value.providers?.[key]?.models?.map(({ id }) => id)).toEqual(["a", "b"]);
			expect(JSON.stringify(source)).toBe(before);
		}
	});
});
