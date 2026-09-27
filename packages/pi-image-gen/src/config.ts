import {
  BUILT_IN_PROVIDER_IDS,
  DEFAULT_API_STYLE,
  DEFAULT_BASE_URL,
  ENV_VARS,
  PROVIDER_DISPLAY_NAME,
} from './models.js';
import type {
  BuiltInProviderId,
  ImageGenSettings,
  ImageModelEntry,
  ImageProvider,
  ResolvedModel,
  ResolvedProvider,
} from './types.js';


/**
 * Returns the resolved value for an apiKey/header field. Supports `$VAR`
 * and `${VAR}` env substitution; returns undefined for missing env vars
 * so downstream code can fall through to defaults.
 *
 * Resolution happens here so settings from disk and settings constructed in
 * code get identical behavior.
 */
export function resolveConfigString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const replaced = value.replace(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g, (_match, braced, bare) => {
    const name = (braced ?? bare) as string | undefined;
    if (!name) return '';
    const [varName, ...rest] = name.split(':-');
    const fallback = rest.join(':-');
    const env = process.env[varName!];
    return env !== undefined && env !== '' ? env : fallback;
  });
  return replaced.length > 0 ? replaced : undefined;
}

export function configEnvironmentValues(value: string | undefined): string[] {
  if (!value) return [];
  const values: string[] = [];
  for (const match of value.matchAll(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g)) {
    const expression = (match[1] ?? match[2]) as string | undefined;
    const name = expression?.split(':-')[0];
    const resolved = name ? process.env[name] : undefined;
    if (resolved) values.push(resolved);
  }
  return values;
}

function resolveHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const resolved = Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) => {
      const resolvedValue = resolveConfigString(value);
      return resolvedValue === undefined ? [] : [[name, resolvedValue]];
    }),
  );
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function buildBuiltInProvider(
  id: BuiltInProviderId,
  settings: ImageGenSettings,
): ResolvedProvider | undefined {
  const override = settings.providers?.[id] ?? {};
  const apiKey = Object.prototype.hasOwnProperty.call(override, 'apiKey')
    ? resolveConfigString(override.apiKey)
    : process.env[ENV_VARS[id]];
  const provider: ResolvedProvider = {
    id,
    api: DEFAULT_API_STYLE[id],
    baseUrl: resolveConfigString(override.baseUrl) ?? DEFAULT_BASE_URL[id],
    name: override.name ?? PROVIDER_DISPLAY_NAME[id],
    builtIn: true,
  };
  if (apiKey) provider.apiKey = apiKey;
  const headers = resolveHeaders(override.headers);
  if (headers) provider.headers = headers;
  return provider;
}

function buildCustomProvider(id: string, row: ImageProvider): ResolvedProvider | undefined {
  const api = row.api;
  if (!api) return undefined;
  const baseUrl = resolveConfigString(row.baseUrl) ?? DEFAULT_BASE_URL[api as BuiltInProviderId];
  if (!baseUrl) return undefined;
  const provider: ResolvedProvider = {
    id,
    api,
    baseUrl,
    name: row.name ?? id,
    builtIn: false,
  };
  const apiKey = resolveConfigString(row.apiKey);
  if (apiKey) provider.apiKey = apiKey;
  const headers = resolveHeaders(row.headers);
  if (headers) provider.headers = headers;
  return provider;
}

export function isBuiltInProviderId(value: string): value is BuiltInProviderId {
  return (BUILT_IN_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Resolve a configured provider's route (protocol, base URL, credential,
 * headers) without needing a model id. Built-in ids work with no row at all:
 * their template and standard env var supply everything a row could.
 */
export function resolveProviderRoute(
  providerId: string,
  settings: ImageGenSettings,
): ResolvedProvider | undefined {
  if (isBuiltInProviderId(providerId)) return buildBuiltInProvider(providerId, settings);
  const row = settings.providers?.[providerId];
  return row ? buildCustomProvider(providerId, row) : undefined;
}

/** Known models and aliases a provider row declares. Presentation and lookup only. */
export function declaredModels(
  settings: ImageGenSettings,
  providerId: string,
): ImageModelEntry[] {
  return (settings.providers?.[providerId]?.models ?? []).flatMap((entry) => {
    if (typeof entry === 'string') return [{ id: entry }];
    return entry?.id ? [entry] : [];
  });
}

function defaultRouteError(providerId: string, settings: ImageGenSettings): string {
  const rows = settings.providers ?? {};
  const listed = Object.keys(rows);
  if (!isBuiltInProviderId(providerId) && !listed.includes(providerId)) {
    const configured = listed.length > 0 ? listed.join(', ') : 'none configured yet';
    return `pi-image-gen default points at unknown provider "${providerId}". Configured providers: ${configured}. Run /image-gen in Pi to configure a provider.`;
  }
  if (!listed.includes(providerId)) {
    return `pi-image-gen provider "${providerId}" has no settings row and no API key. Set the ${ENV_VARS[providerId as BuiltInProviderId]} env var, or run /image-gen in Pi to configure it.`;
  }
  return `pi-image-gen provider "${providerId}" is missing its image API protocol. Run /image-gen in Pi to complete it.`;
}

/**
 * The one route the runtime generates with: `default` names a provider and a
 * remote model id explicitly, so nothing is inferred from a model string.
 */
export function resolveDefaultRoute(settings: ImageGenSettings): ResolvedModel | { error: string } {
  const providerId = settings.default?.provider?.trim();
  const remoteId = settings.default?.model?.trim();
  if (!providerId && !remoteId) {
    return { error: 'pi-image-gen default model is not set. Run /image-gen in Pi to configure the provider, model, and credentials.' };
  }
  if (!providerId) {
    return { error: `pi-image-gen default.model is set but default.provider is not. Run /image-gen in Pi to fix the route.` };
  }
  if (!remoteId) {
    return { error: `pi-image-gen default.provider "${providerId}" has no default.model. Run /image-gen in Pi to pick a model.` };
  }
  const provider = resolveProviderRoute(providerId, settings);
  // A route is only usable when the user set the provider up: either it has a
  // row of its own, or a built-in resolves a credential from the standard env.
  if (!provider || (!settings.providers?.[providerId] && !provider.apiKey)) {
    return { error: defaultRouteError(providerId, settings) };
  }
  const alias = declaredModels(settings, providerId).find((entry) => entry.id === remoteId)?.alias;
  return { provider, remoteId, requestedId: alias ?? remoteId };
}
