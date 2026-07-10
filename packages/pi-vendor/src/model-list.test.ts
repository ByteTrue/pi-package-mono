import { describe, expect, it } from "vitest";
import { modelList, removeModelAtIndex, replaceModelAtIndex, upsertModel } from "./model-list.js";

describe("modelList", () => {
	it("returns empty when models missing", () => {
		expect(modelList({})).toEqual([]);
	});

	it("clones models", () => {
		const models = [{ id: "a", name: "A" }];
		const out = modelList({ models });
		expect(out).toEqual(models);
		out[0]!.name = "B";
		expect(models[0]!.name).toBe("A");
	});
});

describe("upsertModel", () => {
	it("appends a new model", () => {
		const next = upsertModel([{ id: "a" }], { id: "b", name: "B" });
		expect(next.map((m) => m.id)).toEqual(["a", "b"]);
	});

	it("replaces an existing id", () => {
		const next = upsertModel([{ id: "a", name: "old" }], { id: "a", name: "new" });
		expect(next).toEqual([{ id: "a", name: "new" }]);
	});
});

describe("removeModelAtIndex / replaceModelAtIndex", () => {
	it("removes by index", () => {
		const next = removeModelAtIndex([{ id: "a" }, { id: "b" }, { id: "c" }], 1);
		expect(next.map((m) => m.id)).toEqual(["a", "c"]);
	});

	it("replace removes old index then upserts by id", () => {
		const next = replaceModelAtIndex([{ id: "a" }, { id: "b" }], 0, { id: "b", name: "BB" });
		// remove index 0 (a), then upsert b -> replace remaining b
		expect(next).toEqual([{ id: "b", name: "BB" }]);
	});
});
