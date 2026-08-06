import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ImageGenSettings } from './types.js';

export const SETTINGS_KEY = 'pi-image-gen';
export const TRUSTED_CWD_ENV = 'PI_IMAGE_GEN_TRUSTED_CWD';

export type SettingsScope = 'global' | 'project';

type JsonObject = Record<string, unknown>;

function activeConfigDir(): string {
  return resolve(
    process.env.PI_CODING_AGENT_DIR?.trim() ||
      process.env.PI_AGENT_HOME?.trim() ||
      join(homedir(), '.pi', 'agent'),
  );
}

function defaultConfigDir(): string {
  return resolve(join(homedir(), '.pi', 'agent'));
}

export function imageGenSettingsPath(cwd: string, scope: SettingsScope): string {
  return scope === 'project'
    ? join(resolve(cwd), '.pi', 'settings.json')
    : join(activeConfigDir(), 'settings.json');
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readDocument(path: string, strict: boolean): JsonObject | undefined {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isObject(parsed)) throw new Error('expected a JSON object');
    return parsed;
  } catch (error) {
    if (!strict) return undefined;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not valid settings JSON (${message}). Fix it first; refusing to overwrite it.`);
  }
}

const API_STYLES = new Set(['openai', 'gemini', 'dashscope', 'openrouter', 'ark']);

function hasOptionalString(value: JsonObject, key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(value, key) || typeof value[key] === 'string';
}

function hasValidHeaders(value: JsonObject): boolean {
  if (!Object.prototype.hasOwnProperty.call(value, 'headers')) return true;
  const headers = value.headers;
  return isObject(headers) && Object.values(headers).every((entry) => typeof entry === 'string');
}

function hasValidModels(value: JsonObject): boolean {
  if (!Object.prototype.hasOwnProperty.call(value, 'models')) return true;
  return Array.isArray(value.models) && value.models.every((entry) => {
    if (typeof entry === 'string') return true;
    return (
      isObject(entry) &&
      typeof entry.id === 'string' &&
      hasOptionalString(entry, 'alias') &&
      hasOptionalString(entry, 'name')
    );
  });
}

function validProvider(value: unknown, custom: boolean): boolean {
  if (!isObject(value)) return false;
  if (!hasOptionalString(value, 'apiKey') || !hasOptionalString(value, 'baseUrl') || !hasValidHeaders(value)) {
    return false;
  }
  if (!custom) return true;
  return (
    typeof value.api === 'string' &&
    API_STYLES.has(value.api) &&
    hasOptionalString(value, 'name') &&
    hasValidModels(value)
  );
}

function invalidSection(strict: boolean): ImageGenSettings {
  if (strict) throw new Error(`${SETTINGS_KEY} has an invalid nested shape.`);
  return {};
}

function sectionFromDocument(document: JsonObject | undefined, strict: boolean): ImageGenSettings {
  if (!document || !Object.prototype.hasOwnProperty.call(document, SETTINGS_KEY)) return {};
  const section = document[SETTINGS_KEY];
  if (!isObject(section)) return invalidSection(strict);
  if (!hasOptionalString(section, 'defaultModel') || !hasOptionalString(section, 'outputDir')) {
    return invalidSection(strict);
  }
  if (Object.prototype.hasOwnProperty.call(section, 'providers')) {
    if (!isObject(section.providers) || !Object.values(section.providers).every((value) => validProvider(value, false))) {
      return invalidSection(strict);
    }
  }
  if (Object.prototype.hasOwnProperty.call(section, 'customProviders')) {
    if (
      !isObject(section.customProviders) ||
      !Object.values(section.customProviders).every((value) => validProvider(value, true))
    ) {
      return invalidSection(strict);
    }
  }
  return section as ImageGenSettings;
}

function mergeProviderMaps<T extends Record<string, unknown>>(
  base: T | undefined,
  next: T | undefined,
): T | undefined {
  if (!base && !next) return undefined;
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  for (const [name, value] of Object.entries(next ?? {})) {
    const previous = merged[name];
    merged[name] = isObject(previous) && isObject(value) ? { ...previous, ...value } : value;
  }
  return merged as T;
}

export function mergeImageGenSettings(
  base: ImageGenSettings,
  next: ImageGenSettings,
): ImageGenSettings {
  const providers = mergeProviderMaps(
    base.providers as Record<string, unknown> | undefined,
    next.providers as Record<string, unknown> | undefined,
  ) as ImageGenSettings['providers'];
  const customProviders = mergeProviderMaps(
    base.customProviders as Record<string, unknown> | undefined,
    next.customProviders as Record<string, unknown> | undefined,
  ) as ImageGenSettings['customProviders'];
  return {
    ...base,
    ...next,
    ...(providers ? { providers } : {}),
    ...(customProviders ? { customProviders } : {}),
  };
}

/** Runtime reads are fail-soft; project settings participate only after Pi trust. */
export function loadImageGenSettings(cwd: string, projectTrusted = false): ImageGenSettings {
  const paths = [join(defaultConfigDir(), 'settings.json')];
  const active = imageGenSettingsPath(cwd, 'global');
  if (active !== paths[0]) paths.push(active);
  if (projectTrusted) paths.push(imageGenSettingsPath(cwd, 'project'));

  let settings: ImageGenSettings = {};
  for (const path of paths) {
    settings = mergeImageGenSettings(
      settings,
      sectionFromDocument(readDocument(path, false), false),
    );
  }
  return settings;
}

/** Strict layer read for an interactive write flow. */
export function readImageGenSettingsLayer(cwd: string, scope: SettingsScope): ImageGenSettings {
  const path = imageGenSettingsPath(cwd, scope);
  return sectionFromDocument(readDocument(path, true), true);
}

/**
 * Atomically mutate one settings layer while preserving unrelated settings.
 * The latest file is re-read at commit time so unrelated concurrent changes survive.
 */
export function updateImageGenSettings(
  cwd: string,
  scope: SettingsScope,
  mutate: (current: ImageGenSettings) => ImageGenSettings,
): string {
  const path = imageGenSettingsPath(cwd, scope);
  const document = readDocument(path, true) ?? {};
  const current = sectionFromDocument(document, true);
  const next = mutate(structuredClone(current));
  document[SETTINGS_KEY] = next;

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.pi-image-gen-${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  return path;
}

function canonicalCwd(cwd: string): string {
  return resolve(cwd);
}

/** Pass Pi's authoritative session trust decision to package CLI child processes. */
export function exposeProjectTrustToCli(cwd: string, trusted: boolean): void {
  if (trusted) process.env[TRUSTED_CWD_ENV] = canonicalCwd(cwd);
  else delete process.env[TRUSTED_CWD_ENV];
}

export function isCliProjectTrusted(cwd: string): boolean {
  return process.env[TRUSTED_CWD_ENV] === canonicalCwd(cwd);
}
