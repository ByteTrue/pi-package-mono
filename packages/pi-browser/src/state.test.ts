import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBrowserState, writeBrowserState, type PiBrowserState } from "./state.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-browser-state-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const statePath = (): string => join(dir, "state.json");

describe("browser state", () => {
  it("round-trips state with 0600 permissions", () => {
    const state: PiBrowserState = {
      version: 1,
      profileName: "default",
      lastImport: {
        sourceBrowserId: "msedge",
        sourceBrowserLabel: "Microsoft Edge",
        sourceProfile: "Default",
        sourceProfileDir: "/Users/byte/Library/Application Support/Microsoft Edge/Default",
        importedAt: "2026-09-13T12:00:00.000Z",
        bytesCopied: 25_000_000,
      },
    };
    writeBrowserState(statePath(), state);
    expect(statSync(statePath()).mode & 0o777).toBe(0o600);
    expect(readBrowserState(statePath())).toEqual(state);
  });

  it("treats unreadable or foreign state as empty", () => {
    expect(readBrowserState(statePath())).toBeUndefined();
    writeFileSync(statePath(), "{ broken");
    expect(readBrowserState(statePath())).toBeUndefined();
    writeFileSync(statePath(), JSON.stringify({ version: 99, profileName: "x" }));
    expect(readBrowserState(statePath())).toBeUndefined();
  });

  it("falls back to the default profile name", () => {
    writeFileSync(statePath(), JSON.stringify({ version: 1 }));
    expect(readBrowserState(statePath())).toEqual({ version: 1, profileName: "default" });
  });
});
