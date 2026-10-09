import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Point the spill root at a temp dir of our own. vi.mock is hoisted, so the
// holder is filled in at top level below — before ./tools.js is imported
// (dynamically, inside each test) and reads tmpdir() for its spill root.
const spillRoot = vi.hoisted(() => ({ value: "" }));
vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return { ...actual, tmpdir: () => spillRoot.value };
});
spillRoot.value = await mkdtemp(join(tmpdir(), "spill-cleanup-test-"));

// web_fetch transports through undici's fetch directly; mock it (like
// html-timeout.test.ts) instead of hitting the network, and stub DNS.
const fetchMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("undici", async (importOriginal) => {
	const actual = await importOriginal<typeof import("undici")>();
	return { ...actual, fetch: fetchMock.fn };
});
vi.mock("node:dns/promises", () => ({
	lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const fetchOverflow = async (body: string) => {
	const { registerWebFetchTool } = await import("./tools.js");
	let execute: ((...args: unknown[]) => Promise<unknown>) | undefined;
	registerWebFetchTool({
		registerTool: (definition: { execute: (...args: unknown[]) => Promise<unknown> }) => {
			execute = definition.execute;
		},
	} as never);
	const result = (await execute!("id", { url: "https://public.example/big", raw: false }, undefined, undefined)) as {
		details: { fullOutputPath?: string };
	};
	if (!result.details.fullOutputPath) throw new Error("expected spill for oversized content");
	return result.details.fullOutputPath;
};

// Build a body that certainly exceeds the default line/byte truncation limits.
const bigBody = () => Array.from({ length: 6000 }, (_, i) => `line ${i} — ${"x".repeat(40)}`).join("\n");

describe("web_fetch spill lifecycle (BYTE-6 A1)", () => {
	beforeEach(async () => {
		vi.resetModules(); // fresh spill module state (sweep throttle) per test
		await rm(join(spillRoot.value, "byte-web-fetch"), { recursive: true, force: true }).catch(() => {});
	});
	afterEach(() => rm(join(spillRoot.value, "byte-web-fetch"), { recursive: true, force: true }).catch(() => {}));

	it("spills overflow into the package-owned temp root", async () => {
		fetchMock.fn.mockImplementation(async () => new Response(bigBody(), { headers: { "content-type": "text/plain" } }));
		const file = await fetchOverflow(bigBody());
		expect(file.startsWith(join(spillRoot.value, "byte-web-fetch"))).toBe(true);
		expect(await readFile(file, "utf8")).toContain("line 5999");
	});

	it("removes spill files older than the TTL on the next spill", async () => {
		fetchMock.fn.mockImplementation(async () => new Response(bigBody(), { headers: { "content-type": "text/plain" } }));

		// Seed an old orphan (8 days old, beyond the 7-day TTL).
		const oldDir = join(spillRoot.value, "byte-web-fetch", "fetch-stale");
		await mkdir(oldDir, { recursive: true });
		await writeFile(join(oldDir, "content.txt"), "stale");
		const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
		await utimes(oldDir, stale, stale);

		await fetchOverflow(bigBody());

		await expect(stat(oldDir)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("keeps fresh spill files across sweeps", async () => {
		// A fresh Response per call: a Response body can only be consumed once.
		fetchMock.fn.mockImplementation(async () => new Response(bigBody(), { headers: { "content-type": "text/plain" } }));
		const first = await fetchOverflow(bigBody());
		const second = await fetchOverflow(bigBody());
		expect(first).not.toBe(second);
		await expect(readFile(first, "utf8")).resolves.toContain("line 5999");
		await expect(readFile(second, "utf8")).resolves.toContain("line 5999");
	});
});
