import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skill = readFileSync(join(import.meta.dirname, "../skills/pi-vendor/SKILL.md"), "utf8");

function extractTemplate(marker: string, endMarker: string) {
	const start = skill.indexOf(marker);
	expect(start).toBeGreaterThan(0);
	const end = skill.indexOf(endMarker, start);
	expect(end).toBeGreaterThan(start);
	const block = skill.slice(start, end);
	const codeStart = block.indexOf("node <<'NODE'");
	expect(codeStart).toBeGreaterThan(0);
	const codeEnd = block.lastIndexOf("NODE");
	expect(codeEnd).toBeGreaterThan(codeStart);
	return block.slice(codeStart + "node <<'NODE'\n".length, codeEnd);
}

const planScript = extractTemplate("### Generate the plan", "### Assert before and after");

function runNodeProgram(program: string, env: NodeJS.ProcessEnv, cwd?: string) {
	return execFileSync(process.execPath, ["--input-type=commonjs", "-e", program], {
		env: { ...process.env, ...env },
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		cwd,
	});
}

describe("pi-vendor exact sync plan template", () => {
	it("prints the plan JSON plus a machine-generated summary table", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-vendor-plan-"));
		try {
			const agentDir = join(dir, "agent");
			const syncDir = join(dir, "sync");
			mkdirSync(agentDir, { recursive: true });
			mkdirSync(syncDir, { recursive: true });
			writeFileSync(join(agentDir, "models.json"), `${JSON.stringify({ providers: { relay: { models: [{ id: "beta" }, { id: "alpha" }] } } }, null, 2)}\n`);
			writeFileSync(join(syncDir, "discovery.json"), JSON.stringify({ routes: [{ status: "ok", modelIds: ["beta", "gamma"] }] }));

			const planFile = join(syncDir, "plan.json");
			const stdout = runNodeProgram(planScript, {
				PI_CODING_AGENT_DIR: agentDir,
				PI_VENDOR_PROVIDER_KEY: "relay",
				PI_VENDOR_DISCOVERY_FILE: join(syncDir, "discovery.json"),
				PI_VENDOR_SYNC_PLAN_FILE: planFile,
			});

			const firstLine = stdout.slice(0, stdout.indexOf("\n"));
			expect(JSON.parse(firstLine)).toEqual({ before: ["alpha", "beta"], add: ["gamma"], remove: ["alpha"], after: ["beta", "gamma"] });
			expect(JSON.parse(readFileSync(planFile, "utf8"))).toEqual({ before: ["alpha", "beta"], add: ["gamma"], remove: ["alpha"], after: ["beta", "gamma"] });
			expect(stdout).toContain("#### Sync plan summary (machine-generated; the JSON above is the only mutation authority)");
			expect(stdout).toContain("| action | model id |");
			expect(stdout).toContain("| add | gamma |");
			expect(stdout).toContain("| remove | alpha |");
			expect(stdout).toContain("kept 1 of 2 configured models unchanged: beta");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reports a no-op plan without an action table", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-vendor-plan-"));
		try {
			const agentDir = join(dir, "agent");
			const syncDir = join(dir, "sync");
			mkdirSync(agentDir, { recursive: true });
			mkdirSync(syncDir, { recursive: true });
			writeFileSync(join(agentDir, "models.json"), `${JSON.stringify({ providers: { relay: { models: [{ id: "alpha" }] } } }, null, 2)}\n`);
			writeFileSync(join(syncDir, "discovery.json"), JSON.stringify({ routes: [{ status: "ok", modelIds: ["alpha"] }] }));

			const stdout = runNodeProgram(planScript, {
				PI_CODING_AGENT_DIR: agentDir,
				PI_VENDOR_PROVIDER_KEY: "relay",
				PI_VENDOR_DISCOVERY_FILE: join(syncDir, "discovery.json"),
				PI_VENDOR_SYNC_PLAN_FILE: join(syncDir, "plan.json"),
			});

			expect(stdout).toContain("No additions or removals: the configured set already equals the verified upstream union.");
			expect(stdout).toContain("kept 1 of 1 configured models unchanged: alpha");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
