import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importProfileData } from "./pipeline.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-browser-pipeline-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeSourceProfile(): string {
  const profile = join(root, "edge", "Default");
  mkdirSync(join(profile, "Local Storage", "leveldb"), { recursive: true });
  writeFileSync(join(profile, "Cookies"), "cookie-db");
  writeFileSync(join(profile, "Local Storage", "leveldb", "CURRENT"), "MANIFEST-000001\n");
  writeFileSync(join(profile, "Local Storage", "leveldb", "MANIFEST-000001"), "manifest");
  return profile;
}

const source = {
  browserId: "msedge",
  browserLabel: "Microsoft Edge",
  channel: "msedge",
  profileName: "Personal",
};

describe("importProfileData", () => {
  it("swaps a complete snapshot into the managed profile", () => {
    const profileDir = makeSourceProfile();
    const target = join(root, "agent", "pi-browser", "profiles", "default");
    mkdirSync(join(target, "Default"), { recursive: true });
    writeFileSync(join(target, "Default", "Preferences"), "kept");

    const result = importProfileData({
      source: { ...source, profileDir },
      targetProfileDir: target,
      now: new Date("2026-09-13T12:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({
      sourceBrowserId: "msedge",
      sourceBrowserLabel: "Microsoft Edge",
      sourceProfile: "Personal",
      sourceProfileDir: profileDir,
      importedAt: "2026-09-13T12:00:00.000Z",
    });
    expect(result.bytes).toBeGreaterThan(0);
    expect(readFileSync(join(target, "Default", "Cookies"), "utf8")).toBe("cookie-db");
    expect(readFileSync(join(target, "Default", "Preferences"), "utf8")).toBe("kept");
    expect(existsSync(join(target, "Default", "Local Storage", "leveldb", "MANIFEST-000001"))).toBe(true);
  });

  it("refuses to touch a profile that is in use", () => {
    const profileDir = makeSourceProfile();
    const target = join(root, "profiles", "default");
    mkdirSync(join(target, "Default"), { recursive: true });
    symlinkSync(hostname() + "-" + process.pid, join(target, "SingletonLock"));

    const result = importProfileData({ source: { ...source, profileDir }, targetProfileDir: target });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("in use");
  });

  it("errors when the source has nothing importable", () => {
    const empty = join(root, "empty");
    mkdirSync(empty, { recursive: true });
    const result = importProfileData({
      source: { ...source, profileDir: empty },
      targetProfileDir: join(root, "profiles", "default"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("No importable data");
  });
});
