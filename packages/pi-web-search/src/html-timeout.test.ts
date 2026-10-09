import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchViaGenericHtml, WEB_FETCH_TOTAL_TIMEOUT_MS } from "./html.js";

// The total-timeout contract is observable at the signal that reaches the
// transport, so mock undici's fetch at the module boundary: no real network,
// no dependence on undici mock-agent dispatcher plumbing.
const fetchMock = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("undici", async (importOriginal) => {
	const actual = await importOriginal<typeof import("undici")>();
	return {
		...actual,
		fetch: fetchMock.fn,
	};
});

// html.ts imports { fetch as undiciFetch } from "undici" — the mock above
// replaces that binding. DNS is bypassed the same way.
vi.mock("node:dns/promises", () => ({
	lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe("fetchViaGenericHtml total time budget (BYTE-5 #4)", () => {
	it("aborts the whole fetch when the total wall-clock budget expires", async () => {
		fetchMock.fn.mockImplementation(async (_url: string, init?: { signal?: AbortSignal }) => {
			// Reject when the composed signal fires, like undici does.
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					reject(new Error("The operation was aborted due to timeout", { cause: init.signal?.reason }));
				});
			});
		});

		const started = Date.now();
		await expect(fetchViaGenericHtml("https://public.example/drip", false)).rejects.toThrow(/aborted|timeout/i);
		const elapsed = Date.now() - started;
		// Ended by the budget, not instantly by something else.
		expect(elapsed).toBeGreaterThanOrEqual(WEB_FETCH_TOTAL_TIMEOUT_MS - 1000);
		expect(elapsed).toBeLessThan(WEB_FETCH_TOTAL_TIMEOUT_MS + 5000);
	}, 45_000);

	it("uses the caller-supplied budget parameter", async () => {
		fetchMock.fn.mockImplementation(async (_url: string, init?: { signal?: AbortSignal }) => {
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new Error("aborted by test budget")));
			});
		});
		const started = Date.now();
		await expect(fetchViaGenericHtml("https://public.example/drip", false, undefined, 250)).rejects.toThrow();
		expect(Date.now() - started).toBeLessThan(20_000);
	}, 20_000);

	it("still honors caller cancellation ahead of the budget", async () => {
		fetchMock.fn.mockImplementation(async (_url: string, init?: { signal?: AbortSignal }) => {
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("This operation was aborted", { cause: init.signal?.reason })),
				);
			});
		});
		const controller = new AbortController();
		const pending = fetchViaGenericHtml("https://public.example/drip", false, controller.signal, 60_000);
		setTimeout(() => controller.abort(new Error("user cancelled")), 50);
		// undici wraps the abort as a generic "operation aborted" error whose
		// cause carries the caller's reason — assert on the cause.
		await expect(pending).rejects.toMatchObject({
			cause: expect.objectContaining({ message: "user cancelled" }),
		});
	}, 20_000);

	it("returns normally when the body completes inside the budget", async () => {
		fetchMock.fn.mockResolvedValue(
			new Response("plain body", { status: 200, headers: { "content-type": "text/plain" } }),
		);
		const content = await fetchViaGenericHtml("https://public.example/fast", false);
		expect(content.text).toBe("plain body");
	});
});
