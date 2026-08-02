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

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read `"pi-vision": { "model": "provider/id" }` from pi's settings.
 * Project settings win over global, matching how pi layers its own settings.
 */
export function readConfiguredModelRef(cwd: string): string | undefined {
  const files = [globalSettingsPath(), projectSettingsPath(cwd)];
  let ref: string | undefined;
  for (const file of files) {
    const section = readJson(file)?.[SETTINGS_KEY];
    if (!section || typeof section !== "object") continue;
    const model = (section as Record<string, unknown>).model;
    if (typeof model === "string" && model.trim()) ref = model.trim();
  }
  return ref;
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
 * Set `pi-vision.model` in the global settings file, preserving every other key and the
 * file's permissions. Returns the path written. Refuses to touch a file that is not a
 * JSON object, so a typo elsewhere in settings.json is never destroyed by this command.
 */
export function writeConfiguredModelRef(ref: string): string {
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
  section.model = ref;
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

/**
 * Resolve the model image_ask delegates to. There is deliberately no fallback to
 * "first vision-capable model": that silently picks whichever model happens to be
 * first in models.json, which can be an expensive one. Failing with the candidate
 * list is cheaper for the user than a surprise bill.
 */
export async function resolveVisionModel(ctx: ExtensionContext): Promise<VisionModelResult> {
  const ref = readConfiguredModelRef(ctx.cwd);
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
