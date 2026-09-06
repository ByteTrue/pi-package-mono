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
export const SETTINGS_DIRNAME = 'pi-image-gen';
export const SETTINGS_FILENAME = 'settings.json';

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
  if (strict) throw new Error(`${SETTINGS_KEY} settings have an invalid shape.`);
  return {};
}

/** The dedicated file's top-level object IS the settings section. */
function sectionFromDocument(document: JsonObject | undefined, strict: boolean): ImageGenSettings {
  if (!document) return {};
  if (!hasOptionalString(document, 'defaultModel') || !hasOptionalString(document, 'outputDir')) {
    return invalidSection(strict);
  }
  if (Object.prototype.hasOwnProperty.call(document, 'providers')) {
    if (!isObject(document.providers) || !Object.values(document.providers).every((value) => validProvider(value, false))) {
      return invalidSection(strict);
    }
  }
  if (Object.prototype.hasOwnProperty.call(document, 'customProviders')) {
    if (
      !isObject(document.customProviders) ||
      !Object.values(document.customProviders).every((value) => validProvider(value, true))
    ) {
      return invalidSection(strict);
    }
  }
  return document as ImageGenSettings;
}

/** Runtime reads are fail-soft. */
export function loadImageGenSettings(): ImageGenSettings {
  return sectionFromDocument(readDocument(imageGenSettingsPath(), false), false);
}

/** Strict read for an interactive write flow. */
export function readImageGenSettingsLayer(): ImageGenSettings {
  return sectionFromDocument(readDocument(imageGenSettingsPath(), true), true);
}

/**
 * Atomically rewrite the package settings file, preserving unrelated
 * top-level keys. The latest file is re-read at commit time.
 */
export function updateImageGenSettings(
  mutate: (current: ImageGenSettings) => ImageGenSettings,
): string {
  const path = imageGenSettingsPath();
  const current = sectionFromDocument(readDocument(path, true), true);
  const next = mutate(structuredClone(current));

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.pi-image-gen-${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, {
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
