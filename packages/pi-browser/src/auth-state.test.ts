import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteAuthState,
  describeAuthState,
  getAuthState,
  inspectAuthStateFile,
  listAuthStates,
  loadAuthStateIntoSession,
  renameAuthState,
  saveAuthStateFromSession,
  validateAuthStateName,
} from "./auth-state.js";
import { setAgentBrowserCliOverride } from "./cli.js";
import type { ExecFn } from "./env.js";

const temporary: string[] = [];
afterEach(() => {
  setAgentBrowserCliOverride(undefined);
  while (temporary.length > 0) {
    const dir = temporary.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  setAgentBrowserCliOverride({ command: "agent-browser" });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-browser-auth-test-"));
  temporary.push(dir);
  return dir;
}

describe("auth state name validation", () => {
  it("accepts valid alphanumeric, Chinese, hyphen, and underscore names", () => {
    expect(validateAuthStateName("github")).toEqual({ ok: true, name: "github" });
    expect(validateAuthStateName("work-account_1")).toEqual({ ok: true, name: "work-account_1" });
    expect(validateAuthStateName("github.json")).toEqual({ ok: true, name: "github" });
    expect(validateAuthStateName("  v2ex  ")).toEqual({ ok: true, name: "v2ex" });
  });

  it("rejects empty names and invalid characters", () => {
    expect(validateAuthStateName("").ok).toBe(false);
    expect(validateAuthStateName("   ").ok).toBe(false);
    expect(validateAuthStateName(".json").ok).toBe(false);
    expect(validateAuthStateName("bad/name").ok).toBe(false);
    expect(validateAuthStateName("bad\\name").ok).toBe(false);
    expect(validateAuthStateName("name with spaces").ok).toBe(false);
  });
});

describe("auth state file inspection and listing", () => {
  it("inspects valid state files and extracts domains, cookies, and origins", () => {
    const dir = tempDir();
    const filePath = join(dir, "github.json");
    const data = {
      cookies: [
        { name: "user", value: "alice", domain: ".github.com" },
        { name: "token", value: "123", domain: "api.github.com" },
      ],
      origins: [
        { origin: "https://github.com", localStorage: [{ name: "theme", value: "dark" }] },
        { origin: "https://gist.github.com", localStorage: [] },
      ],
    };
    writeFileSync(filePath, JSON.stringify(data));

    const summary = inspectAuthStateFile(filePath);
    expect(summary).toBeDefined();
    expect(summary?.name).toBe("github");
    expect(summary?.cookieCount).toBe(2);
    expect(summary?.originCount).toBe(2);
    expect(summary?.domains).toEqual(["api.github.com", "gist.github.com", "github.com"]);
  });

  it("lists multiple state files alphabetically", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "v2ex.json"), JSON.stringify({ cookies: [] }));
    writeFileSync(join(dir, "github.json"), JSON.stringify({ cookies: [] }));
    writeFileSync(join(dir, "aws.json"), JSON.stringify({ cookies: [] }));
    writeFileSync(join(dir, "not-json.txt"), "ignored");

    const list = listAuthStates(dir);
    expect(list.map((s) => s.name)).toEqual(["aws", "github", "v2ex"]);
    expect(describeAuthState(list[0]!)).toContain("aws");
  });

  it("returns empty array for missing directory", () => {
    expect(listAuthStates("/definitely/nonexistent/dir")).toEqual([]);
  });
});

describe("auth state renaming and deletion", () => {
  it("renames an existing login state and prevents collisions", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "old.json"), JSON.stringify({ cookies: [] }));
    writeFileSync(join(dir, "existing.json"), JSON.stringify({ cookies: [] }));

    // Successful rename
    expect(renameAuthState("old", "new", dir)).toEqual({ ok: true, newName: "new" });
    expect(existsSync(join(dir, "new.json"))).toBe(true);
    expect(existsSync(join(dir, "old.json"))).toBe(false);

    // Reject collision
    expect(renameAuthState("new", "existing", dir)).toMatchObject({ ok: false });

    // Reject nonexistent
    expect(renameAuthState("nonexistent", "other", dir)).toMatchObject({ ok: false });
  });

  it("deletes an existing login state", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "test.json"), JSON.stringify({ cookies: [] }));

    expect(deleteAuthState("test", dir)).toEqual({ ok: true });
    expect(existsSync(join(dir, "test.json"))).toBe(false);
    expect(deleteAuthState("test", dir)).toMatchObject({ ok: false });
  });
});

describe("auth state session save and load", () => {
  it("executes agent-browser state save and parses result", async () => {
    const dir = tempDir();
    const calls: string[][] = [];
    const exec: ExecFn = async (_cmd, args) => {
      calls.push(args);
      // Simulate agent-browser creating the file
      const target = args[args.length - 1];
      if (target && target.endsWith(".json")) {
        writeFileSync(target, JSON.stringify({ cookies: [{ name: "a", domain: "example.com" }] }));
      }
      return { stdout: "State saved", stderr: "", code: 0 };
    };

    const res = await saveAuthStateFromSession(exec, "/cfg.json", "sess-1", "example", dir);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summary.name).toBe("example");
      expect(res.summary.domains).toEqual(["example.com"]);
    }
    expect(calls[0]).toContain("state");
    expect(calls[0]).toContain("save");
  });

  it("executes agent-browser state load for an existing state file", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "my-auth.json"), JSON.stringify({ cookies: [] }));
    const calls: string[][] = [];
    const exec: ExecFn = async (_cmd, args) => {
      calls.push(args);
      return { stdout: "State loaded", stderr: "", code: 0 };
    };

    const res = await loadAuthStateIntoSession(exec, "/cfg.json", "sess-1", "my-auth", dir);
    expect(res.ok).toBe(true);
    expect(calls[0]).toContain("state");
    expect(calls[0]).toContain("load");

    // Missing state file rejects before exec
    const missing = await loadAuthStateIntoSession(exec, "/cfg.json", "sess-1", "nonexistent", dir);
    expect(missing.ok).toBe(false);
  });
});
