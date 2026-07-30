import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "../skills/pi-vendor/scripts/set-api-key.mjs");
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-vendor-key-"));
	writeFileSync(join(dir, "models.json"), `${JSON.stringify({ providers: { relay: { apiKey: "old", models: [] } } }, null, 2)}\n`);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("set-api-key script", () => {
	it("reads the key from stdin, never argv, and updates only the selected field", () => {
		const output = execFileSync(process.execPath, [script, "relay"], {
			env: { ...process.env, PI_CODING_AGENT_DIR: dir },
			input: "sk-new-secret\n",
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		const saved = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));

		expect(saved).toEqual({ providers: { relay: { apiKey: "sk-new-secret", models: [] } } });
		expect(output).not.toContain("sk-new-secret");
	});

	it("escapes Pi config metacharacters so the saved key remains literal", () => {
		execFileSync(process.execPath, [script, "relay"], {
			env: { ...process.env, PI_CODING_AGENT_DIR: dir },
			input: "!literal$HOME\n",
			stdio: ["pipe", "pipe", "pipe"],
		});
		const saved = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
		expect(saved.providers.relay.apiKey).toBe("$!literal$$HOME");
	});

	it("does not change the file when the provider is missing", () => {
		const before = readFileSync(join(dir, "models.json"), "utf8");
		expect(() => execFileSync(process.execPath, [script, "missing"], {
			env: { ...process.env, PI_CODING_AGENT_DIR: dir },
			input: "sk-new-secret\n",
			stdio: ["pipe", "pipe", "pipe"],
		})).toThrow();
		expect(readFileSync(join(dir, "models.json"), "utf8")).toBe(before);
	});

	it("aborts instead of overwriting a concurrent edit", async () => {
		const path = join(dir, "models.json");
		const child = spawn(process.execPath, [script, "relay"], {
			env: { ...process.env, PI_CODING_AGENT_DIR: dir },
			stdio: ["pipe", "pipe", "pipe"],
		});
		await new Promise<void>((resolve) => child.stderr.once("data", () => resolve()));
		writeFileSync(path, `${JSON.stringify({ providers: {
			relay: { apiKey: "old", models: [] },
			concurrent: { apiKey: "other", models: [] },
		} }, null, 2)}\n`);
		child.stdin.end("sk-new-secret\n");
		const code = await new Promise<number | null>((resolve) => child.once("close", resolve));

		expect(code).toBe(1);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ providers: {
			relay: { apiKey: "old", models: [] },
			concurrent: { apiKey: "other", models: [] },
		} });
	});
});
