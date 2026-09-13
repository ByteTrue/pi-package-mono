import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

export type FileState = { size: number; mtimeMs: number; ino: number };

/** Filesystem seam: production uses node:fs, tests inject deterministic fakes. */
export type CopyOps = {
  stat(path: string): FileState | undefined;
  listFiles(dir: string): string[];
  readText(path: string): string | undefined;
  copyFile(source: string, target: string): void;
  ensureDir(path: string): void;
};

function listFilesRecursive(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listFilesRecursive(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

export const defaultCopyOps: CopyOps = {
  stat: (path) => {
    try {
      const stats = statSync(path);
      return stats.isFile() ? { size: stats.size, mtimeMs: stats.mtimeMs, ino: stats.ino } : undefined;
    } catch {
      return undefined;
    }
  },
  listFiles: (dir) => {
    try {
      return listFilesRecursive(dir).sort();
    } catch {
      return [];
    }
  },
  readText: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
  copyFile: (source, target) => {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    copyFileSync(source, target);
  },
  ensureDir: (path) => {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  },
};

export type SnapshotItemKind = "cookies" | "local-storage" | "session-storage" | "indexeddb";
export type SnapshotItem = { kind: SnapshotItemKind; source: string; relative: string };
export type SnapshotPart = { kind: SnapshotItemKind; bytes: number };

/** Chromium 96+ moved the cookie DB under `Network/`; older profiles keep it at the root. */
export function resolveCookiesPath(profileDir: string, exists: (path: string) => boolean = existsSync): string | undefined {
  const network = join(profileDir, "Network", "Cookies");
  if (exists(network)) return network;
  const legacy = join(profileDir, "Cookies");
  return exists(legacy) ? legacy : undefined;
}

export function planSnapshotItems(
  profileDir: string,
  exists: (path: string) => boolean = existsSync,
): SnapshotItem[] {
  const items: SnapshotItem[] = [];
  const cookies = resolveCookiesPath(profileDir, exists);
  if (cookies) items.push({ kind: "cookies", source: cookies, relative: "Default/Cookies" });
  for (const [kind, dirName] of [
    ["local-storage", "Local Storage"],
    ["session-storage", "Session Storage"],
    ["indexeddb", "IndexedDB"],
  ] as const) {
    const source = join(profileDir, dirName);
    if (exists(source)) items.push({ kind, source, relative: join("Default", dirName) });
  }
  return items;
}

export function measureItems(items: SnapshotItem[], ops: CopyOps = defaultCopyOps): number {
  let bytes = 0;
  for (const item of items) {
    const file = ops.stat(item.source);
    if (file) {
      bytes += file.size;
      continue;
    }
    for (const path of ops.listFiles(item.source)) {
      bytes += ops.stat(path)?.size ?? 0;
    }
  }
  return bytes;
}

function fileStatesEqual(left: FileState | undefined, right: FileState | undefined): boolean {
  if (!left || !right) return left === right;
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ino === right.ino;
}

function fingerprint(files: string[], ops: CopyOps): string {
  return files
    .map((path) => {
      const state = ops.stat(path);
      return path + ":" + (state ? state.size + ":" + state.mtimeMs + ":" + state.ino : "missing");
    })
    .join("|");
}

/**
 * Every leveldb dir in the copy must carry CURRENT pointing at an existing manifest.
 * Local Storage keeps it in `leveldb/`, IndexedDB nests per origin, so walk the tree.
 */
function levelDbLooksComplete(dir: string, ops: CopyOps): boolean {
  for (const path of ops.listFiles(dir)) {
    if (basename(path) !== "CURRENT") continue;
    const manifest = (ops.readText(path) ?? "").trim();
    if (!manifest || ops.readText(join(dirname(path), manifest)) === undefined) return false;
  }
  return true;
}

export type SnapshotOptions = {
  /** Where the snapshot is written; the layout inside is Default/… (a user-data-dir). */
  targetRoot: string;
  items: SnapshotItem[];
  attempts?: number;
  ops?: CopyOps;
};

export type SnapshotResult =
  | { ok: true; parts: SnapshotPart[]; bytes: number; warnings: string[] }
  | { ok: false; error: string };

const DEFAULT_ATTEMPTS = 5;

/**
 * Copies each item, verifying the source did not change mid-copy (and that leveldb
 * dirs stay structurally sound) — a live browser writes to these files constantly.
 */
export function snapshotProfileData(options: SnapshotOptions): SnapshotResult {
  const ops = options.ops ?? defaultCopyOps;
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const parts: SnapshotPart[] = [];
  const warnings: string[] = [];
  let bytes = 0;

  for (const item of options.items) {
    const target = join(options.targetRoot, item.relative);
    const singleFile = ops.stat(item.source) !== undefined;
    const files = singleFile ? [item.source] : ops.listFiles(item.source);
    if (files.length === 0) {
      warnings.push("Skipped " + item.kind + ": nothing to copy.");
      continue;
    }

    let copied = false;
    for (let attempt = 0; attempt < attempts && !copied; attempt += 1) {
      const before = singleFile ? undefined : fingerprint(files, ops);
      const beforeSingle = singleFile ? ops.stat(item.source) : undefined;
      try {
        for (const path of files) {
          const relativePath = singleFile ? "" : relative(item.source, path);
          const targetFile = singleFile ? target : join(target, relativePath);
          ops.copyFile(path, targetFile);
        }
      } catch (error) {
        if (attempt === attempts - 1) {
          return { ok: false, error: "Could not copy " + item.kind + ": " + message(error) };
        }
        continue;
      }

      if (singleFile) {
        const after = ops.stat(item.source);
        const targetState = ops.stat(target);
        copied = fileStatesEqual(beforeSingle, after) && targetState?.size === beforeSingle?.size;
      } else {
        const after = fingerprint(files, ops);
        copied = before === after && levelDbLooksComplete(target, ops);
      }
    }

    if (!copied) {
      return {
        ok: false,
        error:
          "The source kept changing while copying " + item.kind + ". Close the source browser (or retry when it is idle) and import again.",
      };
    }

    const partBytes = singleFile
      ? ops.stat(item.source)?.size ?? 0
      : files.reduce((sum, path) => sum + (ops.stat(path)?.size ?? 0), 0);
    bytes += partBytes;
    parts.push({ kind: item.kind, bytes: partBytes });
  }

  return { ok: true, parts, bytes, warnings };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
