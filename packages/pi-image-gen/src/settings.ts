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
import { API_STYLES as MODEL_API_STYLES } from './models.js';
import { isLegacyDocument, migrateLegacySettings } from './migrate.js';
import type { DefaultRoute, ImageGenSettings, ImageProvider } from './types.js';

export const SETTINGS_DIRNAME = 'pi-image-gen';
export const SETTINGS_FILENAME = 'settings.json';
export const SETTINGS_VERSION = 2;
export const LEGACY_BACKUP_FILENAME = 'settings.json.v1.bak';

type JsonObject = Record<string, unknown>;

function activeConfigDir(): string {
  return resolve(
    process.env.PI_CODING_AGENT_DIR?.trim() ||
      process.env.PI_AGENT_HOME?.trim() ||
      join(homedir(), '.pi', 'agent'),
  );
}

/** Dedicated package config file: <config dir>/pi-image-gen/settings.json. */
export function imageGenSettingsPath(): string {
  return join(activeConfigDir(), SETTINGS_DIRNAME, SETTINGS_FILENAME);
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

const API_STYLES = new Set<string>(MODEL_API_STYLES);

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
    if (!isObject(entry) || typeof entry.id !== 'string') return false;
    return hasOptionalString(entry, 'alias') && hasOptionalString(entry, 'name');
  });
}

function validRow(value: unknown): value is ImageProvider {
  if (!isObject(value)) return false;
  if (
    !hasOptionalString(value, 'apiKey') ||
    !hasOptionalString(value, 'baseUrl') ||
    !hasOptionalString(value, 'name') ||
    !hasValidHeaders(value) ||
    !hasValidModels(value)
  ) {
    return false;
  }
  return !Object.prototype.hasOwnProperty.call(value, 'api') || (typeof value.api === 'string' && API_STYLES.has(value.api));
}

function validDefault(value: unknown): value is DefaultRoute {
  return isObject(value) && hasOptionalString(value, 'provider') && hasOptionalString(value, 'model');
}

function invalidSection(strict: boolean): ImageGenSettings | undefined {
  if (strict) throw new Error(`${SETTINGS_DIRNAME} settings have an invalid shape.`);
  return undefined;
}

/** Validates a v2 document; the top-level object IS the settings. */
function parseVersion2(document: JsonObject, strict: boolean): ImageGenSettings | undefined {
  if (typeof document.version !== 'number' || document.version > SETTINGS_VERSION) {
    if (strict) {
      throw new Error(
        `${imageGenSettingsPath()} was written by a newer pi-image-gen (version ${String(document.version)}); refusing to rewrite it.`,
      );
    }
    return invalidSection(false);
  }
  if (!hasOptionalString(document, 'outputDir')) return invalidSection(strict);
  if (!validDefault(document.default ?? {})) return invalidSection(strict);
  if (Object.prototype.hasOwnProperty.call(document, 'providers')) {
    if (!isObject(document.providers) || !Object.values(document.providers).every(validRow)) {
      return invalidSection(strict);
    }
  }
  return document as ImageGenSettings;
}

function writeAtomic(path: string, settings: ImageGenSettings): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const body = { ...settings, version: SETTINGS_VERSION };
  const temp = `${path}.pi-image-gen-${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * A v1 file is converted once and persisted, with the original kept beside it
 * as `settings.json.v1.bak`. Failing to persist is never fatal: the converted
 * in-memory settings still work, and a user file is never overwritten with
 * something we did not read back intact.
 */
function migrateAndPersist(path: string, document: JsonObject, text: string): ImageGenSettings | undefined {
  const settings = migrateLegacySettings(document);
  if (!settings) return undefined;
  try {
    writeFileSync(join(dirname(path), LEGACY_BACKUP_FILENAME), text, { encoding: 'utf8', mode: 0o600 });
    writeAtomic(path, settings);
  } catch {
    // Read-only or concurrent writes keep the runtime usable.
  }
  return settings;
}

function loadSettings(path: string, strict: boolean): ImageGenSettings {
  if (!existsSync(path)) return {};
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const document = readDocument(path, strict);
  if (!document) return {};
  if (isLegacyDocument(document)) {
    const migrated = migrateAndPersist(path, document, text);
    if (migrated) return migrated;
    return invalidSection(strict) ?? {};
  }
  return parseVersion2(document, strict) ?? {};
}

/** Runtime reads are fail-soft. */
export function loadImageGenSettings(): ImageGenSettings {
  return loadSettings(imageGenSettingsPath(), false);
}

/** Strict read for an interactive write flow. */
export function readImageGenSettingsLayer(): ImageGenSettings {
  return loadSettings(imageGenSettingsPath(), true);
}

/**
 * Atomically rewrite the package settings file as v2. The latest file is
 * re-read at commit time, so a concurrent writer is not silently clobbered.
 */
export function updateImageGenSettings(
  mutate: (current: ImageGenSettings) => ImageGenSettings,
): string {
  const path = imageGenSettingsPath();
  const current = readImageGenSettingsLayer();
  const next = mutate(structuredClone(current));
  writeAtomic(path, next);
  return path;
}
