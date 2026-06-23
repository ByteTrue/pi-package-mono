import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export type AgentSource = "project" | "global" | "builtin";

export type AgentEntry = {
	name: string;
	source: AgentSource;
	path?: string;
	isBuiltin: boolean;
};

export type AgentDirs = {
	projectAgentsDir: string;
	globalAgentsDir: string;
};

export const BUILTIN_AGENT_NAMES = ["general-purpose", "Explore", "Plan"] as const;

export function discoverAgents(dirs: AgentDirs, builtinNames: readonly string[] = BUILTIN_AGENT_NAMES): AgentEntry[] {
	const byName = new Map<string, AgentEntry>();
	for (const file of listMarkdown(dirs.globalAgentsDir)) {
		const name = basename(file, ".md");
		byName.set(name, { name, source: "global", path: join(dirs.globalAgentsDir, file), isBuiltin: builtinNames.includes(name) });
	}
	for (const file of listMarkdown(dirs.projectAgentsDir)) {
		const name = basename(file, ".md");
		byName.set(name, { name, source: "project", path: join(dirs.projectAgentsDir, file), isBuiltin: builtinNames.includes(name) });
	}
	for (const name of builtinNames) {
		if (!byName.has(name)) byName.set(name, { name, source: "builtin", isBuiltin: true });
	}
	return [...byName.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function resetOverride(path: string, now = new Date()): string {
	if (!existsSync(path)) throw new Error(`No override file found: ${path}`);
	const backup = `${path}.bak-${timestamp(now)}`;
	renameSync(path, backup);
	return backup;
}

export function readAgentFile(path: string): string {
	return readFileSync(path, "utf8");
}

export function writeAgentFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
}



function listMarkdown(dir: string): string[] {
	try {
		return readdirSync(dir).filter((file) => file.endsWith(".md"));
	} catch {
		return [];
	}
}

function rank(entry: AgentEntry): number {
	return entry.source === "project" ? 0 : entry.source === "global" ? 1 : 2;
}

function timestamp(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
