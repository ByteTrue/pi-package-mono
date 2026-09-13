import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultCopyOps,
  planSnapshotItems,
  resolveCookiesPath,
  snapshotProfileData,
  type CopyOps,
} from "./snapshot.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-browser-snapshot-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSourceProfile(): string {
  const profile = join(root, "source");
  mkdirSync(join(profile, "Local Storage", "leveldb"), { recursive: true });
  writeFileSync(join(profile, "Cookies"), "cookie-db");
  writeFileSync(join(profile, "Local Storage", "leveldb", "CURRENT"), "MANIFEST-000001\n");
  writeFileSync(join(profile, "Local Storage", "leveldb", "MANIFEST-000001"), "manifest");
  writeFileSync(join(profile, "Local Storage", "leveldb", "000003.log"), "entries");
  return profile;
}

describe("resolveCookiesPath", () => {
  it("prefers Network/Cookies and falls back to the legacy path", () => {
    const profile = join(root, "profile");
    mkdirSync(join(profile, "Network"), { recursive: true });
    writeFileSync(join(profile, "Network", "Cookies"), "new");
    writeFileSync(join(profile, "Cookies"), "legacy");
    expect(resolveCookiesPath(profile)).toBe(join(profile, "Network", "Cookies"));

    rmSync(join(profile, "Network"), { recursive: true, force: true });
    expect(resolveCookiesPath(profile)).toBe(join(profile, "Cookies"));
    expect(resolveCookiesPath(join(root, "nope"))).toBeUndefined();
  });
});

describe("planSnapshotItems", () => {
  it("plans cookies plus the storage dirs that exist", () => {
    const profile = writeSourceProfile();
    const kinds = planSnapshotItems(profile).map((item) => item.kind);
    expect(kinds).toEqual(["cookies", "local-storage"]);
  });
});

describe("snapshotProfileData", () => {
  it("copies cookies and leveldb data into the target layout", () => {
    const profile = writeSourceProfile();
    const target = join(root, "target");
    const result = snapshotProfileData({ targetRoot: target, items: planSnapshotItems(profile) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBeGreaterThan(0);
    expect(readFileSync(join(target, "Default", "Cookies"), "utf8")).toBe("cookie-db");
    expect(readFileSync(join(target, "Default", "Local Storage", "leveldb", "000003.log"), "utf8")).toBe("entries");
  });

  it("retries when the source changes mid-copy", () => {
    const fake = makeFakeOps(
      [
        { path: "/src/Cookies", size: 4 },
        { path: "/src/Local Storage/leveldb/CURRENT", size: 15, text: "MANIFEST-000001\n" },
        { path: "/src/Local Storage/leveldb/MANIFEST-000001", size: 4, text: "data" },
      ],
      { mutateOnCopyNumber: 1 },
    );
    const result = snapshotProfileData({
      targetRoot: "/dst",
      items: [
        { kind: "cookies", source: "/src/Cookies", relative: "Default/Cookies" },
        { kind: "local-storage", source: "/src/Local Storage", relative: "Default/Local Storage" },
      ],
      ops: fake.ops,
    });

    expect(result.ok).toBe(true);
    expect(fake.copyCount()).toBeGreaterThan(2);
  });

  it("gives up with guidance when the source never settles", () => {
    const fake = makeFakeOps([{ path: "/src/Cookies", size: 4 }], { mutateEveryCopy: true });
    const result = snapshotProfileData({
      targetRoot: "/dst",
      items: [{ kind: "cookies", source: "/src/Cookies", relative: "Default/Cookies" }],
      attempts: 2,
      ops: fake.ops,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("kept changing");
  });

  it("rejects a leveldb copy whose CURRENT manifest is missing", () => {
    const fake = makeFakeOps([
      { path: "/src/Local Storage/leveldb/CURRENT", size: 15, text: "MANIFEST-000042\n" },
      { path: "/src/Local Storage/leveldb/000003.log", size: 4, text: "data" },
    ]);
    const result = snapshotProfileData({
      targetRoot: "/dst",
      items: [{ kind: "local-storage", source: "/src/Local Storage", relative: "Default/Local Storage" }],
      attempts: 2,
      ops: fake.ops,
    });

    expect(result.ok).toBe(false);
  });

  it("accepts a leveldb copy whose CURRENT manifest exists", () => {
    const fake = makeFakeOps([
      { path: "/src/Local Storage/leveldb/CURRENT", size: 15, text: "MANIFEST-000001\n" },
      { path: "/src/Local Storage/leveldb/MANIFEST-000001", size: 4, text: "data" },
    ]);
    const result = snapshotProfileData({
      targetRoot: "/dst",
      items: [{ kind: "local-storage", source: "/src/Local Storage", relative: "Default/Local Storage" }],
      ops: fake.ops,
    });

    expect(result.ok).toBe(true);
  });

  it("uses defaultCopyOps for real files", () => {
    expect(defaultCopyOps.stat("/definitely/missing")).toBeUndefined();
  });
});

type FakeEntry = { path: string; size: number; text?: string };

/** A tiny in-memory fs: tracks copied targets so leveldb checks see the copy too. */
function makeFakeOps(entries: FakeEntry[], options: { mutateOnCopyNumber?: number; mutateEveryCopy?: boolean } = {}) {
  const files = new Map<string, { size: number; mtimeMs: number; ino: number; text: string | undefined }>();
  for (const entry of entries) files.set(entry.path, { size: entry.size, mtimeMs: 1, ino: 1, text: entry.text });
  let copies = 0;
  const ops: CopyOps = {
    stat: (path) => {
      const file = files.get(path);
      return file ? { size: file.size, mtimeMs: file.mtimeMs, ino: file.ino } : undefined;
    },
    listFiles: (dir) => [...files.keys()].filter((path) => path.startsWith(dir + "/")).sort(),
    readText: (path) => files.get(path)?.text,
    copyFile: (source, target) => {
      copies += 1;
      const file = files.get(source);
      if (!file) return;
      files.set(target, { ...file });
      if (options.mutateEveryCopy || copies === options.mutateOnCopyNumber) file.mtimeMs += 1;
    },
    ensureDir: () => undefined,
  };
  return { ops, copyCount: () => copies };
}
