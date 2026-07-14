import { describe, it, expect, vi } from "vitest";
import {
	reduceModelAction,
	listModelRows,
	getModels,
	previewModelMutation,
	pathUnderPrefix,
	modelSubtreePrefix,
	enrichSelectedRows,
	importRowsFromIds,
	countSelectedImport,
	countImportReplaceTargets,
	type ModelManagerState,
	type ImportRow,
	type ApiClient,
} from "./state.js";
import { addModel, replaceModel, deleteModel } from "../../../config-mutations.js";
import type { SecretSlot } from "../state.js";

function emptyModelState(): ModelManagerState {
	return {
		baseline: { providers: {} },
		draft: { providers: {} },
		revision: "missing",
		secretSlots: [],
		selectedProvider: null,
		rawText: null,
		dirty: false,
		errors: [],
		modelQuery: "",
		visualSort: "document",
		editor: null,
		importRows: [],
		catalogAvailable: true,
	};
}

function stateWithModels(
	key: string,
	models: Array<Record<string, unknown>>,
	opts: { secretSlots?: SecretSlot[] } = {},
): ModelManagerState {
	const providers = { [key]: { models } } as ModelManagerState["draft"]["providers"];
	return {
		...emptyModelState(),
		baseline: { providers },
		draft: { providers },
		selectedProvider: key,
		secretSlots: opts.secretSlots ?? [],
	};
}

function closedImportModel(id: string, name?: string) {
	return {
		id,
		name: name ?? id,
		api: "openai-completions",
		contextWindow: 8192,
		maxTokens: 1024,
		input: ["text" as const],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

describe("ModelRowHandle stale detection", () => {
	it("opens editor when index+previousId still match", () => {
		const s = stateWithModels("p", [
			{ id: "a", name: "Alpha" },
			{ id: "b", name: "Beta" },
		]);
		const r = reduceModelAction(s, {
			type: "model-open-editor",
			handle: { providerKey: "p", index: 1, previousId: "b" },
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.editor?.handle).toEqual({ providerKey: "p", index: 1, previousId: "b" });
		expect(r.value.editor?.value.id).toBe("b");
	});

	it("rejects when model id at index no longer matches previousId", () => {
		const s = stateWithModels("p", [
			{ id: "a", name: "Alpha" },
			{ id: "b", name: "Beta" },
		]);
		const r = reduceModelAction(s, {
			type: "model-open-editor",
			handle: { providerKey: "p", index: 0, previousId: "b" },
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.message).toMatch(/changed|reopen/i);
	});

	it("rejects when index is out of range after delete", () => {
		const s = stateWithModels("p", [{ id: "a" }]);
		const r = reduceModelAction(s, {
			type: "model-open-editor",
			handle: { providerKey: "p", index: 3, previousId: "a" },
		});
		expect(r.ok).toBe(false);
	});
});

describe("visualSort is render-only", () => {
	it("sorts rows by id/name without mutating document order", () => {
		const s = stateWithModels("p", [
			{ id: "z-last", name: "Middle" },
			{ id: "a-first", name: "Zebra" },
			{ id: "m-mid", name: "Alpha" },
		]);

		const byId = listModelRows(s.draft, "p", "", "id");
		expect(byId.map((r) => r.previousId)).toEqual(["a-first", "m-mid", "z-last"]);
		// document indices preserved from original positions
		expect(byId.map((r) => r.index)).toEqual([1, 2, 0]);

		const byName = listModelRows(s.draft, "p", "", "name");
		expect(byName.map((r) => String(r.model.name))).toEqual(["Alpha", "Middle", "Zebra"]);
		expect(byName.map((r) => r.index)).toEqual([2, 0, 1]);

		// document order unchanged after sort actions on state
		const sortedState = reduceModelAction(s, { type: "model-sort", sort: "id" });
		expect(sortedState.ok).toBe(true);
		if (!sortedState.ok) return;
		expect(getModels(sortedState.value.draft, "p").map((m) => m.id)).toEqual([
			"z-last",
			"a-first",
			"m-mid",
		]);
		expect(sortedState.value.visualSort).toBe("id");
	});
});

describe("add/replace/delete via previewModelMutation", () => {
	it("adds a model", () => {
		const s = stateWithModels("p", [{ id: "a" }]);
		const r = reduceModelAction(s, {
			type: "model-add",
			providerKey: "p",
			model: { id: "b", name: "Bee" },
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(getModels(r.value.draft, "p").map((m) => m.id)).toEqual(["a", "b"]);
		expect(r.value.dirty).toBe(true);
		expect(r.value.editor).toBeNull();
	});

	it("replaces a model in place", () => {
		const s = stateWithModels("p", [
			{ id: "a", name: "Old" },
			{ id: "b", name: "Keep" },
		]);
		const r = reduceModelAction(s, {
			type: "model-replace",
			providerKey: "p",
			previousId: "a",
			model: { id: "a", name: "New" },
			conflict: "reject",
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(getModels(r.value.draft, "p")).toEqual([
			{ id: "a", name: "New" },
			{ id: "b", name: "Keep" },
		]);
	});

	it("deletes a model", () => {
		const s = stateWithModels("p", [{ id: "a" }, { id: "b" }]);
		const r = reduceModelAction(s, {
			type: "model-delete",
			providerKey: "p",
			modelId: "a",
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(getModels(r.value.draft, "p").map((m) => m.id)).toEqual(["b"]);
	});
});

describe("SecretRef move/copy rejection and allowedRemovedPrefixes", () => {
	const refA = "pi-vendor-secret:aaaaaaaaaaaaaaaaaaaaaa";
	const refB = "pi-vendor-secret:bbbbbbbbbbbbbbbbbbbbbb";

	it("rejects when a secret ref is moved to another path (no remap)", () => {
		const before = {
			providers: {
				p: {
					models: [
						{ id: "a", headers: { "X-Key": refA } },
						{ id: "b", name: "plain" },
					],
				},
			},
		} as Parameters<typeof previewModelMutation>[0];
		const slots: SecretSlot[] = [
			{ ref: refA, path: "/providers/p/models/0/headers/X-Key" },
		];
		// Simulate a mutation that moves the secret from model 0 to model 1 headers.
		const r = previewModelMutation(
			before,
			() => ({
				ok: true as const,
				value: {
					providers: {
						p: {
							models: [
								{ id: "a", name: "no-secret" },
								{ id: "b", headers: { "X-Key": refA } },
							],
						},
					},
				},
			}),
			slots,
			{ allowedRemovedPrefixes: [] },
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.message).toMatch(/moved/i);
	});

	it("rejects when a secret ref is copied to multiple locations", () => {
		const before = {
			providers: {
				p: {
					models: [{ id: "a", headers: { "X-Key": refA } }],
				},
			},
		} as Parameters<typeof previewModelMutation>[0];
		const slots: SecretSlot[] = [
			{ ref: refA, path: "/providers/p/models/0/headers/X-Key" },
		];
		const r = previewModelMutation(
			before,
			() => ({
				ok: true as const,
				value: {
					providers: {
						p: {
							models: [
								{ id: "a", headers: { "X-Key": refA } },
								{ id: "b", headers: { "X-Key": refA } },
							],
						},
					},
				},
			}),
			slots,
			{ allowedRemovedPrefixes: [] },
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.message).toMatch(/multiple locations/i);
	});

	it("rejects unexpected secret removal outside allowedRemovedPrefixes", () => {
		const before = {
			providers: {
				p: {
					models: [
						{ id: "a", headers: { "X-Key": refA } },
						{ id: "b", headers: { "Y-Key": refB } },
					],
				},
			},
		} as Parameters<typeof deleteModel>[0];
		const slots: SecretSlot[] = [
			{ ref: refA, path: "/providers/p/models/0/headers/X-Key" },
			{ ref: refB, path: "/providers/p/models/1/headers/Y-Key" },
		];
		// Only allow removing model 0 secrets; deleting model 1 should fail.
		const r = previewModelMutation(
			before,
			() => deleteModel(before, "p", "b"),
			slots,
			{ allowedRemovedPrefixes: [modelSubtreePrefix("p", 0)] },
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.message).toMatch(/removed unexpectedly/i);
	});

	it("allows secret removal under allowedRemovedPrefixes for confirmed delete", () => {
		const s = stateWithModels(
			"p",
			[
				{ id: "a", headers: { "X-Key": refA } },
				{ id: "b", name: "keep" },
			],
			{
				secretSlots: [{ ref: refA, path: "/providers/p/models/0/headers/X-Key" }],
			},
		);
		const r = reduceModelAction(s, {
			type: "model-delete",
			providerKey: "p",
			modelId: "a",
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(getModels(r.value.draft, "p").map((m) => m.id)).toEqual(["b"]);
		expect(r.value.secretSlots).toEqual([]);
	});

	it("allows target secret drop only under overwrite-confirmed replace", () => {
		const s = stateWithModels(
			"p",
			[
				{ id: "a", name: "source" },
				{ id: "b", headers: { "X-Key": refB } },
			],
			{
				secretSlots: [{ ref: refB, path: "/providers/p/models/1/headers/X-Key" }],
			},
		);

		const reject = reduceModelAction(s, {
			type: "model-replace",
			providerKey: "p",
			previousId: "a",
			model: { id: "b", name: "renamed-over" },
			conflict: "reject",
		});
		expect(reject.ok).toBe(false);
		if (reject.ok) return;
		// mutation layer rejects model_exists before secret preview
		expect(reject.error.message).toMatch(/model exists/i);

		const overwrite = reduceModelAction(s, {
			type: "model-replace",
			providerKey: "p",
			previousId: "a",
			model: { id: "b", name: "renamed-over" },
			conflict: "overwrite-confirmed",
		});
		expect(overwrite.ok).toBe(true);
		if (!overwrite.ok) return;
		expect(getModels(overwrite.value.draft, "p").map((m) => m.id)).toEqual(["b"]);
		expect(overwrite.value.secretSlots).toEqual([]);
	});

	it("pathUnderPrefix uses segment boundaries", () => {
		expect(pathUnderPrefix("/providers/p/models/10", "/providers/p/models/1")).toBe(false);
		expect(pathUnderPrefix("/providers/p/models/1/headers/X", "/providers/p/models/1")).toBe(true);
		expect(pathUnderPrefix("/providers/p/models/1", "/providers/p/models/1")).toBe(true);
	});
});

describe("bulk import select cap 100", () => {
	it("rejects import-toggle past 100 selected", () => {
		const rows: ImportRow[] = Array.from({ length: 101 }, (_, i) => ({
			id: `m${i}`,
			selected: i < 100,
			state: "selected-unenriched" as const,
		}));
		const s = { ...emptyModelState(), importRows: rows };
		const r = reduceModelAction(s, { type: "import-toggle", id: "m100" });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.message).toMatch(/100/);
	});

	it("rejects import-select-ids past 100 selected", () => {
		const rows: ImportRow[] = Array.from({ length: 120 }, (_, i) => ({
			id: `m${i}`,
			selected: false,
			state: "selected-unenriched" as const,
		}));
		const s = { ...emptyModelState(), importRows: rows };
		const ids = rows.slice(0, 101).map((r) => r.id);
		const r = reduceModelAction(s, { type: "import-select-ids", ids, selected: true });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.message).toMatch(/100/);
	});

	it("allows selecting exactly 100", () => {
		const rows: ImportRow[] = Array.from({ length: 100 }, (_, i) => ({
			id: `m${i}`,
			selected: false,
			state: "selected-unenriched" as const,
		}));
		const s = { ...emptyModelState(), importRows: rows };
		const r = reduceModelAction(s, {
			type: "import-select-ids",
			ids: rows.map((row) => row.id),
			selected: true,
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(countSelectedImport(r.value.importRows)).toBe(100);
	});
});

describe("import-apply skip/replace", () => {
	it("skip-existing leaves existing models and warns", () => {
		const s = {
			...stateWithModels("p", [{ id: "existing", name: "Old" }]),
			importRows: [
				{
					id: "existing",
					selected: true,
					state: "ready" as const,
					model: closedImportModel("existing", "New"),
				},
				{
					id: "fresh",
					selected: true,
					state: "ready" as const,
					model: closedImportModel("fresh", "Fresh"),
				},
			],
		};
		const r = reduceModelAction(s, {
			type: "import-apply",
			providerKey: "p",
			conflict: "skip-existing",
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const models = getModels(r.value.draft, "p");
		expect(models.map((m) => m.id)).toEqual(["existing", "fresh"]);
		expect(models[0]?.name).toBe("Old");
		expect(r.warnings?.some((w) => /skipped/i.test(w.message))).toBe(true);
		expect(r.value.importRows).toEqual([]);
	});

	it("replace-selected overwrites existing models", () => {
		const s = {
			...stateWithModels("p", [{ id: "existing", name: "Old" }]),
			importRows: [
				{
					id: "existing",
					selected: true,
					state: "ready" as const,
					model: closedImportModel("existing", "Replaced"),
				},
			],
		};
		const r = reduceModelAction(s, {
			type: "import-apply",
			providerKey: "p",
			conflict: "replace-selected",
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const models = getModels(r.value.draft, "p");
		expect(models).toHaveLength(1);
		expect(models[0]?.id).toBe("existing");
		expect(models[0]?.name).toBe("Replaced");
	});
});

describe("concurrent enrichment cancel preserves completed rows", () => {
	it("keeps finished rows when remaining work is aborted", async () => {
		const rows: ImportRow[] = [
			{ id: "fast", selected: true, state: "selected-unenriched" },
			{ id: "slow", selected: true, state: "selected-unenriched" },
			{ id: "idle", selected: false, state: "selected-unenriched" },
		];

		const controller = new AbortController();
		let resolveSlow: ((v: unknown) => void) | undefined;
		const slowPromise = new Promise((resolve) => {
			resolveSlow = resolve;
		});

		const api: ApiClient = {
			fetchCatalog: async () => [],
			fetchDiscover: async () => ({ ids: [] }),
			fetchEnrich: async (modelId, signal) => {
				if (modelId === "fast") {
					return {
						kind: "ready",
						source: "default",
						model: closedImportModel("fast", "Fast"),
					};
				}
				// slow waits until aborted path is set up
				await new Promise<void>((resolve) => {
					const onAbort = () => resolve();
					if (signal?.aborted) {
						resolve();
						return;
					}
					signal?.addEventListener("abort", onAbort, { once: true });
					// also resolve when test unblocks
					void slowPromise.then(() => resolve());
				});
				if (signal?.aborted) {
					throw new DOMException("Aborted", "AbortError");
				}
				return {
					kind: "ready",
					source: "default",
					model: closedImportModel("slow", "Slow"),
				};
			},
		};

		const progress: ImportRow[] = [];
		const done = enrichSelectedRows(rows, api, controller.signal, (u) => progress.push(u));

		// wait until fast completes
		await vi.waitFor(() => {
			expect(progress.some((p) => p.id === "fast" && p.state === "ready")).toBe(true);
		});

		controller.abort();
		resolveSlow?.(undefined);

		const result = await done;
		const fast = result.find((r) => r.id === "fast");
		const slow = result.find((r) => r.id === "slow");
		const idle = result.find((r) => r.id === "idle");

		expect(fast?.state).toBe("ready");
		expect(fast?.model?.id).toBe("fast");
		// cancelled before completion — preserve pre-cancel state (no rollback of completed)
		expect(slow?.state).toBe("selected-unenriched");
		expect(idle?.selected).toBe(false);
		expect(idle?.state).toBe("selected-unenriched");
	});
});

describe("empty id invalid", () => {
	it("rejects model-add with empty id", () => {
		const s = stateWithModels("p", []);
		const r = reduceModelAction(s, {
			type: "model-add",
			providerKey: "p",
			model: { id: "   " },
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.message).toMatch(/required/i);
	});

	it("rejects model-replace with empty new id", () => {
		const s = stateWithModels("p", [{ id: "a" }]);
		const r = reduceModelAction(s, {
			type: "model-replace",
			providerKey: "p",
			previousId: "a",
			model: { id: "" },
			conflict: "reject",
		});
		expect(r.ok).toBe(false);
	});
});

describe("model_exists reject/overwrite", () => {
	it("rejects replace when target id already exists", () => {
		const s = stateWithModels("p", [
			{ id: "a", name: "A" },
			{ id: "b", name: "B" },
		]);
		const r = reduceModelAction(s, {
			type: "model-replace",
			providerKey: "p",
			previousId: "a",
			model: { id: "b", name: "A-as-B" },
			conflict: "reject",
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.message).toMatch(/model exists/i);
	});

	it("overwrites with overwrite-confirmed", () => {
		const s = stateWithModels("p", [
			{ id: "a", name: "A" },
			{ id: "b", name: "B" },
			{ id: "c", name: "C" },
		]);
		const r = reduceModelAction(s, {
			type: "model-replace",
			providerKey: "p",
			previousId: "a",
			model: { id: "b", name: "A-as-B" },
			conflict: "overwrite-confirmed",
		});
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const ids = getModels(r.value.draft, "p").map((m) => m.id);
		expect(ids).toEqual(["b", "c"]);
		expect(getModels(r.value.draft, "p")[0]?.name).toBe("A-as-B");
	});

	it("rejects model-add when id already exists", () => {
		const s = stateWithModels("p", [{ id: "a" }]);
		const r = reduceModelAction(s, {
			type: "model-add",
			providerKey: "p",
			model: { id: "a", name: "dup" },
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.message).toMatch(/model exists/i);
	});
});

describe("importRowsFromIds", () => {
	it("dedupes and keeps first-seen order", () => {
		expect(importRowsFromIds(["b", "a", "b", "", "a"]).map((r) => r.id)).toEqual(["b", "a"]);
	});
});

describe("countImportReplaceTargets", () => {
	it("counts existing replace targets and known secrets under them", () => {
		const ref = "pi-vendor-secret:dddddddddddddddddddddd";
		const s = stateWithModels(
			"p",
			[
				{ id: "existing", name: "Old", headers: { "X-Key": ref } },
				{ id: "other", name: "Other" },
			],
			{
				secretSlots: [
					{ ref, path: "/providers/p/models/0/headers/X-Key" },
					{ ref: "pi-vendor-secret:eeeeeeeeeeeeeeeeeeeeee", path: "/providers/p/models/1/headers/Y" },
				],
			},
		);
		const rows: ImportRow[] = [
			{
				id: "existing",
				selected: true,
				state: "ready",
				model: closedImportModel("existing", "New"),
			},
			{
				id: "fresh",
				selected: true,
				state: "ready",
				model: closedImportModel("fresh", "Fresh"),
			},
			{
				id: "other",
				selected: false,
				state: "ready",
				model: closedImportModel("other", "Skip"),
			},
		];
		expect(countImportReplaceTargets(s.draft, "p", rows, s.secretSlots)).toEqual({
			modelCount: 1,
			secretCount: 1,
		});
	});
});

describe("previewModelMutation with real mutations", () => {
	it("passes through domain mutation failures", () => {
		const before = { providers: { p: { models: [{ id: "a" }] } } } as Parameters<
			typeof addModel
		>[0];
		const r = previewModelMutation(
			before,
			() => addModel(before, "p", { id: "a" }),
			[],
			{ allowedRemovedPrefixes: [] },
		);
		expect(r.ok).toBe(false);
	});

	it("allows no-op secret-preserving replace", () => {
		const ref = "pi-vendor-secret:cccccccccccccccccccccc";
		const before = {
			providers: {
				p: {
					models: [{ id: "a", headers: { "X-Key": ref }, name: "old" }],
				},
			},
		} as Parameters<typeof replaceModel>[0];
		const slots: SecretSlot[] = [{ ref, path: "/providers/p/models/0/headers/X-Key" }];
		const r = previewModelMutation(
			before,
			() =>
				replaceModel(
					before,
					"p",
					"a",
					{ id: "a", headers: { "X-Key": ref }, name: "new" },
					{ conflict: "reject" },
				),
			slots,
			{ allowedRemovedPrefixes: [] },
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.removedSecrets).toEqual([]);
		expect(getModels(r.value.draft, "p")[0]?.name).toBe("new");
	});
});
