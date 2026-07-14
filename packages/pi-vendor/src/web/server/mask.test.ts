import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ModelsSnapshot } from "../../config-core.js";
import { maskSnapshot, hydrateCommitDraft, hydrateProviderCredentials, type SecretRef, type StoredSecretSlot } from "./mask.js";

function snapshot(models: Record<string, unknown>, revision = "sha256:0000000000000000000000000000000000000000000000000000000000000000" as const): ModelsSnapshot {
	return { models: models as ModelsSnapshot["models"], revision };
}

describe("secret masking", () => {
	it("replaces literal apiKey and headers with unique SecretRefs", () => {
		const snap = snapshot({
			providers: {
				p1: {
					apiKey: "sk-literal-key",
					headers: { "X-Custom": "header-value" },
				},
			},
		});

		const { draft, slots, secrets } = maskSnapshot(snap);
		const p1 = (draft.providers as Record<string, Record<string, unknown>>).p1!;

		expect(typeof p1.apiKey).toBe("string");
		expect(p1.apiKey).toMatch(/^pi-vendor-secret:/);
		expect(p1.apiKey).not.toBe("sk-literal-key");

		const headers = p1.headers as Record<string, string>;
		expect(headers["X-Custom"]).toMatch(/^pi-vendor-secret:/);

		// Slots should be recorded
		expect(slots.length).toBeGreaterThanOrEqual(2);
		expect(secrets.size).toBeGreaterThanOrEqual(2);

		// Each ref should be unique
		const refs = slots.map((s) => s.ref);
		expect(new Set(refs).size).toBe(refs.length);
	});

	it("does not mask env references or commands", () => {
		const snap = snapshot({
			providers: {
				p1: {
					apiKey: "$ENV_VAR",
					headers: { Authorization: "!command get-token" },
				},
			},
		});

		const { draft } = maskSnapshot(snap);
		const p1 = (draft.providers as Record<string, Record<string, unknown>>).p1!;

		expect(p1.apiKey).toBe("$ENV_VAR");
		const headers = p1.headers as Record<string, string>;
		expect(headers.Authorization).toBe("!command get-token");
	});

	it("masks model-level and modelOverride headers", () => {
		const snap = snapshot({
			providers: {
				p1: {
					models: [
						{ id: "m1", headers: { "X-Model": "secret1" } },
						{ id: "m2", headers: { "X-Model": "secret2" } },
					],
					modelOverrides: {
						"override-1": { headers: { "X-Override": "secret3" } },
					},
				},
			},
		});

		const { draft, secrets } = maskSnapshot(snap);
		const p1 = (draft.providers as Record<string, Record<string, unknown>>).p1!;
		const models = p1.models as Array<Record<string, unknown>>;

		expect(models[0]!.headers).toMatchObject({ "X-Model": expect.stringMatching(/^pi-vendor-secret:/) });
		expect(models[1]!.headers).toMatchObject({ "X-Model": expect.stringMatching(/^pi-vendor-secret:/) });

		const overrides = p1.modelOverrides as Record<string, Record<string, unknown>>;
		expect(overrides["override-1"]!.headers).toMatchObject({ "X-Override": expect.stringMatching(/^pi-vendor-secret:/) });
	});

	it("returns empty draft for missing providers", () => {
		const snap = snapshot({ providers: {} });
		const { draft, slots, secrets } = maskSnapshot(snap);
		expect(draft).toEqual({ providers: {} });
		expect(slots).toEqual([]);
		expect(secrets.size).toBe(0);
	});
});

describe("secret hydration", () => {
	const baseRevision = "sha256:0000000000000000000000000000000000000000000000000000000000000000" as const;

	function makeSecret(value: string, path: string): { ref: SecretRef; slot: StoredSecretSlot } {
		const ref = `pi-vendor-secret:${randomBytes(16).toString("base64url")}` as SecretRef;
		return {
			ref,
			slot: { ref, path, originalValue: value, baseRevision },
		};
	}

	it("hydrates known refs back to original values", () => {
		const { ref, slot } = makeSecret("sk-test-key", "/providers/p1/apiKey");
		const secrets = new Map<SecretRef, StoredSecretSlot>([[ref, slot]]);

		const draft = {
			providers: {
				p1: { apiKey: ref, baseUrl: "https://example.test/v1" },
			},
		};

		const result = hydrateCommitDraft(draft, secrets, baseRevision);
		expect((result.providers as Record<string, Record<string, unknown>>).p1!.apiKey).toBe("sk-test-key");
	});

	it("throws on unresolved refs remaining after hydration", () => {
		const unknownRef = `pi-vendor-secret:${randomBytes(16).toString("base64url")}` as SecretRef;

		const draft = {
			providers: {
				p1: { apiKey: unknownRef },
			},
		};

		expect(() => hydrateCommitDraft(draft, new Map(), baseRevision)).toThrow();
	});

	it("rejects moved/copied refs (original path check)", () => {
		const { ref, slot } = makeSecret("sk-test-key", "/providers/p1/apiKey");
		const secrets = new Map<SecretRef, StoredSecretSlot>([[ref, slot]]);

		// ref moved to wrong path — should be rejected
		const draft = {
			providers: {
				p2: { apiKey: ref },
			},
		};

		expect(() => hydrateCommitDraft(draft, secrets, baseRevision)).toThrow(
			/moved or copied/,
		);
	});
});

describe("provider credential hydration (non-consuming)", () => {
	const baseRevision = "sha256:0000000000000000000000000000000000000000000000000000000000000000" as const;

	function makeSecret(value: string, path: string): { ref: SecretRef; slot: StoredSecretSlot } {
		const ref = `pi-vendor-secret:${randomBytes(16).toString("base64url")}` as SecretRef;
		return {
			ref,
			slot: { ref, path, originalValue: value, baseRevision },
		};
	}

	it("hydrates apiKey and headers without consuming slots", () => {
		const { ref: apiRef, slot: apiSlot } = makeSecret("sk-api", "/providers/p1/apiKey");
		const { ref: headerRef, slot: headerSlot } = makeSecret("hdr-val", "/providers/p1/headers/X-Auth");
		const secrets = new Map<SecretRef, StoredSecretSlot>([[apiRef, apiSlot], [headerRef, headerSlot]]);

		const provider = {
			apiKey: apiRef,
			headers: { "X-Auth": headerRef },
		} as unknown as Parameters<typeof hydrateProviderCredentials>[1];

		const result = hydrateProviderCredentials("p1", provider, secrets, baseRevision);

		expect(result.apiKey).toBe("sk-api");
		expect(result.headers).toEqual({ "X-Auth": "hdr-val" });
		// Non-consuming: secrets map unchanged
		expect(secrets.has(apiRef)).toBe(true);
		expect(secrets.has(headerRef)).toBe(true);
	});

	it("throws on unknown ref in hydrateProviderCredentials", () => {
		const unknownRef = `pi-vendor-secret:${randomBytes(16).toString("base64url")}` as SecretRef;
		const provider = { apiKey: unknownRef } as unknown as Parameters<typeof hydrateProviderCredentials>[1];
		const baseRevision = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
		expect(() => hydrateProviderCredentials("p1", provider, new Map(), baseRevision)).toThrowError(/Unknown secret reference/);
	});

	it("throws on moved/copied ref in hydrateProviderCredentials apiKey", () => {
		const wrongPath = "/providers/p2/apiKey";
		const { ref: apiRef, slot } = makeSecret("sk-api", wrongPath);
		const secrets = new Map<SecretRef, StoredSecretSlot>([[apiRef, slot]]);
		const provider = { apiKey: apiRef } as unknown as Parameters<typeof hydrateProviderCredentials>[1];
		expect(() => hydrateProviderCredentials("p1", provider, secrets, baseRevision)).toThrowError(/moved or copied/);
	});

	it("throws on wrong-revision ref in hydrateProviderCredentials", () => {
		const { ref: apiRef, slot } = makeSecret("sk-api", "/providers/p1/apiKey");
		const secrets = new Map<SecretRef, StoredSecretSlot>([[apiRef, slot]]);
		const wrongRevision = "sha256:deadbeef00000000000000000000000000000000000000000000000000000000";
		const provider = { apiKey: apiRef } as unknown as Parameters<typeof hydrateProviderCredentials>[1];
		expect(() => hydrateProviderCredentials("p1", provider, secrets, wrongRevision)).toThrowError(/wrong revision/);
	});

	it("throws on moved/copied header ref in hydrateProviderCredentials", () => {
		const { ref: headerRef, slot } = makeSecret("hdr-val", "/providers/p1/headers/X-Other");
		const secrets = new Map<SecretRef, StoredSecretSlot>([[headerRef, slot]]);
		const provider = { headers: { "X-Auth": headerRef } } as unknown as Parameters<typeof hydrateProviderCredentials>[1];
		expect(() => hydrateProviderCredentials("p1", provider, secrets, baseRevision)).toThrowError(/moved or copied/);
	});
});
