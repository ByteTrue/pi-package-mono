import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadProfiles } from "./loader.js";

// loader scans ~/.pi/subagents (via os.homedir()) and <cwd>/.pi/subagents. We point
// HOME/USERPROFILE at an isolated temp dir so the "user" tier is controllable
// and never reads the real user's machine. homedir() honors these env vars.
let home: string;
let project: string;

function writeAgent(dir: string, file: string, content: string): void {
	const full = join(dir, file);
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content, "utf8");
}

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "pi-agents-home-"));
	project = mkdtempSync(join(tmpdir(), "pi-agents-proj-"));
	vi.stubEnv("HOME", home);
	vi.stubEnv("USERPROFILE", home); // Windows fallback for homedir()
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(home, { recursive: true, force: true });
	rmSync(project, { recursive: true, force: true });
});

const userAgents = () => join(home, ".pi", "subagents");
const projectAgents = () => join(project, ".pi", "subagents");

describe("loadProfiles", () => {
	it("returns the three built-ins when no files exist", () => {
		const { profiles, diagnostics } = loadProfiles(project);
		expect([...profiles.keys()].sort()).toEqual(["explore", "general-purpose", "plan"]);
		expect(diagnostics).toEqual([]);
		expect(profiles.get("explore")?.source).toBe("builtin");
	});

	it("parses frontmatter and uses the markdown body as the system prompt", () => {
		writeAgent(
			userAgents(),
			"reviewer.md",
			["---", "name: reviewer", "description: Reviews code", "---", "You are a reviewer."].join(
				"\n",
			),
		);
		const { profiles } = loadProfiles(project);
		const p = profiles.get("reviewer");
		expect(p).toBeDefined();
		expect(p?.description).toBe("Reviews code");
		expect(p?.systemPrompt.trim()).toBe("You are a reviewer.");
		expect(p?.source).toBe("user");
		expect(p?.filePath).toBe(join(userAgents(), "reviewer.md"));
	});

	it("splits comma-separated tools/disallowedTools into trimmed arrays", () => {
		writeAgent(
			userAgents(),
			"tooled.md",
			[
				"---",
				"name: tooled",
				"description: Has tools",
				"tools: read, grep ,  find",
				"disallowedTools: write,bash",
				"---",
				"body",
			].join("\n"),
		);
		const { profiles } = loadProfiles(project);
		const p = profiles.get("tooled");
		expect(p?.tools).toEqual(["read", "grep", "find"]);
		expect(p?.disallowedTools).toEqual(["write", "bash"]);
	});

	it("parses valid thinking and ignores invalid thinking with a diagnostic", () => {
		writeAgent(
			userAgents(),
			"thinker.md",
			["---", "name: thinker", "description: Thinks", "thinking: high", "---", "body"].join("\n"),
		);
		writeAgent(
			userAgents(),
			"bad-thinker.md",
			["---", "name: badthinker", "description: Bad", "thinking: huge", "---", "body"].join("\n"),
		);
		const { profiles, diagnostics } = loadProfiles(project);
		expect(profiles.get("thinker")?.thinking).toBe("high");
		expect(profiles.get("badthinker")?.thinking).toBeUndefined();
		expect(diagnostics.some((d) => d.includes("bad-thinker.md") && d.includes("thinking"))).toBe(true);
	});

	it("treats an empty tools string as inherit (undefined)", () => {
		writeAgent(
			userAgents(),
			"empty-tools.md",
			["---", "name: empty", "description: d", "tools: '  ,  '", "---", "b"].join("\n"),
		);
		const { profiles } = loadProfiles(project);
		expect(profiles.get("empty")?.tools).toBeUndefined();
	});

	it("discovers files in nested subdirectories", () => {
		writeAgent(
			userAgents(),
			join("team", "nested.md"),
			["---", "name: nested", "description: d", "---", "b"].join("\n"),
		);
		const { profiles } = loadProfiles(project);
		expect(profiles.get("nested")?.name).toBe("nested");
	});

	it("lets project override user and builtin for the same name", () => {
		writeAgent(
			userAgents(),
			"explore.md",
			["---", "name: explore", "description: user explore", "---", "user body"].join("\n"),
		);
		writeAgent(
			projectAgents(),
			"explore.md",
			["---", "name: explore", "description: project explore", "---", "project body"].join("\n"),
		);
		const { profiles } = loadProfiles(project);
		const p = profiles.get("explore");
		expect(p?.source).toBe("project");
		expect(p?.description).toBe("project explore");
	});

	it("lets user override builtin when no project file exists", () => {
		writeAgent(
			userAgents(),
			"plan.md",
			["---", "name: plan", "description: user plan", "---", "b"].join("\n"),
		);
		const { profiles } = loadProfiles(project);
		expect(profiles.get("plan")?.source).toBe("user");
		expect(profiles.get("plan")?.description).toBe("user plan");
	});

	it("skips files missing name or description, recording a diagnostic, and never throws", () => {
		writeAgent(
			userAgents(),
			"no-name.md",
			["---", "description: has no name", "---", "b"].join("\n"),
		);
		writeAgent(
			userAgents(),
			"no-desc.md",
			["---", "name: nodesc", "---", "b"].join("\n"),
		);
		const { profiles, diagnostics } = loadProfiles(project);
		expect(profiles.has("nodesc")).toBe(false);
		expect(diagnostics.length).toBe(2);
		expect(diagnostics.some((d) => d.includes("no-name.md") && d.includes("name"))).toBe(true);
		expect(diagnostics.some((d) => d.includes("no-desc.md") && d.includes("description"))).toBe(
			true,
		);
		// Built-ins still present — fail-soft.
		expect(profiles.has("explore")).toBe(true);
	});

	it("fail-soft on malformed frontmatter without losing other files", () => {
		writeAgent(userAgents(), "broken.md", "---\nname: : : [oops\n  bad: yaml: here\n---\nb");
		writeAgent(
			userAgents(),
			"good.md",
			["---", "name: good", "description: fine", "---", "b"].join("\n"),
		);
		const { profiles, diagnostics } = loadProfiles(project);
		// The good file loads regardless of the broken one.
		expect(profiles.get("good")?.name).toBe("good");
		// "broken" was either skipped (diagnostic) or produced no usable profile;
		// either way it must not surface as a usable agent and must not throw.
		expect(profiles.has("broken")).toBe(false);
		expect(Array.isArray(diagnostics)).toBe(true);
	});

	it("ignores non-markdown files", () => {
		writeAgent(userAgents(), "notes.txt", "name: nope");
		const { profiles } = loadProfiles(project);
		expect([...profiles.keys()].sort()).toEqual(["explore", "general-purpose", "plan"]);
	});
});
