import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SETTINGS_KEY = "pi-vision";
export const COMMAND_NAME = "vision";

/** `~/.pi/agent/settings.json`, or the same file under $PI_CODING_AGENT_DIR. */
export function globalSettingsPath(): string {
  return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "settings.json");
}

export function projectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

export interface VisionAuth {
  apiKey?: string;
  headers?: Record<string, string>;
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
  if (!existsSync(path)) return { state: "missing" };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { state: "valid", value: parsed as Record<string, unknown> }
      : { state: "invalid" };
  } catch {
    return { state: "invalid" };
  }
}

function readLayeredValue(
  cwd: string,
  projectTrusted: boolean,
  key: "model" | "autoAnalyzeAttachments",
): unknown {
  const files = projectTrusted
    ? [globalSettingsPath(), projectSettingsPath(cwd)]
    : [globalSettingsPath()];
  let value: unknown;
  for (const file of files) {
    const result = readJson(file);
    if (result.state === "missing") continue;
    if (result.state === "invalid") {
      value = undefined;
      continue;
    }
    const settings = result.value;
    if (!Object.prototype.hasOwnProperty.call(settings, SETTINGS_KEY)) continue;
    const section = settings[SETTINGS_KEY];
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      value = undefined;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(section, key)) {
      value = (section as Record<string, unknown>)[key];
    }
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
  return `Run /${COMMAND_NAME} to pick one, or set it in ${globalSettingsPath()} (or ${projectSettingsPath(cwd)}):\n  { "${SETTINGS_KEY}": { "model": "provider/model-id" } }`;
}

/** Vision-capable models from the live registry, as `provider/id` refs. */
export function listVisionModelRefs(models: readonly Model<Api>[]): string[] {
  return visionCapable(models).map((m) => `${m.provider}/${m.id}`);
}

/**
 * Set one pi-vision value in the global settings file, preserving every other key and
 * the file's permissions. Refuses to touch malformed settings.
 */
function writeSetting(key: "model" | "autoAnalyzeAttachments", value: string | boolean): string {
  const path = globalSettingsPath();
  let settings: Record<string, unknown> = {};
  let mode = 0o600;

  if (existsSync(path)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new Error(`${path} is not valid JSON. Fix it first; refusing to overwrite it.`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${path} is not a JSON object. Refusing to overwrite it.`);
    }
    settings = parsed as Record<string, unknown>;
    mode = statSync(path).mode & 0o777;
  }

  const existing = settings[SETTINGS_KEY];
  const section =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  section[key] = value;
  settings[SETTINGS_KEY] = section;

  // ponytail: no lockfile, unlike pi's own settings writer. A /settings write landing in the
  // same millisecond as this one would be lost. The window is a human typing /vision; add
  // locking only if that is ever actually observed.
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.pi-vision-${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode });
  renameSync(tmp, path);
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

  const parts = splitModelRef(ref);
  if (!parts) {
    return {
      ok: false,
      error: `${SETTINGS_KEY}.model must be "provider/model-id", got "${ref}".\n${listCandidates(ctx)}`,
    };
  }

  const model = ctx.modelRegistry.find(parts.provider, parts.modelId);
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
      error: `Credentials for provider "${parts.provider}" could not be resolved. Check that provider's apiKey in models.json.`,
    };
  }

  return { ok: true, model, auth: { apiKey: auth.apiKey, headers: auth.headers, env: auth.env } };
}
