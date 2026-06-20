/**
 * Discover and merge subagent profiles.
 *
 * Scans the user dir (~/.pi/subagents) and the project dir (<cwd>/.pi/subagents)
 * recursively for `*.md` files, parses YAML frontmatter, validates it, and
 * merges the results over BUILTIN_PROFILES. Identity is the frontmatter `name`
 * (not the file name). Precedence on collision: project > user > builtin.
 *
 * Fail-soft: a malformed file is skipped with a diagnostic; it never throws.
 */

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { BUILTIN_PROFILES } from "./builtins.js";
import type { AgentFrontmatter, AgentProfile, ProfileSource } from "./types.js";

export interface LoadProfilesResult {
	/** Effective profiles, keyed by agent name (after precedence merge). */
	profiles: Map<string, AgentProfile>;
	/** Human-readable warnings about skipped/invalid files. */
	diagnostics: string[];
}

/** Split a comma-separated tool list into a trimmed, non-empty string array. */
function splitToolList(value: string | undefined): string[] | undefined {
	if (typeof value !== "string") return undefined;
	const items = value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	// An empty/whitespace-only string yields no tools; treat as "unset" (inherit).
	return items.length > 0 ? items : undefined;
}

/**
 * Recursively collect absolute paths of `*.md` files under `dir`.
 * Returns [] when the directory is missing or unreadable (fail-soft).
 */
function collectMarkdownFiles(dir: string, diagnostics: string[]): string[] {
	const out: string[] = [];
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		// Directory doesn't exist or isn't readable — silently skip.
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		try {
			// Resolve symlinks/dirents to a real stat so symlinked dirs/files work.
			const isDir = entry.isDirectory() || (entry.isSymbolicLink() && statSync(full).isDirectory());
			if (isDir) {
				out.push(...collectMarkdownFiles(full, diagnostics));
			} else if (entry.name.toLowerCase().endsWith(".md")) {
				out.push(full);
			}
		} catch (err) {
			diagnostics.push(`Skipped ${full}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	return out;
}

/**
 * Parse one `.md` file into a profile, or push a diagnostic and return
 * `undefined`. Never throws.
 */
function loadProfileFile(
	filePath: string,
	source: ProfileSource,
	diagnostics: string[],
): AgentProfile | undefined {
	let content: string;
	try {
		content = readFileSync(filePath, "utf8");
	} catch (err) {
		diagnostics.push(`Skipped ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
		return undefined;
	}

	let frontmatter: Partial<AgentFrontmatter>;
	let body: string;
	try {
		// parseFrontmatter requires `T extends Record<string, unknown>`; our
		// AgentFrontmatter has no index signature, so parse generically and narrow.
		const parsed = parseFrontmatter(content);
		frontmatter = (parsed.frontmatter ?? {}) as Partial<AgentFrontmatter>;
		body = parsed.body;
	} catch (err) {
		diagnostics.push(
			`Skipped ${filePath}: failed to parse frontmatter (${err instanceof Error ? err.message : String(err)})`,
		);
		return undefined;
	}

	const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
	const description =
		typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
	if (!name) {
		diagnostics.push(`Skipped ${filePath}: missing required frontmatter field "name"`);
		return undefined;
	}
	if (!description) {
		diagnostics.push(`Skipped ${filePath}: missing required frontmatter field "description"`);
		return undefined;
	}

	const model = typeof frontmatter.model === "string" ? frontmatter.model.trim() : undefined;
	const color = typeof frontmatter.color === "string" ? frontmatter.color.trim() : undefined;

	return {
		name,
		description,
		systemPrompt: body,
		tools: splitToolList(frontmatter.tools),
		disallowedTools: splitToolList(frontmatter.disallowedTools),
		model: model || undefined,
		color: color || undefined,
		source,
		filePath,
	};
}

/**
 * @param cwd Project working directory used to find `<cwd>/.pi/subagents`.
 */
export function loadProfiles(cwd: string): LoadProfilesResult {
	const diagnostics: string[] = [];
	const profiles = new Map<string, AgentProfile>();

	// 1. Built-ins (lowest precedence).
	for (const builtin of BUILTIN_PROFILES) {
		profiles.set(builtin.name, builtin);
	}

	// 2. User dir, then 3. project dir — later writes win, giving the required
	// precedence: project > user > builtin.
	const sources: Array<{ dir: string; source: ProfileSource }> = [
		{ dir: join(homedir(), ".pi", "subagents"), source: "user" },
		{ dir: join(cwd, ".pi", "subagents"), source: "project" },
	];

	for (const { dir, source } of sources) {
		const files = collectMarkdownFiles(dir, diagnostics);
		for (const filePath of files) {
			const profile = loadProfileFile(filePath, source, diagnostics);
			if (profile) profiles.set(profile.name, profile);
		}
	}

	return { profiles, diagnostics };
}
