import { describe, expect, it } from "vitest";

import type { ModelsJson } from "./models-json.js";
import {
	addModel,
	classifyConfigValue,
	createProvider,
	deleteModel,
	deleteProvider,
	listModelFields,
	listProviderFields,
	renameProvider,
	replaceModel,
} from "./config-document.js";

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

	it("renames with explicit conflict handling and preserves missing fields", () => {
		expect(renameProvider(base, "missing", "next")).toMatchObject({ ok: false, error: { code: "provider_not_found" } });
		expect(renameProvider(base, "alpha", "withoutModels")).toMatchObject({ ok: false, error: { code: "provider_exists" } });
		const renamed = renameProvider(base, "withoutModels", " renamed ");
		expect(renamed.ok && renamed.value.providers?.renamed).toEqual({ baseUrl: "https://example.test" });
		expect(renameProvider(base, "alpha", "withoutModels", { conflict: "overwrite-confirmed" })).toMatchObject({
			ok: true,
			value: { rootUnknown: { keep: true }, providers: { withoutModels: base.providers?.alpha } },
		});
		expect(renameProvider(base, "alpha", "alpha")).toMatchObject({ ok: true, value: base });
	});

	it("deletes providers with typed not-found errors", () => {
		expect(deleteProvider(base, "missing")).toMatchObject({ ok: false, error: { code: "provider_not_found" } });
		const deleted = deleteProvider(base, "alpha");
		expect(deleted.ok && deleted.value.providers).toEqual({ withoutModels: { baseUrl: "https://example.test" } });
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

	it("deletes models with typed errors", () => {
		expect(deleteModel(base, "missing", "source")).toMatchObject({ ok: false, error: { code: "provider_not_found" } });
		expect(deleteModel(base, "alpha", "missing")).toMatchObject({ ok: false, error: { code: "model_not_found" } });
		const deleted = deleteModel(base, "alpha", "source");
		expect(deleted.ok && deleted.value.providers?.alpha?.models?.map(({ id }) => id)).toEqual(["x", "target", "y"]);
	});

	it("treats prototype-named provider keys as own identities", () => {
		for (const key of ["constructor", "toString"]) {
			const created = createProvider(base, key, { baseUrl: `https://${key}.test` });
			expect(created).toMatchObject({ ok: true });
			expect(created.ok && Object.hasOwn(created.value.providers ?? {}, key)).toBe(true);
			expect(Object.hasOwn(base.providers ?? {}, key)).toBe(false);

			const source = JSON.parse(JSON.stringify({ providers: { [key]: { models: [{ id: "a" }] }, keep: { models: [{ id: "b" }] } } })) as ModelsJson;
			const before = JSON.stringify(source);
			expect(deleteProvider(source, key)).toMatchObject({ ok: true });
			expect(JSON.stringify(source)).toBe(before);
			expect(renameProvider(source, key, "renamed")).toMatchObject({ ok: true });

			const conflict = renameProvider(source, "keep", key);
			expect(conflict).toMatchObject({ ok: false, error: { code: "provider_exists" } });
			const overwritten = renameProvider(source, "keep", key, { conflict: "overwrite-confirmed" });
			expect(overwritten.ok && Object.keys(overwritten.value.providers ?? {})).toEqual([key]);
		}
});

describe("field metadata and config-value syntax", () => {
	it("freezes provider/model common and required fields", () => {
		expect(listProviderFields().filter(({ common }) => common).map(({ key }) => key)).toEqual(["baseUrl", "api", "apiKey"]);
		expect(listModelFields().filter(({ common }) => common).map(({ key }) => key)).toEqual(["id"]);
		expect(listModelFields().filter(({ required }) => required).map(({ key }) => key)).toEqual(["id"]);
		expect(listProviderFields().find(({ key }) => key === "modelOverrides")?.kind).toBe("json");
	});

	it.each([
		["literal", "literal"],
		["!security find-password", "command"],
		["$API_KEY", "env-reference"],
		["prefix-${API_KEY}", "env-reference"],
		["$$API_KEY", "literal"],
		["$!literal", "literal"],
	])("classifies %s without resolving it", (value, expected) => {
		expect(classifyConfigValue(value)).toBe(expected);
	});
});

});