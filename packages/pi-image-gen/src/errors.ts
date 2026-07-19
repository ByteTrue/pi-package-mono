import type { ResolvedProvider } from './types.js';

/**
 * Build an error message that an LLM can act on without a human in the loop.
 *
 * The shape is:
 *   "<short verb-phrase>. <hint addressed to the LLM>."
 *
 * The first sentence describes what happened so a human reading the transcript
 * understands. The second sentence tells the LLM what to do — typically "tell
 * the user to verify X" — so the model doesn't fall back to vague apologies or
 * pointless retries.
 */
export function classifyHttpError(res: Response, body: string, provider: ResolvedProvider): string {
  const where = providerLocator(provider);
  const peek = body.slice(0, 200).replace(/\s+/g, ' ');

  if (res.status === 401 || res.status === 403) {
    return `${provider.name} rejected the API key (HTTP ${res.status}). Tell the user to verify ${where}. Do not retry — this will keep failing until the key is fixed.`;
  }
  if (res.status === 404) {
    return `${provider.name} returned 404 at this baseUrl. Tell the user to verify ${providerBaseUrlLocator(provider)} — the model id may be wrong, or this gateway doesn't expose the image API. Body: ${peek}`;
  }
  if (res.status === 429) {
    return `${provider.name} rate-limited the request (HTTP 429). Wait a few seconds before retrying, or suggest a different provider/model. Body: ${peek}`;
  }
  if (res.status >= 500 && res.status < 600) {
    return `${provider.name} had a server-side failure (HTTP ${res.status}). This is likely transient — one retry is reasonable, but if it keeps failing tell the user the provider is down. Body: ${peek}`;
  }
  if (res.status === 400 || res.status === 422) {
    return `${provider.name} rejected the request (HTTP ${res.status}) — likely a bad parameter or unsupported model id. Tell the user the model name or size may not be supported by this provider. Body: ${peek}`;
  }
  return `${provider.name} returned HTTP ${res.status}. Body: ${peek}`;
}

/** Wrap a non-HTTP error (timeout, network, parse) with a hint for the LLM. */
export function describeNetworkError(error: unknown, provider: ResolvedProvider): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/abort/i.test(msg)) {
    return `Request to ${provider.name} was cancelled.`;
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(msg)) {
    return `Request to ${provider.name} timed out. The provider was too slow — try a smaller \`n\`, a different model, or check ${providerBaseUrlLocator(provider)}. Original: ${msg}`;
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET/i.test(msg)) {
    return `Cannot reach ${provider.name}. Tell the user to check network connectivity or verify ${providerBaseUrlLocator(provider)}. Original: ${msg}`;
  }
  return `${provider.name} request failed: ${msg}`;
}

/**
 * Returns a settings-path string that points to where the user should fix
 * the apiKey. For built-ins we name the env var; for customProviders we name
 * the JSON path.
 */
function providerLocator(provider: ResolvedProvider): string {
  if (provider.builtIn) {
    const envVar = BUILT_IN_ENV_VAR[provider.id] ?? `${provider.id.toUpperCase()}_API_KEY`;
    return `the ${envVar} env var (or pi-image-gen.providers.${provider.id}.apiKey in settings.json)`;
  }
  return `pi-image-gen.customProviders.${provider.id}.apiKey in settings.json`;
}

function providerBaseUrlLocator(provider: ResolvedProvider): string {
  if (provider.builtIn) {
    return `pi-image-gen.providers.${provider.id}.baseUrl`;
  }
  return `pi-image-gen.customProviders.${provider.id}.baseUrl`;
}

const BUILT_IN_ENV_VAR: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  dashscope: 'DASHSCOPE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};
