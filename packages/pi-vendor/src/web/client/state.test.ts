import { describe, it, expect } from "vitest";
import {
	reduceProviderAction,
	validateSecretRefLocations,
	mapConfigIssues,
	countSecretsForProvider,
	formatSecretRemovalMessage,
	type ProviderManagerState,
	type ApiState,
	type SecretSlot,
} from "./state.js";
import { isUnderProviderPath, categorizeSecretSlot } from "../../config-mutations.js";

function emptyState(): ProviderManagerState {
	return {
		baseline: { providers: {} },
		draft: { providers: {} },
		revision: "missing",
		secretSlots: [],
		selectedProvider: null,
		rawText: null,
		dirty: false,
		errors: [],
	};
}

function apiState(providers: Record<string, unknown>): ApiState {
	return {
		models: { providers: providers as ApiState["models"]["providers"] },
		revision: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
		secretSlots: [],
		providerFields: [],
		modelFields: [],
	};
}

function stateWithProvider(key: string, config: Record<string, unknown> = {}): ProviderManagerState {
	const providers = { [key]: config } as ProviderManagerState["draft"]["providers"];
	return {
		...emptyState(),
		baseline: { providers },
		draft: { providers },
		selectedProvider: key,
	};
}

describe("reduceProviderAction", () => {
	describe("load", () => {
		it("sets baseline and draft from api state", () => {
			const s = apiState({ test: { baseUrl: "http://example.com" } });
			const r = reduceProviderAction(emptyState(), { type: "load", apiState: s });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(r.value.draft).toEqual(s.models);
			expect(r.value.selectedProvider).toBe("test");
			expect(r.value.dirty).toBe(false);
		});

		it("selects first sorted provider", () => {
			const s = apiState({ zebra: {}, alpha: {} });
			const r = reduceProviderAction(emptyState(), { type: "load", apiState: s });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(r.value.selectedProvider).toBe("alpha");
		});
	});

	describe("create", () => {
		it("adds a new provider via shared mutation", () => {
			const r = reduceProviderAction(emptyState(), { type: "create", key: "my-provider" });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			const p = r.value.draft as Record<string, unknown>;
			expect((p.providers as Record<string, unknown>)["my-provider"]).toEqual({});
			expect(r.value.selectedProvider).toBe("my-provider");
			expect(r.value.dirty).toBe(true);
		});

		it("rejects empty key", () => {
			const r = reduceProviderAction(emptyState(), { type: "create", key: "  " });
			expect(r.ok).toBe(false);
		});

		it("rejects duplicate key", () => {
			const s = stateWithProvider("existing");
			const r = reduceProviderAction(s, { type: "create", key: "existing" });
			expect(r.ok).toBe(false);
		});
	});

	describe("rename", () => {
		it("renames a provider", () => {
			const s = stateWithProvider("old", { baseUrl: "http://example.com" });
			const r = reduceProviderAction(s, { type: "rename", from: "old", to: "new", conflict: "reject" });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			const p = r.value.draft as Record<string, unknown>;
			const providers = p.providers as Record<string, unknown>;
			expect(providers["old"]).toBeUndefined();
			expect(providers["new"]).toEqual({ baseUrl: "http://example.com" });
			expect(r.value.selectedProvider).toBe("new");
		});

		it("rejects rename when target exists without overwrite", () => {
			const s = {
				...stateWithProvider("old"),
				draft: { providers: { old: {}, new: {} } },
				baseline: { providers: { old: {}, new: {} } },
			};
			const r = reduceProviderAction(s, { type: "rename", from: "old", to: "new", conflict: "reject" });
			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(r.error.message).toMatch(/confirm overwrite/i);
		});

		it("allows overwrite-confirmed when target exists and source has no secrets", () => {
			const s: ProviderManagerState = {
				...stateWithProvider("old", { baseUrl: "x" }),
				draft: { providers: { old: { baseUrl: "x" }, new: { baseUrl: "y" } } },
				baseline: { providers: { old: { baseUrl: "x" }, new: { baseUrl: "y" } } },
				secretSlots: [{ ref: "pi-vendor-secret:tgt", path: "/providers/new/apiKey" }],
			};
			const r = reduceProviderAction(s, {
				type: "rename",
				from: "old",
				to: "new",
				conflict: "overwrite-confirmed",
			});
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect((r.value.draft.providers as Record<string, unknown>)["old"]).toBeUndefined();
			expect((r.value.draft.providers as Record<string, unknown>)["new"]).toEqual({ baseUrl: "x" });
			// target secrets dropped after confirmed overwrite
			expect(r.value.secretSlots).toEqual([]);
		});

		it("rejects rename when source has secret refs even with overwrite-confirmed", () => {
			const s: ProviderManagerState = {
				...stateWithProvider("old", { apiKey: "pi-vendor-secret:abcd1234" }),
				secretSlots: [{ ref: "pi-vendor-secret:abcd1234", path: "/providers/old/apiKey" }],
			};
			const r = reduceProviderAction(s, {
				type: "rename",
				from: "old",
				to: "new",
				conflict: "overwrite-confirmed",
			});
			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(r.error.message).toMatch(/configured secret/i);
		});

		it("does not treat /providers/foobar as under /providers/foo", () => {
			const s: ProviderManagerState = {
				...stateWithProvider("foo", {}),
				draft: { providers: { foo: {}, foobar: { apiKey: "pi-vendor-secret:x" } } },
				baseline: { providers: { foo: {}, foobar: { apiKey: "pi-vendor-secret:x" } } },
				secretSlots: [{ ref: "pi-vendor-secret:x", path: "/providers/foobar/apiKey" }],
			};
			const r = reduceProviderAction(s, { type: "rename", from: "foo", to: "renamed", conflict: "reject" });
			expect(r.ok).toBe(true);
		});
	});

	describe("delete", () => {
		it("deletes a provider", () => {
			const s = stateWithProvider("target");
			const r = reduceProviderAction(s, { type: "delete", key: "target" });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			const p = r.value.draft as Record<string, unknown>;
			expect((p.providers as Record<string, unknown>)["target"]).toBeUndefined();
			expect(r.value.selectedProvider).toBeNull();
			expect(r.value.dirty).toBe(true);
		});

		it("selects sorted next after delete", () => {
			const s: ProviderManagerState = {
				...emptyState(),
				draft: { providers: { a: {}, b: {}, c: {} } },
				baseline: { providers: { a: {}, b: {}, c: {} } },
				selectedProvider: "b",
			};
			const r = reduceProviderAction(s, { type: "delete", key: "b" });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(r.value.selectedProvider).toBe("c");
		});
	});

	describe("set-field", () => {
		it("sets a field value", () => {
			const s = stateWithProvider("p");
			const r = reduceProviderAction(s, {
				type: "set-field",
				key: "p",
				field: "baseUrl",
				value: "http://example.com",
			});
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			const p = r.value.draft as Record<string, unknown>;
			expect(((p.providers as Record<string, unknown>)["p"] as Record<string, unknown>)["baseUrl"]).toBe(
				"http://example.com",
			);
		});

		it("preserves empty string values (Add setting)", () => {
			const s = stateWithProvider("p", { name: "Test" });
			const r = reduceProviderAction(s, { type: "set-field", key: "p", field: "name", value: "" });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			const p = r.value.draft as Record<string, unknown>;
			expect(((p.providers as Record<string, unknown>)["p"] as Record<string, unknown>)["name"]).toBe("");
		});

		it("common empty clear is expressed as remove-field by callers", () => {
			// Reducers keep set-field empty for optional fields; common clear uses remove-field.
			const s = stateWithProvider("p", { baseUrl: "http://example.com", name: "x" });
			const cleared = reduceProviderAction(s, { type: "remove-field", key: "p", field: "baseUrl" });
			expect(cleared.ok).toBe(true);
			if (!cleared.ok) return;
			const p = cleared.value.draft as Record<string, unknown>;
			expect(((p.providers as Record<string, unknown>)["p"] as Record<string, unknown>)["baseUrl"]).toBeUndefined();
			expect(((p.providers as Record<string, unknown>)["p"] as Record<string, unknown>)["name"]).toBe("x");
		});
	});

	describe("remove-field", () => {
		it("removes an existing field", () => {
			const s = stateWithProvider("p", { name: "Test" });
			const r = reduceProviderAction(s, { type: "remove-field", key: "p", field: "name" });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			const p = r.value.draft as Record<string, unknown>;
			expect(((p.providers as Record<string, unknown>)["p"] as Record<string, unknown>)["name"]).toBeUndefined();
		});
	});

	describe("raw buffer", () => {
		it("set-raw-text updates buffer without mutating draft", () => {
			const s = stateWithProvider("p");
			const r = reduceProviderAction(s, { type: "set-raw-text", text: "{broken" });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(r.value.rawText).toBe("{broken");
			expect(r.value.draft).toEqual(s.draft);
		});

		it("apply-raw applies valid JSON", () => {
			const s = emptyState();
			const json = JSON.stringify({ providers: { test: { baseUrl: "http://example.com" } } });
			const r = reduceProviderAction(s, { type: "apply-raw", text: json });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(r.value.draft).toEqual({ providers: { test: { baseUrl: "http://example.com" } } });
			expect(r.value.selectedProvider).toBe("test");
			expect(r.value.rawText).toBeNull();
		});

		it("rejects invalid JSON without mutating draft", () => {
			const s = stateWithProvider("p");
			const r = reduceProviderAction(s, { type: "apply-raw", text: "not json" });
			expect(r.ok).toBe(false);
			// caller keeps rawText via set-raw-text; draft unchanged by failed apply
			expect(s.draft).toEqual({ providers: { p: {} } });
		});

		it("uses recovery-oriented copy for invalid raw JSON", () => {
			const r = reduceProviderAction(stateWithProvider("p"), { type: "apply-raw", text: "not json" });
			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(r.error.message).toBe("Enter valid JSON before applying it to the draft");
		});

		it("rejects JSON without providers", () => {
			const r = reduceProviderAction(emptyState(), { type: "apply-raw", text: "{}" });
			expect(r.ok).toBe(false);
		});

		it("requires confirmation when raw removes secrets", () => {
			const s: ProviderManagerState = {
				...stateWithProvider("p", { apiKey: "pi-vendor-secret:abc" }),
				secretSlots: [{ ref: "pi-vendor-secret:abc", path: "/providers/p/apiKey" }],
			};
			const json = JSON.stringify({ providers: { p: { apiKey: "new-literal" } } });
			const blocked = reduceProviderAction(s, { type: "apply-raw", text: json });
			expect(blocked.ok).toBe(false);
			if (blocked.ok) return;
			expect(blocked.error.message).toMatch(/apiKey secret/i);

			const confirmed = reduceProviderAction(s, {
				type: "apply-raw",
				text: json,
				confirmSecretRemoval: true,
			});
			expect(confirmed.ok).toBe(true);
			if (!confirmed.ok) return;
			expect(confirmed.value.secretSlots).toEqual([]);
		});
	});

	describe("select", () => {
		it("selects an existing provider", () => {
			const s = stateWithProvider("p");
			const r = reduceProviderAction(s, { type: "select", key: "p" });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(r.value.selectedProvider).toBe("p");
		});

		it("rejects non-existing provider", () => {
			const s = stateWithProvider("p");
			const r = reduceProviderAction(s, { type: "select", key: "nope" });
			expect(r.ok).toBe(false);
		});
	});
});

describe("validateSecretRefLocations", () => {
	it("accepts valid single-location ref", () => {
		const slots: SecretSlot[] = [{ ref: "pi-vendor-secret:abc", path: "/providers/test/apiKey" }];
		const draft = { providers: { test: { apiKey: "pi-vendor-secret:abc" } } };
		const r = validateSecretRefLocations(draft, slots);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.removed).toEqual([]);
		expect(r.value.moved).toEqual([]);
	});

	it("classifies missing ref as removed (confirmable)", () => {
		const slots: SecretSlot[] = [{ ref: "pi-vendor-secret:abc", path: "/providers/test/apiKey" }];
		const draft = { providers: { test: { apiKey: "replaced-value" } } };
		const r = validateSecretRefLocations(draft, slots);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.removed).toEqual(slots);
	});

	it("rejects moved/copied ref as hard error", () => {
		const slots: SecretSlot[] = [{ ref: "pi-vendor-secret:abc", path: "/providers/test/apiKey" }];
		const draft = {
			providers: {
				test: {
					headers: { Authorization: "pi-vendor-secret:abc" },
				},
			},
		};
		const r = validateSecretRefLocations(draft, slots);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error.message).toMatch(/moved/i);
	});

	it("rejects unknown ref", () => {
		const slots: SecretSlot[] = [];
		const draft = { providers: { test: { apiKey: "pi-vendor-secret:unknown" } } };
		const r = validateSecretRefLocations(draft, slots);
		expect(r.ok).toBe(false);
	});

	it("rejects duplicated ref", () => {
		const slots: SecretSlot[] = [{ ref: "pi-vendor-secret:abc", path: "/providers/test/apiKey" }];
		const draft = {
			providers: {
				test: {
					apiKey: "pi-vendor-secret:abc",
					headers: { X: "pi-vendor-secret:abc" },
				},
			},
		};
		const r = validateSecretRefLocations(draft, slots);
		expect(r.ok).toBe(false);
	});
});

describe("segment-safe SecretRef prefixes", () => {
	it("matches only exact provider segment", () => {
		expect(isUnderProviderPath("/providers/foo/apiKey", "foo")).toBe(true);
		expect(isUnderProviderPath("/providers/foobar/apiKey", "foo")).toBe(false);
		expect(isUnderProviderPath("/providers/foo", "foo")).toBe(true);
	});

	it("categorizes slots", () => {
		expect(categorizeSecretSlot("/providers/p/apiKey")).toBe("apiKey");
		expect(categorizeSecretSlot("/providers/p/headers/Authorization")).toBe("header");
		expect(categorizeSecretSlot("/providers/p/models/0/headers/X")).toBe("header");
		expect(categorizeSecretSlot("/providers/p/compat")).toBe("other");
	});

	it("counts secrets for provider without foobar collision", () => {
		const slots: SecretSlot[] = [
			{ ref: "a", path: "/providers/foo/apiKey" },
			{ ref: "b", path: "/providers/foobar/apiKey" },
			{ ref: "c", path: "/providers/foo/headers/X" },
		];
		const counts = countSecretsForProvider(slots, "foo");
		expect(counts).toEqual({ total: 2, apiKey: 1, header: 1, other: 0 });
		expect(formatSecretRemovalMessage(slots.slice(0, 1))).toMatch(/1 apiKey/);
	});

	it("explains that secret deletion happens only after Save & close", () => {
		const slots: SecretSlot[] = [{ ref: "x", path: "/providers/p/apiKey" }];
		expect(formatSecretRemovalMessage(slots)).toContain("only when you save & close");
	});
});

describe("mapConfigIssues", () => {
	it("maps provider/field pointers", () => {
		const issues = mapConfigIssues(
			[{ path: "/providers/acme/baseUrl", message: "bad url" }],
			"invalid",
		);
		expect(issues).toEqual([
			{ message: "bad url", path: "/providers/acme/baseUrl", provider: "acme", field: "baseUrl" },
		]);
	});

	it("falls back when empty", () => {
		expect(mapConfigIssues([], "boom")).toEqual([{ message: "boom" }]);
	});
});
