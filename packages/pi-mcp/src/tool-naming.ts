// tool-naming.ts — server namespace + tool-name formatting/pattern helpers,
// ported verbatim from pi-mcp-adapter's types.ts (MIT). Prefix modes other
// than "server" are retained so migrated configs and cached names resolve.
import { createHash } from "node:crypto";

export type ToolPrefix = "server" | "none" | "short" | "mcp";

const ENCODED_SERVER_NAMESPACE_MARKER = "_mcpns_";
// Provider tool-name limit (64 for Bedrock, Anthropic, OpenAI) minus the `mcp__` proxy prefix.
const MAX_SERVER_NAMESPACE_LENGTH = 59;

export function formatServerNamespace(serverName: string): string {
  const normalized = serverName.replace(/-/g, "_");
  const safe = /^[A-Za-z0-9_]*$/.test(normalized) && !normalized.startsWith(ENCODED_SERVER_NAMESPACE_MARKER);
  const body = safe ? normalized : encodeServerNamespace(normalized);
  const namespace = safe ? body : `${ENCODED_SERVER_NAMESPACE_MARKER}${body}`;
  if (namespace.length <= MAX_SERVER_NAMESPACE_LENGTH) return namespace;
  // Hash the ASCII encoding, not the raw name: lone surrogates and U+FFFD share UTF-8 bytes.
  const digest = createHash("sha256").update(namespace, "utf8").digest("hex").slice(0, 16);
  // `_h_` cannot start an encoded body: `h` is neither `_` nor a hexadecimal digit.
  const hashPrefix = `${ENCODED_SERVER_NAMESPACE_MARKER}_h_`;
  const head = body.slice(0, MAX_SERVER_NAMESPACE_LENGTH - hashPrefix.length - digest.length - 1);
  return `${hashPrefix}${head}_${digest}`;
}

// `_` becomes `__`, so `__` and `_<hex>_` form a prefix code and the encoding stays injective.
function encodeServerNamespace(name: string): string {
  return Array.from(name, (character) => {
    if (character === "_") return "__";
    return /^[A-Za-z0-9]$/.test(character) ? character : `_${character.codePointAt(0)!.toString(16)}_`;
  }).join("");
}

function sanitizeServerPrefix(serverName: string, preserveProviderValid = true): string {
  const validCharacters = preserveProviderValid ? /^[A-Za-z0-9_-]$/ : /^[A-Za-z0-9]$/;
  return Array.from(serverName, (char) =>
    validCharacters.test(char) ? char : `_${char.codePointAt(0)!.toString(16)}_`,
  ).join("");
}

export function getServerPrefix(serverName: string, mode: ToolPrefix): string {
  if (mode === "none") return "";
  if (mode === "short") {
    let short = sanitizeServerPrefix(serverName.replace(/-?mcp$/i, ""));
    if (!short) short = "mcp";
    return short;
  }
  if (mode === "mcp") return `mcp__${sanitizeServerPrefix(serverName)}`;
  return sanitizeServerPrefix(serverName);
}

/** Format a tool name with server prefix. */
export function formatToolName(toolName: string, serverName: string, prefix: ToolPrefix): string {
  const p = getServerPrefix(serverName, prefix);
  const sanitized = toolName.replace(/\./g, "_");
  return p ? `${p}_${sanitized}` : sanitized;
}

export function resolveToolPrefix(
  definition?: Pick<{ toolPrefix?: ToolPrefix }, "toolPrefix">,
  globalPrefix?: ToolPrefix,
): ToolPrefix {
  return definition?.toolPrefix ?? globalPrefix ?? "server";
}

/**
 * All names a tool may be addressed by: original, every prefix mode, and the
 * legacy hyphen→underscore variants.
 */
export function getToolNameCandidates(toolName: string, serverName: string, prefix: ToolPrefix, includeLegacy = true): Set<string> {
  const candidates = new Set<string>([
    toolName,
    formatToolName(toolName, serverName, prefix),
    formatToolName(toolName, serverName, "server"),
    formatToolName(toolName, serverName, "short"),
    formatToolName(toolName, serverName, "mcp"),
  ]);
  if (includeLegacy) {
    const legacyToolName = toolName.replace(/-/g, "_");
    candidates.add(legacyToolName);
    candidates.add(formatToolName(legacyToolName, serverName, prefix));
    candidates.add(formatToolName(legacyToolName, serverName, "server"));
    candidates.add(formatToolName(legacyToolName, serverName, "short"));
    candidates.add(formatToolName(legacyToolName, serverName, "mcp"));
    candidates.add(formatLegacyToolName(toolName, serverName, prefix));
    candidates.add(formatLegacyToolName(toolName, serverName, "server"));
    candidates.add(formatLegacyToolName(toolName, serverName, "short"));
    candidates.add(formatLegacyToolName(toolName, serverName, "mcp"));
    candidates.add(formatToolName(toolName, serverName, prefix).replace(/-/g, "_"));
    candidates.add(formatToolName(toolName, serverName, "server").replace(/-/g, "_"));
    candidates.add(formatToolName(toolName, serverName, "short").replace(/-/g, "_"));
    candidates.add(formatToolName(toolName, serverName, "mcp").replace(/-/g, "_"));
  }
  return candidates;
}

function getLegacyServerPrefix(serverName: string, mode: ToolPrefix): string {
  if (mode === "none") return "";
  if (mode === "short") return sanitizeServerPrefix(serverName.replace(/-?mcp$/i, ""), false) || "mcp";
  if (mode === "mcp") return `mcp__${sanitizeServerPrefix(serverName, false)}`;
  return sanitizeServerPrefix(serverName, false);
}

function formatLegacyToolName(toolName: string, serverName: string, prefix: ToolPrefix): string {
  const p = getLegacyServerPrefix(serverName, prefix);
  const sanitized = toolName.replace(/[^A-Za-z0-9_-]/g, "_");
  return p ? `${p}_${sanitized}` : sanitized;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

/** includeTools/excludeTools matching against every candidate name of a tool. */
export function matchesToolPattern(candidates: Set<string>, patterns?: unknown): boolean {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;

  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    if (!pattern.includes("*") && !pattern.includes("?") && candidates.has(pattern)) {
      return true;
    }
    if ((pattern.includes("*") || pattern.includes("?")) && [...candidates].some((candidate) => globToRegExp(pattern).test(candidate))) {
      return true;
    }
  }
  return false;
}

export function isServerDisabled(definition: { disabled?: boolean } | undefined): boolean {
  return definition?.disabled === true;
}

export function sanitizePromptName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
  if (!cleaned) return "prompt";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function formatPromptCommandName(promptName: string, serverName: string, prefix: ToolPrefix): string {
  const serverPart = getServerPrefix(serverName, prefix) || sanitizeServerPrefix(serverName) || "server";
  return `mcp__${serverPart}__${sanitizePromptName(promptName)}`;
}

/** Structural subset of upstream's selector index (cached glob matchers). */
export interface ToolSelectorCandidateIndex {
  readonly allCurrentCandidates: ReadonlySet<string>;
  readonly matchingCountByPattern: Map<string, number>;
  readonly matcherByPattern: Map<string, RegExp>;
  readonly additionalCurrentCandidatesByToolName?: ReadonlyMap<string, ReadonlySet<string>>;
}

export type ToolSelectorCandidateContext = Set<string> | ToolSelectorCandidateIndex;

export function createToolSelectorCandidateIndex(
  allCurrentCandidates: Set<string>,
  additionalCurrentCandidatesByToolName?: ReadonlyMap<string, ReadonlySet<string>>,
): ToolSelectorCandidateIndex {
  return {
    allCurrentCandidates,
    matchingCountByPattern: new Map<string, number>(),
    matcherByPattern: new Map<string, RegExp>(),
    ...(additionalCurrentCandidatesByToolName ? { additionalCurrentCandidatesByToolName } : {}),
  };
}

function indexHasOtherCurrentMatch(
  index: ToolSelectorCandidateIndex,
  toolName: string,
  currentCandidates: Set<string>,
  pattern: string,
): boolean {
  const additionalCandidates = index.additionalCurrentCandidatesByToolName?.get(toolName);
  const hasCandidate = (candidate: string): boolean =>
    index.allCurrentCandidates.has(candidate) || additionalCandidates?.has(candidate) === true;
  const isGlob = pattern.includes("*") || pattern.includes("?");
  if (!isGlob) {
    return hasCandidate(pattern) && !currentCandidates.has(pattern);
  }

  let matcher = index.matcherByPattern.get(pattern);
  if (!matcher) {
    matcher = globToRegExp(pattern);
    index.matcherByPattern.set(pattern, matcher);
  }
  const hasOtherMatch = [...index.allCurrentCandidates].some(
    (candidate) => !currentCandidates.has(candidate) && matcher!.test(candidate),
  )
    || [...(additionalCandidates ?? [])].some((candidate) => !currentCandidates.has(candidate) && matcher!.test(candidate));
  return hasOtherMatch;
}

function matchesToolSelector(
  toolName: string,
  serverName: string,
  prefix: ToolPrefix,
  patterns: unknown,
  otherCurrentCandidates?: ToolSelectorCandidateContext,
): boolean {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const currentCandidates = getToolNameCandidates(toolName, serverName, prefix, false);
  if (matchesToolPattern(currentCandidates, patterns)) return true;
  if (!otherCurrentCandidates) return matchesToolPattern(getToolNameCandidates(toolName, serverName, prefix), patterns);
  const legacyCandidates = getToolNameCandidates(toolName, serverName, prefix);
  for (const candidate of currentCandidates) legacyCandidates.delete(candidate);
  return patterns.some(pattern => {
    if (typeof pattern !== "string" || !matchesToolPattern(legacyCandidates, [pattern])) return false;
    const hasCollision = otherCurrentCandidates instanceof Set
      ? matchesToolPattern(otherCurrentCandidates, [pattern])
      : indexHasOtherCurrentMatch(otherCurrentCandidates, toolName, currentCandidates, pattern);
    return !hasCollision;
  });
}

export function isToolIncluded(
  toolName: string,
  serverName: string,
  prefix: ToolPrefix,
  includeTools?: unknown,
  otherCurrentCandidates?: ToolSelectorCandidateContext,
): boolean {
  if (!Array.isArray(includeTools) || includeTools.length === 0) return true;
  return matchesToolSelector(toolName, serverName, prefix, includeTools, otherCurrentCandidates);
}

export function isToolExcluded(
  toolName: string,
  serverName: string,
  prefix: ToolPrefix,
  excludeTools?: unknown,
  otherCurrentCandidates?: ToolSelectorCandidateContext,
): boolean {
  return matchesToolSelector(toolName, serverName, prefix, excludeTools, otherCurrentCandidates);
}

export function isToolAllowed(
  toolName: string,
  serverName: string,
  prefix: ToolPrefix,
  includeTools?: unknown,
  excludeTools?: unknown,
  otherCurrentCandidates?: ToolSelectorCandidateContext,
): boolean {
  return isToolIncluded(toolName, serverName, prefix, includeTools, otherCurrentCandidates)
    && !isToolExcluded(toolName, serverName, prefix, excludeTools, otherCurrentCandidates);
}
