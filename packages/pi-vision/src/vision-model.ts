import type { Api, Model, ProviderHeaders } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SETTINGS_KEY = "pi-vision";
export const COMMAND_NAME = "vision";
const PKG_CONFIG_DIRNAME = "pi-pkg-cfg";
const PKG_DIRNAME = "pi-vision";
const PKG_FILENAME = "settings.json";

/** <agent dir> = $PI_CODING_AGENT_DIR or ~/.pi/agent. */
function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

/** Where writes go: $PI_PKG_CFG_DIR, else <agent dir>/pi-pkg-cfg. */
function newSettingsPath(): string {
  const root = process.env.PI_PKG_CFG_DIR?.trim() || join(agentDir(), PKG_CONFIG_DIRNAME);
  return join(root, PKG_DIRNAME, PKG_FILENAME);
}

/** Where the section used to live: the `pi-vision` key inside Pi's settings.json. */
function legacyGlobalSettingsPath(): string {
  return join(agentDir(), "settings.json");
}

/** For status lines: says out loud when Pi's settings.json is still the live one. */
export function describeGlobalSettingsPath(): string {
  const { path, legacy } = settingsLocation();
  return legacy ? `${path} (legacy (read-only fallback))` : path;
}

/** Where the project layer writes: `<cwd>/.pi/pi-pkg-cfg/pi-vision/settings.json`. */
export function projectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", PKG_CONFIG_DIRNAME, PKG_DIRNAME, PKG_FILENAME);
}

export type SettingsLocation = { path: string; legacy: boolean };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Parsed JSON object, or undefined when the file is missing or not a JSON object. */
function readObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Any directory entry, file or not: a legacy path that exists but cannot be read still fails closed. */
function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** The `pi-vision` section of a legacy file: undefined = absent, null = not a JSON object. */
function legacySection(root: Record<string, unknown>): Record<string, unknown> | null | undefined {
  if (!hasOwn(root, SETTINGS_KEY)) return undefined;
  const section = root[SETTINGS_KEY];
  return isObject(section) ? section : null;
}

/** One atomic write: same-directory temp file plus rename. */
function writeSectionFile(path: string, section: Record<string, unknown>, mode: number): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.pi-vision-${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(section, null, 2), { mode });
  renameSync(tmp, path);
}

/**
 * The global file this run reads, and whether the value comes from the legacy
 * `pi-vision` section in Pi's settings.json. An unmigrated section is lifted out
 * in one atomic write on first touch, so a later `/vision` edit cannot silently
 * drop the keys it does not touch. An unreadable section is never copied, and
 * Pi's file is never modified.
 */
export function settingsLocation(): SettingsLocation {
  const target = newSettingsPath();
  if (isFile(target)) return { path: target, legacy: false };
  const legacy = legacyGlobalSettingsPath();
  if (legacy === target || !pathExists(legacy)) return { path: target, legacy: false };
  const root = readObject(legacy);
  if (!root) return { path: legacy, legacy: true };
  const section = legacySection(root);
  if (section === undefined) return { path: target, legacy: false };
  if (section === null) return { path: legacy, legacy: true };
  try {
    writeSectionFile(target, section, 0o600);
    return { path: target, legacy: false };
  } catch {
    return { path: legacy, legacy: true };
  }
}

/**
 * The project layer: its own file first, else the legacy section in
 * `<cwd>/.pi/settings.json`. Never writes — a project override is the user's.
 */
export function projectLocation(cwd: string): SettingsLocation {
  const target = projectSettingsPath(cwd);
  if (isFile(target)) return { path: target, legacy: false };
  const legacy = join(cwd, ".pi", "settings.json");
  if (legacy === target || !pathExists(legacy)) return { path: target, legacy: false };
  return { path: legacy, legacy: true };
}

/** For status lines: says out loud when a project layer still lives in `.pi/settings.json`. */
export function describeProjectSettingsPath(cwd: string): string {
  const { path, legacy } = projectLocation(cwd);
  return legacy ? `${path} (legacy (read-only fallback))` : path;
}

export interface VisionAuth {
  apiKey?: string;
  headers?: ProviderHeaders;
  env?: Record<string, string>;
}

export type VisionModelResult =
  | { ok: true; model: Model<Api>; auth: VisionAuth }
  | { ok: false; error: string };

/** `provider/modelId`; model ids may themselves contain `/` (e.g. `vendor/minimax-m3`). */
function splitModelRef(ref: string): { provider: string; modelId: string } | undefined {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

function visionCapable(models: readonly Model<Api>[]): Model<Api>[] {
  return models.filter((m) => m.input.includes("image"));
}

type JsonRead =
  | { state: "missing" }
  | { state: "invalid" }
  | { state: "valid"; value: Record<string, unknown> };

function readJson(path: string): JsonRead {
  if (!pathExists(path)) return { state: "missing" };
  const parsed = readObject(path);
  return parsed ? { state: "valid", value: parsed } : { state: "invalid" };
}

/** One layer's `pi-vision` section: our own file holds it at the root, a legacy file nests it. */
function readSection(read: JsonRead, legacy: boolean): JsonRead {
  if (read.state !== "valid" || !legacy) return read;
  const section = legacySection(read.value);
  if (section === undefined) return { state: "missing" };
  return section === null ? { state: "invalid" } : { state: "valid", value: section };
}

function readLayeredValue(
  cwd: string,
  projectTrusted: boolean,
  key: "model" | "autoAnalyzeAttachments",
): unknown {
  const locations = projectTrusted
    ? [settingsLocation(), projectLocation(cwd)]
    : [settingsLocation()];
  let value: unknown;
  for (const location of locations) {
    const result = readSection(readJson(location.path), location.legacy);
    if (result.state === "missing") continue;
    if (result.state === "invalid") {
      value = undefined;
      continue;
    }
    if (hasOwn(result.value, key)) value = result.value[key];
  }
  return value;
}

/** Project settings participate only after Pi has marked the project trusted. */
export function readConfiguredModelRef(cwd: string, projectTrusted: boolean): string | undefined {
  const model = readLayeredValue(cwd, projectTrusted, "model");
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

export function readAutoAnalyzeAttachments(cwd: string, projectTrusted: boolean): boolean {
  return readLayeredValue(cwd, projectTrusted, "autoAnalyzeAttachments") === true;
}

function listCandidates(ctx: ExtensionContext): string {
  const candidates = visionCapable(ctx.modelRegistry.getAvailable()).map(
    (m) => `  "${m.provider}/${m.id}"`,
  );
  if (candidates.length === 0) {
    return "No vision-capable model is configured in models.json. Add one first (see the pi-vendor skill).";
  }
  return `Vision-capable models currently available:\n${candidates.slice(0, 20).join("\n")}`;
}

function settingsHint(cwd: string): string {
  return `Run /${COMMAND_NAME} to pick one, or set it in ${describeGlobalSettingsPath()} (or ${describeProjectSettingsPath(cwd)}):\n  { "model": "provider/model-id" }`;
}

/** Vision-capable models from the live registry, as `provider/id` refs. */
export function listVisionModelRefs(models: readonly Model<Api>[]): string[] {
  return visionCapable(models).map((m) => `${m.provider}/${m.id}`);
}

/** The file's JSON object, or a refusal to clobber what we cannot parse. */
function readSettingsObject(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON. Fix it first; refusing to overwrite it.`);
  }
  if (!isObject(parsed)) {
    throw new Error(`${path} is not a JSON object. Refusing to overwrite it.`);
  }
  return parsed;
}

/**
 * Set one pi-vision value in our own global file, preserving the section's other keys and
 * the file's permissions. An unmigrated legacy section is lifted into the same single
 * write (never a copy followed by a rewrite). Refuses to touch malformed settings.
 */
function writeSetting(key: "model" | "autoAnalyzeAttachments", value: string | boolean): string {
  const path = newSettingsPath();
  let section: Record<string, unknown> = {};
  let mode = 0o600;

  if (isFile(path)) {
    section = { ...readSettingsObject(path) };
    mode = statSync(path).mode & 0o777;
  } else {
    const legacy = legacyGlobalSettingsPath();
    if (legacy !== path && pathExists(legacy)) {
      const inherited = legacySection(readSettingsObject(legacy));
      if (inherited === null) {
        throw new Error(
          `${legacy} has a "${SETTINGS_KEY}" key that is not a JSON object. Refusing to overwrite it.`,
        );
      }
      if (inherited) section = { ...inherited };
    }
  }

  section[key] = value;
  writeSectionFile(path, section, mode);
  return path;
}

export function writeConfiguredModelRef(ref: string): string {
  return writeSetting("model", ref);
}

export function writeAutoAnalyzeAttachments(enabled: boolean): string {
  return writeSetting("autoAnalyzeAttachments", enabled);
}

/**
 * Resolve the model image_ask delegates to. There is deliberately no fallback to
 * "first vision-capable model": that silently picks whichever model happens to be
 * first in models.json, which can be an expensive one. Failing with the candidate
 * list is cheaper for the user than a surprise bill.
 */
export async function resolveVisionModel(ctx: ExtensionContext): Promise<VisionModelResult> {
  const ref = readConfiguredModelRef(ctx.cwd, ctx.isProjectTrusted());
  if (!ref) {
    return {
      ok: false,
      error: `No vision model configured for ${SETTINGS_KEY}.\n${settingsHint(ctx.cwd)}\n${listCandidates(ctx)}`,
    };
  }

  // Match the whole ref against `${provider}/${id}` first, like pi's own /model
  // resolver: provider ids may contain "/" (URL-style providers such as
  // "llama-server=http://127.0.0.1:8080"), where splitting at the first slash
  // would cut inside the URL.
  let model = ctx.modelRegistry.getAvailable().find((m) => `${m.provider}/${m.id}` === ref);
  if (!model) {
    const parts = splitModelRef(ref);
    if (!parts) {
      return {
        ok: false,
        error: `${SETTINGS_KEY}.model must be "provider/model-id", got "${ref}".\n${listCandidates(ctx)}`,
      };
    }
    model = ctx.modelRegistry.find(parts.provider, parts.modelId);
  }
  if (!model) {
    return {
      ok: false,
      error: `Vision model "${ref}" is not in models.json.\n${listCandidates(ctx)}`,
    };
  }
  if (!model.input.includes("image")) {
    return {
      ok: false,
      error: `Vision model "${ref}" does not accept image input.\n${listCandidates(ctx)}`,
    };
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    // Deliberately not echoing auth.error: it can quote configuration details.
    return {
      ok: false,
      error: `Credentials for provider "${model.provider}" could not be resolved. Check that provider's apiKey in models.json.`,
    };
  }

  return { ok: true, model, auth: { apiKey: auth.apiKey, headers: auth.headers, env: auth.env } };
}
