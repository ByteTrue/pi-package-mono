import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectOfficialCandidates, findOfficialCatalogPath, formatOfficialCandidate, stripOfficialRoutingFields } from "./official-catalog.js";

describe("official catalog helpers", () => {

	it("uses the first active Pi root's generated catalog", () => {
		const firstRoot = mkdtempSync(join(tmpdir(), "pi-vendor-catalog-first-"));
		const secondRoot = mkdtempSync(join(tmpdir(), "pi-vendor-catalog-second-"));
		const catalogPath = join(firstRoot, "node_modules/@earendil-works/pi-ai/dist/models.generated.js");
		try {
			mkdirSync(join(firstRoot, "node_modules/@earendil-works/pi-ai/dist"), { recursive: true });
			mkdirSync(join(secondRoot, "node_modules/@earendil-works/pi-ai/dist"), { recursive: true });
			writeFileSync(catalogPath, "export const MODELS = {};\n");
			writeFileSync(join(secondRoot, "node_modules/@earendil-works/pi-ai/dist/models.generated.js"), "export const MODELS = {};\n");

			expect(findOfficialCatalogPath([firstRoot, secondRoot])).toBe(catalogPath);
		} finally {
			rmSync(firstRoot, { recursive: true, force: true });
			rmSync(secondRoot, { recursive: true, force: true });
		}
	});

	// The roots handed to candidateCatalogPaths in production are pi-coding-agent
	// *package directories*, not install prefixes. Regression for the shipped bug
	// where every lookup missed and /vendor blamed the model id.
	// See byissue/issues/113-x-vendor-catalog-lookup.md.
	describe("resolves pi-ai from real install layouts", () => {
		/** Build a package dir plus the catalog path the layout should reach. */
		function layout(mk: (root: string) => string): { root: string; catalogPath: string } {
			const root = mkdtempSync(join(tmpdir(), "pi-vendor-catalog-layout-"));
			const catalogPath = mk(root);
			mkdirSync(dirname(catalogPath), { recursive: true });
			writeFileSync(catalogPath, "export const MODELS = {};\n");
			// The root must look like the pi-coding-agent package itself.
			writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
			return { root, catalogPath };
		}

		it("finds a sibling pi-ai in a virtual-store entry (pnpm/aube)", () => {
			// <store>/@earendil-works+pi-coding-agent@1.1.0-hash/node_modules/@earendil-works/{pi-coding-agent,pi-ai}
			const { root, catalogPath } = layout((entry) =>
				join(entry, "node_modules", "@earendil-works", "pi-ai", "dist", "models.generated.js"),
			);
			try {
				const pkgDir = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
				mkdirSync(pkgDir, { recursive: true });
				writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));

				expect(findOfficialCatalogPath([pkgDir])).toBe(catalogPath);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("finds a hoisted pi-ai beside pi-coding-agent", () => {
			// <project>/node_modules/@earendil-works/{pi-coding-agent,pi-ai}
			const { root, catalogPath } = layout((dir) =>
				join(dir, "node_modules", "@earendil-works", "pi-ai", "dist", "models.generated.js"),
			);
			try {
				const pkgDir = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
				mkdirSync(pkgDir, { recursive: true });
				writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));

				expect(findOfficialCatalogPath([pkgDir])).toBe(catalogPath);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("finds pi-ai nested inside the pi-coding-agent package", () => {
			const { root, catalogPath } = layout((dir) =>
				join(dir, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "models.generated.js"),
			);
			try {
				expect(findOfficialCatalogPath([root])).toBe(catalogPath);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("accepts an install prefix as PI_VENDOR_PI_ROOT", () => {
			const { root, catalogPath } = layout((dir) =>
				join(dir, "node_modules", "@earendil-works", "pi-ai", "dist", "models.generated.js"),
			);
			try {
				// The documented value: the prefix that owns node_modules.
				expect(findOfficialCatalogPath([root])).toBe(catalogPath);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});

	it("returns every exact model-id candidate across providers", () => {
		const catalog = {
			openai: {
				"gpt-4o": {
					id: "gpt-4o",
					name: "GPT-4o",
					api: "openai-completions",
					provider: "openai",
					baseUrl: "https://api.openai.com/v1",
					headers: { Authorization: "Bearer x" },
					apiKey: "x",
					authHeader: true,
					contextWindow: 128000,
					maxTokens: 16384,
					compat: { supportsReasoningEffort: true },
				},
			},
			openrouter: {
				"gpt-4o": {
					id: "gpt-4o",
					name: "GPT-4o Router",
					api: "openai-responses",
					provider: "openrouter",
					baseUrl: "https://openrouter.ai/api/v1",
					contextWindow: 128000,
					maxTokens: 8192,
				},
			},
		};

		const candidates = collectOfficialCandidates(catalog, "gpt-4o");
		expect(candidates).toHaveLength(2);
		expect(formatOfficialCandidate(candidates[0]!)).toMatch(/gpt-4o/);
	});

	it("keeps non-routing metadata when stripping official fields", () => {
		const config = stripOfficialRoutingFields({
			id: "gpt-4o",
			name: "GPT-4o",
			api: "openai-completions",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			headers: { Authorization: "Bearer x" },
			apiKey: "x",
			authHeader: true,
			contextWindow: 128000,
			maxTokens: 16384,
			compat: { supportsReasoningEffort: true },
		});

		expect(config).toMatchObject({
			id: "gpt-4o",
			name: "GPT-4o",
			api: "openai-completions",
			contextWindow: 128000,
			maxTokens: 16384,
			compat: { supportsReasoningEffort: true },
		});
		expect(config).not.toHaveProperty("provider");
		expect(config).not.toHaveProperty("baseUrl");
		expect(config).not.toHaveProperty("headers");
		expect(config).not.toHaveProperty("apiKey");
		expect(config).not.toHaveProperty("authHeader");
	});

});

describe("loadOfficialCatalog data guard (audit BYTE-4 #11)", () => {
	// loadOfficialCatalog caches per resolved path; each test uses a fresh
	// module registry so the cache cannot leak between cases.
	beforeEach(() => vi.resetModules());

	function makeRoot(mount: string): string {
		const root = mkdtempSync(join(tmpdir(), "pi-vendor-catalog-guard-"));
		// resolveCandidateRoots walks up from PI_VENDOR_PI_ROOT looking for the pi package marker.
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
		const dist = join(root, "node_modules/@earendil-works/pi-ai/dist");
		mkdirSync(dist, { recursive: true });
		writeFileSync(join(dist, "models.generated.js"), mount);
		writeFileSync(join(dist, "package.json"), JSON.stringify({ type: "module" }));
		return root;
	}

	it("accepts a plain-data catalog", async () => {
		const root = makeRoot('export const MODELS = { openai: { g: { id: "g", name: "G" } } };\n');
		try {
			vi.stubEnv("PI_VENDOR_PI_ROOT", root);
			const { loadOfficialCatalog } = await import("./official-catalog.js");
			const catalog = await loadOfficialCatalog();
			expect(catalog?.openai?.g?.id).toBe("g");
		} finally {
			vi.unstubAllEnvs();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects MODELS that expose functions", async () => {
		const root = makeRoot('export const MODELS = { openai: { g: { id: "g", run() { return 1; } } } };\n');
		try {
			vi.stubEnv("PI_VENDOR_PI_ROOT", root);
			const { loadOfficialCatalog } = await import("./official-catalog.js");
			await expect(loadOfficialCatalog()).resolves.toBeNull();
		} finally {
			vi.unstubAllEnvs();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects MODELS that expose getters", async () => {
		const root = makeRoot('export const MODELS = { openai: { g: { id: "g", get poison() { return process.exit; } } } };\n');
		try {
			vi.stubEnv("PI_VENDOR_PI_ROOT", root);
			const { loadOfficialCatalog } = await import("./official-catalog.js");
			await expect(loadOfficialCatalog()).resolves.toBeNull();
		} finally {
			vi.unstubAllEnvs();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects MODELS with the wrong shape", async () => {
		const root = makeRoot("export const MODELS = [1, 2, 3];\n");
		try {
			vi.stubEnv("PI_VENDOR_PI_ROOT", root);
			const { loadOfficialCatalog } = await import("./official-catalog.js");
			await expect(loadOfficialCatalog()).resolves.toBeNull();
		} finally {
			vi.unstubAllEnvs();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
