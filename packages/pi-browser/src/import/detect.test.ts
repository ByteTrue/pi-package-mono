import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectSourceBrowsers } from "./detect.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pi-browser-detect-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const edgeRoot = (): string => join(home, "Library/Application Support/Microsoft Edge");

function writeLocalState(root: string, infoCache: Record<string, { name: string }>): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "Local State"), JSON.stringify({ profile: { info_cache: infoCache } }));
}

describe("detectSourceBrowsers", () => {
  it("lists profiles from Local State with Default first", () => {
    writeLocalState(edgeRoot(), { "Profile 1": { name: "Agent" }, Default: { name: "Personal" } });
    mkdirSync(join(edgeRoot(), "Default"), { recursive: true });
    mkdirSync(join(edgeRoot(), "Profile 1"), { recursive: true });

    const browsers = detectSourceBrowsers({ platform: "darwin", home });

    expect(browsers).toHaveLength(1);
    expect(browsers[0]).toMatchObject({ id: "msedge", label: "Microsoft Edge", channel: "msedge" });
    expect(browsers[0]?.profiles).toEqual([
      { dir: "Default", name: "Personal" },
      { dir: "Profile 1", name: "Agent" },
    ]);
  });

  it("falls back to the Default profile when Local State is missing", () => {
    mkdirSync(join(edgeRoot(), "Default"), { recursive: true });

    const browsers = detectSourceBrowsers({ platform: "darwin", home });

    expect(browsers[0]?.profiles).toEqual([{ dir: "Default", name: "Default" }]);
  });

  it("ignores profiles listed in Local State but missing on disk", () => {
    writeLocalState(edgeRoot(), { Default: { name: "Personal" }, "Profile 9": { name: "Gone" } });
    mkdirSync(join(edgeRoot(), "Default"), { recursive: true });

    const browsers = detectSourceBrowsers({ platform: "darwin", home });

    expect(browsers[0]?.profiles).toEqual([{ dir: "Default", name: "Personal" }]);
  });

  it("returns nothing when no supported browser is installed", () => {
    expect(detectSourceBrowsers({ platform: "darwin", home })).toEqual([]);
  });
});
