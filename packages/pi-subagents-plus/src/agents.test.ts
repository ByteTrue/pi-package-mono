import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { discoverAgents, resetOverride } from "./agents.js";

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-subagents-plus-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("agent file helpers", () => {
	it("reset moves an override to a timestamped backup", () => {
		const dir = tempDir();
		const file = join(dir, "Explore.md");
		writeFileSync(file, "body", "utf8");

		const backup = resetOverride(file, new Date("2026-06-23T07:08:09"));

		expect(backup).toBe(`${file}.bak-20260623-070809`);
		expect(existsSync(file)).toBe(false);
		expect(readFileSync(backup, "utf8")).toBe("body");
	});


	it("discovers project before global and includes missing built-ins", () => {
		const root = tempDir();
		const projectAgentsDir = join(root, "project");
		const globalAgentsDir = join(root, "global");
		mkdirSync(projectAgentsDir, { recursive: true });
		mkdirSync(globalAgentsDir, { recursive: true });
		writeFileSync(join(globalAgentsDir, "Explore.md"), "global", "utf8");
		writeFileSync(join(projectAgentsDir, "Explore.md"), "project", "utf8");

		const agents = discoverAgents({ projectAgentsDir, globalAgentsDir });

		expect(agents.find((agent) => agent.name === "Explore")?.source).toBe("project");
		expect(agents.map((agent) => agent.name)).toEqual(expect.arrayContaining(["general-purpose", "Plan"]));
	});
});
