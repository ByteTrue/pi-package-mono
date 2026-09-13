import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildStagingProfile, clearProfileData, isProfileInUse, swapIntoPlace } from "./apply.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-browser-apply-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("isProfileInUse", () => {
  it("treats a missing lock as free", () => {
    const profile = join(root, "profile");
    mkdirSync(profile, { recursive: true });
    expect(isProfileInUse(profile)).toBe(false);
  });

  it("uses the pid inside the lock symlink", () => {
    const profile = join(root, "profile");
    mkdirSync(profile, { recursive: true });
    symlinkSync(hostname() + "-4242", join(profile, "SingletonLock"));
    expect(isProfileInUse(profile, (pid) => pid === 4242)).toBe(true);
    expect(isProfileInUse(profile, () => false)).toBe(false);
  });

  it("assumes in use when the lock cannot be parsed", () => {
    const profile = join(root, "profile");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "SingletonLock"), "not-a-symlink");
    expect(isProfileInUse(profile)).toBe(true);
  });
});

describe("buildStagingProfile", () => {
  it("keeps the live profile and overlays the snapshot", () => {
    const profile = join(root, "profiles", "default");
    mkdirSync(join(profile, "Default"), { recursive: true });
    writeFileSync(join(profile, "Default", "Preferences"), "kept");
    const snapshot = join(root, "snapshot");
    mkdirSync(join(snapshot, "Default"), { recursive: true });
    writeFileSync(join(snapshot, "Default", "Cookies"), "fresh");

    const result = buildStagingProfile({ profileDir: profile, snapshotRoot: snapshot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readFileSync(join(result.value.stagingDir, "Default", "Preferences"), "utf8")).toBe("kept");
    expect(readFileSync(join(result.value.stagingDir, "Default", "Cookies"), "utf8")).toBe("fresh");
    expect(statSync(result.value.stagingDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(result.value.stagingDir, "Default", "Cookies")).mode & 0o777).toBe(0o600);
  });
});

describe("swapIntoPlace", () => {
  it("replaces the live profile and cleans up the previous copy", () => {
    const profile = join(root, "profiles", "default");
    mkdirSync(join(profile, "Default"), { recursive: true });
    writeFileSync(join(profile, "Default", "old"), "old");
    const staging = join(root, "profiles", "default.importing-1");
    mkdirSync(join(staging, "Default"), { recursive: true });
    writeFileSync(join(staging, "Default", "new"), "new");

    const result = swapIntoPlace(staging, profile);

    expect(result.ok).toBe(true);
    expect(readFileSync(join(profile, "Default", "new"), "utf8")).toBe("new");
    expect(existsSync(join(profile, "Default", "old"))).toBe(false);
    expect(existsSync(staging)).toBe(false);
  });
});

describe("clearProfileData", () => {
  it("removes the managed profile", () => {
    const profile = join(root, "profiles", "default");
    mkdirSync(join(profile, "Default"), { recursive: true });
    const result = clearProfileData(profile);
    expect(result.ok).toBe(true);
    expect(existsSync(profile)).toBe(false);
  });
});
