import { dirname } from "node:path";
import type { BrowserImportSummary } from "../state.js";
import {
  buildStagingProfile,
  createStagingRoot,
  discardStaging,
  isProfileInUse,
  swapIntoPlace,
} from "./apply.js";
import {
  planSnapshotItems,
  snapshotProfileData,
  type CopyOps,
  type SnapshotItemKind,
  type SnapshotPart,
} from "./snapshot.js";

export type ImportSource = {
  browserId: string;
  browserLabel: string;
  channel: string;
  /** Absolute path of the source profile dir (…/Microsoft Edge/Default). */
  profileDir: string;
  profileName: string;
};

export type ImportRequest = {
  source: ImportSource;
  /** Target user-data-dir; the browser profile lives in its Default/ subdir. */
  targetProfileDir: string;
  items?: SnapshotItemKind[];
  attempts?: number;
  ops?: CopyOps;
  now?: Date;
};

export type ImportOutcome =
  | { ok: true; summary: BrowserImportSummary; parts: SnapshotPart[]; bytes: number; warnings: string[] }
  | { ok: false; error: string };

/**
 * Copy login-bearing data out of a live browser profile into the managed profile.
 * The live profile is never modified; the target is only swapped once a complete
 * staging copy exists.
 */
export function importProfileData(request: ImportRequest): ImportOutcome {
  const target = request.targetProfileDir;
  if (isProfileInUse(target)) {
    return {
      ok: false,
      error:
        "The managed browser profile is in use (SingletonLock). Close that browser window and import again.",
    };
  }

  const allItems = planSnapshotItems(request.source.profileDir);
  const items = request.items ? allItems.filter((item) => request.items?.includes(item.kind)) : allItems;
  if (items.length === 0) {
    return {
      ok: false,
      error: "No importable data (cookies / local storage / indexeddb) found in " + request.source.profileDir + ".",
    };
  }

  const stagingParent = dirname(target);
  const snapshotRoot = createStagingRoot(stagingParent, ".snapshot");
  let stagingDir: string | undefined;
  try {
    const snapshot = snapshotProfileData({
      targetRoot: snapshotRoot,
      items,
      ...(request.attempts === undefined ? {} : { attempts: request.attempts }),
      ...(request.ops === undefined ? {} : { ops: request.ops }),
    });
    if (!snapshot.ok) return { ok: false, error: snapshot.error };

    const staged = buildStagingProfile({ profileDir: target, snapshotRoot });
    if (!staged.ok) return { ok: false, error: staged.error };
    stagingDir = staged.value.stagingDir;

    const swapped = swapIntoPlace(stagingDir, target);
    if (!swapped.ok) {
      discardStaging(stagingDir);
      return { ok: false, error: swapped.error };
    }
    stagingDir = undefined;

    const summary: BrowserImportSummary = {
      sourceBrowserId: request.source.browserId,
      sourceBrowserLabel: request.source.browserLabel,
      sourceProfile: request.source.profileName,
      sourceProfileDir: request.source.profileDir,
      importedAt: (request.now ?? new Date()).toISOString(),
      bytesCopied: snapshot.bytes,
    };
    return { ok: true, summary, parts: snapshot.parts, bytes: snapshot.bytes, warnings: snapshot.warnings };
  } finally {
    discardStaging(snapshotRoot);
    if (stagingDir) discardStaging(stagingDir);
  }
}
