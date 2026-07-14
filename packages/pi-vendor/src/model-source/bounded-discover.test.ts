import { describe, expect, it, vi } from "vitest";
import { discoverModelIds, type BoundedFetchResponse } from "./bounded-discover.js";
import { ModelSourceError } from "./model-source-error.js";

function fakeResponse(
	overrides: Partial<BoundedFetchResponse> & { jsonBody?: unknown },
): BoundedFetchResponse {
	const jsonBody = overrides.jsonBody;
	const { jsonBody: _, ...rest } = overrides;
	const text = jsonBody !== undefined ? JSON.stringify(jsonBody) : "";
	const encoder = new TextEncoder();
	const encoded = encoder.encode(text);
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoded);
			controller.close();
		},
	});
	return {
		ok: true,
		status: 200,
		headers: new Headers(),
		body: stream,
		...rest,
	};
}

describe("discoverModelIds", () => {
	it("discovers and returns sorted unique model ids", async () => {
		const fetchImpl = vi.fn(async (_input: string, _init: any) => {
			return fakeResponse({
				jsonBody: { data: [{ id: "b" }, { id: "a" }, { id: "b" }, { id: 1 }, {}] },
			});
		});

		const ids = await discoverModelIds(
			{ baseUrl: "https://example.com/v1" },
			{ fetchImpl },
		);

		expect(ids).toEqual(["a", "b"]);
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://example.com/v1/models",
			expect.objectContaining({ method: "GET", redirect: "error" }),
		);
	});

	it("rejects non-http base URLs", async () => {
		await expect(discoverModelIds(
			{ baseUrl: "ftp://example.com" },
			{ fetchImpl: vi.fn() },
		)).rejects.toThrow(ModelSourceError);
	});

	it("rejects URLs with credentials", async () => {
		await expect(discoverModelIds(
			{ baseUrl: "https://user:pass@example.com/v1" },
			{ fetchImpl: vi.fn() },
		)).rejects.toThrow(ModelSourceError);
	});

	it("appends /models to base URL path", async () => {
		const fetchImpl = vi.fn(async (_input: string, _init: any) => {
			return fakeResponse({ jsonBody: { data: [] } });
		});

		await discoverModelIds(
			{ baseUrl: "https://example.com/custom/api/" },
			{ fetchImpl },
		);

		expect(fetchImpl).toHaveBeenCalledWith(
			"https://example.com/custom/api/models",
			expect.any(Object),
		);
	});

	it("adds Bearer auth when apiKey is provided and no Authorization header exists", async () => {
		const fetchImpl = vi.fn(async (_input: string, init: any) => {
			expect(init.headers["Authorization"]).toBe("Bearer secret");
			return fakeResponse({ jsonBody: { data: [] } });
		});

		await discoverModelIds(
			{ baseUrl: "https://example.com/v1", apiKey: "secret" },
			{ fetchImpl },
		);
	});

	it("does not add Bearer when Authorization header already exists", async () => {
		const fetchImpl = vi.fn(async (_input: string, init: any) => {
			expect(init.headers["Authorization"]).toBe("custom-auth");
			expect(init.headers["Authorization"]).not.toBe("Bearer secret");
			return fakeResponse({ jsonBody: { data: [] } });
		});

		await discoverModelIds(
			{
				baseUrl: "https://example.com/v1",
				apiKey: "secret",
				headers: { Authorization: "custom-auth" },
			},
			{ fetchImpl },
		);
	});

	it("throws on non-2xx status", async () => {
		const fetchImpl = vi.fn(async () => fakeResponse({ ok: false, status: 401 }));
		await expect(discoverModelIds(
			{ baseUrl: "https://example.com/v1" },
			{ fetchImpl },
		)).rejects.toThrow(ModelSourceError);
	});

	it("throws on invalid JSON response", async () => {
		const fetchImpl = vi.fn(async () => fakeResponse({
			jsonBody: "not-an-object", // will produce JSON string
		}));
		// This test: JSON.parse('"not-an-object"') succeeds but data won't be an array
		// Let's test a different invalid case
		const fetchImpl2 = vi.fn(async () => {
			const encoder = new TextEncoder();
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode("not json"));
					controller.close();
				},
			});
			return { ok: true, status: 200, headers: new Headers(), body: stream };
		});
		await expect(discoverModelIds(
			{ baseUrl: "https://example.com/v1" },
			{ fetchImpl: fetchImpl2 },
		)).rejects.toThrow("Invalid JSON response");
	});

	it("rejects command credentials without initial provider", async () => {
		await expect(discoverModelIds(
			{ baseUrl: "https://example.com/v1", apiKey: "!my-cmd" },
			{ fetchImpl: vi.fn() },
		)).rejects.toThrow(ModelSourceError);
	});

	it("trusts commands when initialProvider matches", async () => {
		const runCommand = vi.fn(async (_body: string, _opts: any) => "secret-from-cmd");
		const fetchImpl = vi.fn(async (_input: string, init: any) => {
			expect(init.headers["Authorization"]).toBe("Bearer secret-from-cmd");
			return fakeResponse({ jsonBody: { data: [] } });
		});

		await discoverModelIds(
			{ baseUrl: "https://example.com/v1", apiKey: "!my-cmd" },
			{
				initialProvider: { apiKey: "!my-cmd" },
				runCommand,
				fetchImpl,
			},
		);
		expect(runCommand).toHaveBeenCalledTimes(1);
	});

	it("rejects changed command when initialProvider differs", async () => {
		await expect(discoverModelIds(
			{ baseUrl: "https://example.com/v1", apiKey: "!new-cmd" },
			{
				initialProvider: { apiKey: "!old-cmd" },
				fetchImpl: vi.fn(),
			},
		)).rejects.toThrow(ModelSourceError);
	});

	it("respects the 10k id limit", async () => {
		const ids = Array.from({ length: 15_000 }, (_, i) => ({ id: `model-${i}` }));
		const fetchImpl = vi.fn(async () => fakeResponse({ jsonBody: { data: ids } }));

		const result = await discoverModelIds(
			{ baseUrl: "https://example.com/v1" },
			{ fetchImpl },
		);

		expect(result).toHaveLength(10_000);
	});

	it("sorts ids with code-unit comparator", async () => {
		const fetchImpl = vi.fn(async () => fakeResponse({
			jsonBody: { data: [{ id: "z" }, { id: "A" }, { id: "a" }, { id: "0" }] },
		}));

		const result = await discoverModelIds(
			{ baseUrl: "https://example.com/v1" },
			{ fetchImpl },
		);

		expect(result).toEqual(["0", "A", "a", "z"]);
	});
});
