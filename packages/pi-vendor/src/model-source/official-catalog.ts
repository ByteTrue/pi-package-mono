import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ProviderModelConfig } from "../models-json.js";

export type OfficialModelConfig = Record<string, unknown> & {
	id: string;
	name?: string;
	api?: string;
	provider?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	apiKey?: string;
	authHeader?: boolean;
	contextWindow?: number;
	maxTokens?: number;
};

export type OfficialModelsCatalog = Record<string, Record<string, OfficialModelConfig>>;

export type OfficialModelCandidate = {
	provider: string;
	model: OfficialModelConfig;
};

const STRIPPED_FIELDS = ["provider", "baseUrl", "headers", "apiKey", "authHeader"] as const;

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function resolvePackageRoot(startDir: string): string | null {
	let current = startDir;
	for (;;) {
		try {
			const pkg = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as { name?: string };
			if (pkg.name === "@earendil-works/pi-coding-agent") {
				return current;
			}
		} catch {
			// keep walking
		}

		const parent = dirname(current);
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

function piRootFromEntry(entry: string | undefined): string | null {
	if (!entry || !existsSync(entry)) return null;
	try {
		return resolvePackageRoot(dirname(realpathSync(entry)));
	} catch {
		return null;
	}
}

function piRootFromPath(): string | null {
	const names = process.platform === "win32" ? ["pi.cmd", "pi.exe", "pi"] : ["pi"];
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		for (const name of names) {
			const root = piRootFromEntry(join(dir, name));
			if (root) return root;
		}
	}
	return null;
}

function resolveCandidateRoots(): string[] {
	const roots = new Set<string>();
	const add = (root: string | null) => {
		if (root) roots.add(root);
	};

	// Pi sessions use argv[1]. `dev:web` resolves the Pi executable from PATH.
	add(resolvePackageRoot(process.env.PI_VENDOR_PI_ROOT ?? ""));
	add(piRootFromEntry(process.argv[1]));
	add(piRootFromPath());

	try {
		const resolvedUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
		if (resolvedUrl.startsWith("file://")) add(resolvePackageRoot(dirname(fileURLToPath(resolvedUrl))));
	} catch {
		// ignore
	}

	add(resolvePackageRoot(dirname(fileURLToPath(import.meta.url))));
	return [...roots];
}

function candidateCatalogPaths(roots: readonly string[]): string[] {
	const paths = new Set<string>();
	for (const root of roots) {
		paths.add(join(root, "node_modules", "@earendil-works", "pi-ai", "dist", "models.generated.js"));

		let current = root;
		for (;;) {
			paths.add(
				join(current, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "models.generated.js"),
			);
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}
	}
	return [...paths];
}

let cachedCatalogPath: string | null = null;
let cachedCatalog: OfficialModelsCatalog | null = null;

export function findOfficialCatalogPath(roots = resolveCandidateRoots()): string | null {
	for (const candidate of candidateCatalogPaths(roots)) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

export async function loadOfficialCatalog(): Promise<OfficialModelsCatalog | null> {
	const path = findOfficialCatalogPath();
	if (!path) {
		cachedCatalogPath = null;
		cachedCatalog = null;
		return null;
	}
	if (cachedCatalogPath === path) return cachedCatalog;

	try {
		const mod = await import(pathToFileURL(path).href);
		const catalog = mod.MODELS as OfficialModelsCatalog | undefined;
		if (!catalog || typeof catalog !== "object") {
			return null;
		}
		cachedCatalogPath = path;
		cachedCatalog = catalog;
		return cachedCatalog;
	} catch {
		return null;
	}
}

export function collectOfficialCandidates(catalog: OfficialModelsCatalog | null | undefined, modelId: string): OfficialModelCandidate[] {
	if (!catalog) return [];

	const matches: OfficialModelCandidate[] = [];
	for (const [provider, providerModels] of Object.entries(catalog)) {
		const model = providerModels?.[modelId];
		if (model && typeof model === "object" && !Array.isArray(model) && typeof model.id === "string") {
			matches.push({ provider, model: cloneJson(model) as OfficialModelConfig });
		}
	}
	return matches;
}

export type OfficialModelEntry = {
	provider: string;
	modelId: string;
	model: OfficialModelConfig;
};

export type OfficialModelGroup = {
	modelId: string;
	entries: OfficialModelEntry[];
};

export function listAllOfficialModels(catalog: OfficialModelsCatalog | null | undefined): OfficialModelEntry[] {
	if (!catalog) return [];

	const entries: OfficialModelEntry[] = [];
	for (const [provider, providerModels] of Object.entries(catalog)) {
		for (const [modelId, model] of Object.entries(providerModels)) {
			if (model && typeof model === "object" && !Array.isArray(model) && typeof model.id === "string") {
				entries.push({ provider, modelId, model: cloneJson(model) as OfficialModelConfig });
			}
		}
	}
	return entries;
}

export function groupOfficialModelsById(entries: OfficialModelEntry[]): OfficialModelGroup[] {
	const groups: OfficialModelGroup[] = [];
	const byId = new Map<string, OfficialModelGroup>();

	for (const entry of entries) {
		let group = byId.get(entry.modelId);
		if (!group) {
			group = { modelId: entry.modelId, entries: [] };
			byId.set(entry.modelId, group);
			groups.push(group);
		}
		group.entries.push(entry);
	}

	return groups;
}

export function stripOfficialRoutingFields(model: OfficialModelConfig): ProviderModelConfig {
	const next = cloneJson(model) as ProviderModelConfig;
	for (const field of STRIPPED_FIELDS) {
		delete next[field];
	}
	return next;
}

export function formatOfficialCandidate(candidate: OfficialModelCandidate): string {
	const name = typeof candidate.model.name === "string" && candidate.model.name.trim() && candidate.model.name !== candidate.model.id ? candidate.model.name.trim() : undefined;
	const api = typeof candidate.model.api === "string" && candidate.model.api.trim() ? candidate.model.api.trim() : undefined;
	const contextWindow = typeof candidate.model.contextWindow === "number" ? `ctx ${candidate.model.contextWindow}` : undefined;
	const maxTokens = typeof candidate.model.maxTokens === "number" ? `max ${candidate.model.maxTokens}` : undefined;
	const meta = [api, contextWindow, maxTokens].filter(Boolean).join(", ");
	const head = name ? `${candidate.provider}/${candidate.model.id} - ${name}` : `${candidate.provider}/${candidate.model.id}`;
	return meta ? `${head} (${meta})` : head;
}
