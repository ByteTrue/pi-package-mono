import { resolveConfigString } from './config.js';
import { API_STYLES, BUILT_IN_MODELS, BUILT_IN_PROVIDER_IDS, ENV_VARS } from './models.js';
import type { ApiStyle, BuiltInProviderId, DefaultRoute, ImageGenSettings, ImageProvider } from './types.js';

const API_STYLE_NAMES = new Set<string>(API_STYLES);
const BUILT_IN_IDS = new Set<string>(BUILT_IN_PROVIDER_IDS);

/**
 * Legacy (v1) on-disk shape: two provider containers and the route encoded in
 * a `defaultModel` string. It exists only here — nothing at runtime reads it.
 */
type LegacyProvider = {
  api?: ApiStyle;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models?: Array<string | { id: string; alias?: string; name?: string }>;
};

type LegacySettings = {
  defaultModel?: string;
  outputDir?: string;
  providers?: Record<string, LegacyProvider>;
  customProviders?: Record<string, LegacyProvider>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOptionalString(value: Record<string, unknown>, key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(value, key) || typeof value[key] === 'string';
}

function hasValidHeaders(value: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(value, 'headers')) return true;
  const headers = value.headers;
  return isRecord(headers) && Object.values(headers).every((entry) => typeof entry === 'string');
}

function hasValidModels(value: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(value, 'models')) return true;
  return Array.isArray(value.models) && value.models.every((entry) => {
    if (typeof entry === 'string') return true;
    if (!isRecord(entry) || typeof entry.id !== 'string') return false;
    return hasOptionalString(entry, 'alias') && hasOptionalString(entry, 'name');
  });
}

function validLegacyProvider(value: unknown, custom: boolean): value is LegacyProvider {
  if (!isRecord(value)) return false;
  if (!hasOptionalString(value, 'apiKey') || !hasOptionalString(value, 'baseUrl') || !hasValidHeaders(value)) {
    return false;
  }
  if (!custom) return true;
  return (
    typeof value.api === 'string' &&
    API_STYLE_NAMES.has(value.api) &&
    hasOptionalString(value, 'name') &&
    hasValidModels(value)
  );
}

/** Recognizes a v1 document, including one that is structurally unusable. */
export function isLegacyDocument(document: Record<string, unknown>): boolean {
  return document.version === undefined || document.version === 1;
}

function readLegacy(document: Record<string, unknown>): LegacySettings | undefined {
  if (!hasOptionalString(document, 'defaultModel') || !hasOptionalString(document, 'outputDir')) return undefined;
  if (Object.prototype.hasOwnProperty.call(document, 'providers')) {
    if (!isRecord(document.providers)) return undefined;
    if (!Object.values(document.providers).every((value) => validLegacyProvider(value, false))) return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(document, 'customProviders')) {
    if (!isRecord(document.customProviders)) return undefined;
    if (!Object.values(document.customProviders).every((value) => validLegacyProvider(value, true))) return undefined;
  }
  return document as unknown as LegacySettings;
}

function legacyCredential(legacy: LegacySettings, id: BuiltInProviderId): string | undefined {
  const override = legacy.providers?.[id];
  if (override && Object.prototype.hasOwnProperty.call(override, 'apiKey')) {
    return resolveConfigString(override.apiKey);
  }
  return process.env[ENV_VARS[id]];
}

/**
 * Replays the retired v1 model-resolution cascade to recover which provider a
 * `defaultModel` string meant. Returns undefined when v1 would have rejected it.
 */
function legacyRoute(legacy: LegacySettings): DefaultRoute | undefined {
  const requested = (legacy.defaultModel ?? '').trim();
  if (!requested) return undefined;

  for (const [name, provider] of Object.entries(legacy.customProviders ?? {})) {
    for (const entry of provider.models ?? []) {
      const id = typeof entry === 'string' ? entry : entry.id;
      const alias = typeof entry === 'string' ? undefined : entry.alias;
      if (alias === requested || id === requested) return { provider: name, model: id };
    }
  }

  const known = BUILT_IN_MODELS.find((model) => model.id === requested || model.aliases?.includes(requested));
  if (known && (legacyCredential(legacy, known.provider) || known.provider in (legacy.providers ?? {}))) {
    return { provider: known.provider, model: known.id };
  }

  const slash = requested.indexOf('/');
  if (slash > 0) {
    const key = requested.slice(0, slash);
    const remoteId = requested.slice(slash + 1);
    if (BUILT_IN_IDS.has(key)) return { provider: key, model: remoteId };
    if (legacy.customProviders?.[key]) return { provider: key, model: remoteId };
  }

  for (const [name, provider] of Object.entries(legacy.customProviders ?? {})) {
    if (provider.models && provider.models.length > 0) continue;
    return { provider: name, model: requested };
  }

  return undefined;
}

function toRow(provider: LegacyProvider, custom: boolean): ImageProvider {
  const row: ImageProvider = {};
  if (custom && provider.api) row.api = provider.api;
  if (provider.name !== undefined) row.name = provider.name;
  if (provider.baseUrl !== undefined) row.baseUrl = provider.baseUrl;
  if (provider.apiKey !== undefined) row.apiKey = provider.apiKey;
  if (provider.headers !== undefined) row.headers = provider.headers;
  if (provider.models !== undefined) row.models = provider.models;
  return row;
}

/**
 * Converts a v1 document into v2: one `providers` container, an explicit
 * `default` route, and a `models` list that no longer gates routing. A v1
 * `defaultModel` that v1 itself could not route is omitted. Returns undefined
 * when the v1 document is unusable, leaving it untouched.
 */
export function migrateLegacySettings(document: Record<string, unknown>): ImageGenSettings | undefined {
  const legacy = readLegacy(document);
  if (!legacy) return undefined;

  const providers: Record<string, ImageProvider> = {};
  for (const [id, override] of Object.entries(legacy.providers ?? {})) {
    if (BUILT_IN_IDS.has(id)) providers[id] = toRow(override, false);
  }
  for (const [name, custom] of Object.entries(legacy.customProviders ?? {})) {
    if (name in providers) return undefined;
    providers[name] = toRow(custom, true);
  }

  const settings: ImageGenSettings = { version: 2, outputDir: legacy.outputDir, providers };
  if (!settings.outputDir) delete settings.outputDir;
  if (Object.keys(providers).length === 0) delete settings.providers;

  const route = legacyRoute(legacy);
  if (route) settings.default = route;
  return settings;
}
