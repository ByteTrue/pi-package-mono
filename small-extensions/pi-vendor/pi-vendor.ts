/** pi-vendor small extension. Single-file bundle; runtime imports are limited to Node builtins and Pi host packages loaded from the running Pi. */

// packages/pi-vendor/src/config-core.ts
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { TextDecoder as TextDecoder2 } from "node:util";

// packages/pi-vendor/src/models-json.ts
import { homedir } from "node:os";
import { join } from "node:path";
function getModelsJsonPath() {
  const baseDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
  return join(baseDir, "models.json");
}

// packages/pi-vendor/src/config-core.ts
var MODELS_JSON_SCHEMA_URL = "https://pi.dev/schemas/models.schema.json";
var ConfigCoreError = class extends Error {
  code;
  path;
  issues;
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ConfigCoreError";
    this.code = code;
    this.path = options.path;
    this.issues = options.issues;
  }
};
var utf8 = new TextDecoder2("utf-8", { fatal: true });
function hashBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function issue(path, code, message) {
  return { path, code, message };
}
function validateModelsJson(models) {
  if (!isObject(models)) return [issue("$", "invalid_structure", "Models configuration must be an object")];
  if (!("providers" in models) || !isObject(models.providers)) {
    return [issue("/providers", "invalid_structure", "Models configuration must contain a providers object")];
  }
  const issues = [];
  for (const [providerKey2, provider] of Object.entries(models.providers)) {
    if (!isObject(provider) || !Array.isArray(provider.models)) continue;
    const seen = /* @__PURE__ */ new Set();
    for (const [index, model] of provider.models.entries()) {
      if (!isObject(model) || typeof model.id !== "string") continue;
      if (seen.has(model.id)) {
        issues.push(issue(`/providers/${escapePointer(providerKey2)}/models/${index}/id`, "duplicate_model_id", "Model id is duplicated"));
      } else {
        seen.add(model.id);
      }
    }
  }
  issues.push(...collectCostIssues(models));
  return issues;
}
var MODEL_COST_FIELDS = ["input", "output", "cacheRead", "cacheWrite"];
function collectCostIssues(models) {
  const issues = [];
  const check = (costPath, cost, requireAll) => {
    if (cost === void 0) return;
    if (!isObject(cost)) {
      issues.push(issue(costPath, "invalid_cost", "Model cost must be an object"));
      return;
    }
    for (const field of MODEL_COST_FIELDS) {
      const value = cost[field];
      if (value === void 0) {
        if (requireAll) {
          issues.push(issue(`${costPath}/${field}`, "invalid_cost", `Model cost is missing ${field}`));
        }
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push(issue(`${costPath}/${field}`, "invalid_cost", `Model cost ${field} must be a number`));
      }
    }
    if (cost.tiers !== void 0 && !Array.isArray(cost.tiers)) {
      issues.push(issue(`${costPath}/tiers`, "invalid_cost", "Model cost tiers must be an array"));
    }
  };
  for (const [providerKey2, provider] of Object.entries(models.providers ?? {})) {
    if (!isObject(provider)) continue;
    const base = `/providers/${escapePointer(providerKey2)}`;
    if (Array.isArray(provider.models)) {
      for (const [index, model] of provider.models.entries()) {
        if (isObject(model)) check(`${base}/models/${index}/cost`, model.cost, true);
      }
    }
    if (isObject(provider.modelOverrides)) {
      for (const [modelId2, override] of Object.entries(provider.modelOverrides)) {
        if (isObject(override)) check(`${base}/modelOverrides/${escapePointer(modelId2)}/cost`, override.cost, false);
      }
    }
  }
  return issues;
}
function withSchemaHint(models) {
  return { $schema: MODELS_JSON_SCHEMA_URL, ...models };
}
function escapePointer(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
function revisionFromBytes(bytes) {
  return hashBytes(bytes);
}
function readRevision(path, deps) {
  let bytes;
  try {
    bytes = deps.readFile(path);
  } catch (error2) {
    if (error2 && typeof error2 === "object" && "code" in error2 && error2.code === "ENOENT") return "missing";
    throw new ConfigCoreError("read_failed", "Unable to read models configuration");
  }
  return revisionFromBytes(bytes);
}
function parseSnapshot(path, deps) {
  let bytes;
  try {
    bytes = deps.readFile(path);
  } catch (error2) {
    if (error2 && typeof error2 === "object" && "code" in error2 && error2.code === "ENOENT") {
      return { models: withSchemaHint({ providers: {} }), revision: "missing" };
    }
    throw new ConfigCoreError("read_failed", "Unable to read models configuration");
  }
  if (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    throw new ConfigCoreError("read_failed", "Unable to parse models configuration");
  }
  let parsed;
  try {
    parsed = JSON.parse(utf8.decode(bytes));
  } catch {
    throw new ConfigCoreError("read_failed", "Unable to parse models configuration");
  }
  const issues = validateModelsJson(parsed);
  if (issues.length > 0) throw new ConfigCoreError("invalid_config", "Models configuration is invalid", { issues });
  return { models: parsed, revision: revisionFromBytes(bytes) };
}
function canonicalBytes(models) {
  try {
    return Buffer.from(`${JSON.stringify(models, null, 2)}
`, "utf8");
  } catch {
    throw new ConfigCoreError("invalid_config", "Models configuration cannot be serialized");
  }
}
function tempPath(path, prefix) {
  return `${path}.${prefix}-${randomBytes(16).toString("hex")}.tmp`;
}
function commitWithDependencies(input, path, deps) {
  if (input.expectedRevision !== "missing" && !/^sha256:[0-9a-f]{64}$/.test(input.expectedRevision)) {
    throw new ConfigCoreError("invalid_revision", "Invalid models configuration revision");
  }
  const issues = validateModelsJson(input.models);
  if (issues.length > 0) throw new ConfigCoreError("invalid_config", "Models configuration is invalid", { issues });
  const currentRevision = readRevision(path, deps);
  if (currentRevision !== input.expectedRevision) {
    throw new ConfigCoreError("config_changed", "Models configuration changed before save");
  }
  const bytes = canonicalBytes(input.models);
  const temp = tempPath(path, "commit");
  try {
    deps.mkdir(dirname(path), { recursive: true });
    deps.writeFile(temp, bytes, { encoding: "utf8", mode: 384 });
    deps.rename(temp, path);
  } catch {
    throw new ConfigCoreError("write_failed", "Unable to write models configuration");
  } finally {
    try {
      deps.unlink(temp);
    } catch {
    }
  }
  return { models: input.models, revision: revisionFromBytes(bytes) };
}
var productionDependencies = {
  readFile: readFileSync,
  writeFile: writeFileSync,
  rename: renameSync,
  unlink: unlinkSync,
  mkdir: mkdirSync
};
function readModelsSnapshot(path = getModelsJsonPath()) {
  return parseSnapshot(path, productionDependencies);
}
function commitModelsSnapshot(input, path = getModelsJsonPath()) {
  return commitWithDependencies(input, path, productionDependencies);
}
function createConfigCoreForTesting(dependencies = {}) {
  const deps = { ...productionDependencies, ...dependencies };
  return {
    readModelsSnapshot: (path) => parseSnapshot(path, deps),
    commitModelsSnapshot: (input, path) => commitWithDependencies(input, path, deps)
  };
}

// packages/pi-vendor/src/host-runtime.ts
import { createRequire } from "node:module";
import { join as join4 } from "node:path";
import { pathToFileURL as pathToFileURL2 } from "node:url";

// packages/pi-vendor/src/model-source/official-catalog.ts
import { existsSync, readFileSync as readFileSync2, realpathSync } from "node:fs";
import { delimiter, dirname as dirname3, join as join3 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// packages/pi-vendor/src/shared/vendor-shared.js
import { dirname as dirname2, join as join2 } from "node:path";
var CATALOG_SEARCH_MAX_QUERY_BYTES = 512;
function candidateCatalogPaths(roots) {
  const paths = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (candidate) => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    paths.push(candidate);
  };
  for (const root of roots ?? []) {
    if (typeof root !== "string" || root === "") continue;
    let current = root;
    for (; ; ) {
      add(join2(current, "node_modules", "@earendil-works", "pi-ai", "dist", "models.generated.js"));
      const parent = dirname2(current);
      if (parent === current) break;
      current = parent;
    }
    add(
      join2(root, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "models.generated.js")
    );
  }
  return paths;
}
function encodeConfigLiteral(value) {
  const dollarsEscaped = value.replaceAll("$", () => "$$");
  return dollarsEscaped.startsWith("!") ? "$" + dollarsEscaped : dollarsEscaped;
}
function stripRoutingFields(model) {
  const copy = structuredClone(model);
  for (const field of ["provider", "baseUrl", "headers", "apiKey", "authHeader"]) delete copy[field];
  return copy;
}
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function isCatalogObject(catalog) {
  if (!isPlainObject(catalog)) return false;
  for (const providerModels2 of Object.values(catalog)) {
    if (!isPlainObject(providerModels2)) return false;
  }
  return true;
}
function isPlainDataTree(value, seen = /* @__PURE__ */ new Set()) {
  if (value === null) return true;
  if (typeof value === "object") {
    if (seen.has(value)) return true;
    seen.add(value);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return false;
    for (const key of Object.keys(value)) {
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (!desc || typeof desc.get === "function" || typeof desc.set === "function") return false;
      if (!isPlainDataTree(desc.value, seen)) return false;
    }
  }
  return typeof value !== "function";
}
function searchCatalogShared(models, query, limit = 50) {
  const needle = query.trim().toLowerCase();
  const normalizedNeedle = needle.replace(/[\s_-]+/g, "");
  const tokens = needle.split(/[^\p{L}\p{N}._-]+/u).filter(Boolean);
  const results = [];
  for (const [provider, entries] of Object.entries(models ?? {})) {
    for (const model of Object.values(entries ?? {})) {
      const id = typeof model?.id === "string" ? model.id : "";
      const name = typeof model?.name === "string" ? model.name : "";
      const haystack = (id + "\n" + name).toLowerCase();
      const normalizedHaystack = haystack.replace(/[\s_-]+/g, "");
      if (!tokens.every((token) => haystack.includes(token) || normalizedHaystack.includes(token.replace(/[\s_-]+/g, "")))) continue;
      const normalizedId = id.toLowerCase().replace(/[\s_-]+/g, "");
      const score = normalizedId === normalizedNeedle ? 0 : normalizedId.startsWith(normalizedNeedle) ? 1 : normalizedId.includes(normalizedNeedle) ? 2 : 3;
      results.push({ score, officialProvider: provider, model });
    }
  }
  results.sort((a, b) => a.score - b.score || a.model.id.localeCompare(b.model.id) || a.officialProvider.localeCompare(b.officialProvider));
  return results.slice(0, limit).map(({ officialProvider, model }) => ({ officialProvider, model }));
}

// packages/pi-vendor/src/model-source/official-catalog.ts
function resolvePackageRoot(startDir) {
  let current = startDir;
  for (; ; ) {
    try {
      const pkg = JSON.parse(readFileSync2(join3(current, "package.json"), "utf8"));
      if (pkg.name === "@earendil-works/pi-coding-agent") {
        return current;
      }
    } catch {
    }
    const parent = dirname3(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
function piRootFromEntry(entry) {
  if (!entry || !existsSync(entry)) return null;
  try {
    return resolvePackageRoot(dirname3(realpathSync(entry)));
  } catch {
    return null;
  }
}
function piRootFromPath() {
  const names = process.platform === "win32" ? ["pi.cmd", "pi.exe", "pi"] : ["pi"];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const name of names) {
      const root = piRootFromEntry(join3(dir, name));
      if (root) return root;
    }
  }
  return null;
}
function resolveCandidateRoots() {
  const roots = /* @__PURE__ */ new Set();
  const add = (root) => {
    if (root) roots.add(root);
  };
  const envRoot = process.env.PI_VENDOR_PI_ROOT?.trim();
  if (envRoot) {
    add(resolvePackageRoot(envRoot));
    add(existsSync(envRoot) ? envRoot : null);
  }
  add(piRootFromEntry(process.argv[1]));
  add(piRootFromPath());
  try {
    const resolvedUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
    if (resolvedUrl.startsWith("file://")) add(resolvePackageRoot(dirname3(fileURLToPath(resolvedUrl))));
  } catch {
  }
  add(resolvePackageRoot(dirname3(fileURLToPath(import.meta.url))));
  return [...roots];
}
var cachedCatalogPath = null;
var cachedCatalog = null;
function findOfficialCatalogPath(roots = resolveCandidateRoots()) {
  for (const candidate of candidateCatalogPaths(roots)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
async function loadOfficialCatalog() {
  const path = findOfficialCatalogPath();
  if (!path) {
    cachedCatalogPath = null;
    cachedCatalog = null;
    return null;
  }
  if (cachedCatalogPath === path) return cachedCatalog;
  try {
    const mod = await import(pathToFileURL(path).href);
    const catalog = mod.MODELS;
    if (!isPlainDataTree(catalog) || !isCatalogObject(catalog)) {
      return null;
    }
    const official = catalog;
    cachedCatalogPath = path;
    cachedCatalog = official;
    return cachedCatalog;
  } catch {
    return null;
  }
}
function collectOfficialCandidates(catalog, modelId2) {
  if (!catalog) return [];
  const matches = [];
  for (const [provider, providerModels2] of Object.entries(catalog)) {
    const model = providerModels2?.[modelId2];
    if (model && typeof model === "object" && !Array.isArray(model) && typeof model.id === "string") {
      matches.push({ provider, model: structuredClone(model) });
    }
  }
  return matches;
}
function stripOfficialRoutingFields(model) {
  return stripRoutingFields(model);
}
function formatOfficialCandidate(candidate) {
  const name = typeof candidate.model.name === "string" && candidate.model.name.trim() && candidate.model.name !== candidate.model.id ? candidate.model.name.trim() : void 0;
  const api = typeof candidate.model.api === "string" && candidate.model.api.trim() ? candidate.model.api.trim() : void 0;
  const contextWindow = typeof candidate.model.contextWindow === "number" ? `ctx ${candidate.model.contextWindow}` : void 0;
  const maxTokens = typeof candidate.model.maxTokens === "number" ? `max ${candidate.model.maxTokens}` : void 0;
  const meta = [api, contextWindow, maxTokens].filter(Boolean).join(", ");
  const head = name ? `${candidate.provider}/${candidate.model.id} - ${name}` : `${candidate.provider}/${candidate.model.id}`;
  return meta ? `${head} (${meta})` : head;
}

// packages/pi-vendor/src/host-runtime.ts
async function importPiHost(specifier) {
  for (const root of resolveCandidateRoots()) {
    try {
      const hostRequire = createRequire(join4(root, "package.json"));
      const resolved = hostRequire.resolve(specifier);
      return await import(pathToFileURL2(resolved).href);
    } catch {
    }
  }
  return await import(specifier);
}

// packages/pi-vendor/src/tui/quick-adapter.ts
var PAGE_SIZE = 10;
async function pagedSelect(raw, opts) {
  const { Container, Key, matchesKey, SelectList, Text } = await importPiHost("@earendil-works/pi-tui");
  const items = opts.choices.map((choice) => ({ ...choice }));
  return raw.custom?.((tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new Text(theme.fg("accent", theme.bold(opts.message)), 1, 0));
    const list = new SelectList(items, PAGE_SIZE, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text)
    });
    let selectedIndex = Math.max(0, opts.choices.findIndex((choice) => choice.value === opts.default));
    list.setSelectedIndex(selectedIndex);
    list.onSelectionChange = (item) => {
      selectedIndex = items.indexOf(item);
    };
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(null);
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "\u2191\u2193 move \u2022 \u2190\u2192 page \u2022 enter select \u2022 esc cancel"), 1, 0));
    return {
      render: (width) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput(data) {
        if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
          const direction = matchesKey(data, Key.left) ? -1 : 1;
          selectedIndex = Math.max(0, Math.min(items.length - 1, selectedIndex + direction * PAGE_SIZE));
          list.setSelectedIndex(selectedIndex);
        } else {
          list.handleInput(data);
        }
        tui.requestRender();
      }
    };
  }) ?? null;
}
function createProductionQuickUI(raw) {
  return {
    async select(opts) {
      if (opts.choices.length > PAGE_SIZE && raw.custom) return pagedSelect(raw, opts);
      const result = await raw.select?.(opts.message, opts.choices.map((c) => c.label), { default: opts.default ? opts.choices.find((c) => c.value === opts.default)?.label : void 0 });
      if (!result) return null;
      const index = opts.choices.map((c) => c.label).indexOf(result);
      if (index < 0) return null;
      return opts.choices[index].value;
    },
    async input(opts) {
      const result = await raw.input?.(opts.message, opts.placeholder);
      return result ?? null;
    },
    confirm: (msg, detail) => raw.confirm?.(msg, detail) ?? false,
    notify: (msg, level) => raw.notify?.(msg, level)
  };
}
function createScriptedQuickUI(responses) {
  const calls = [];
  const notifies = [];
  return {
    calls,
    notifies,
    async select(opts) {
      calls.push({ kind: "select", message: opts.message, choices: opts.choices.map((c) => c.value) });
      if (responses.select) {
        const val = responses.select(opts.message);
        if (val === null) return null;
        if (opts.choices.some((c) => c.value === val)) return val;
      }
      return null;
    },
    async input(opts) {
      calls.push({ kind: "input", message: opts.message });
      if (responses.input) {
        const val = responses.input(opts.message);
        return val;
      }
      return null;
    },
    async confirm(msg) {
      calls.push({ kind: "confirm", message: msg });
      if (responses.confirm) return responses.confirm(msg);
      return false;
    },
    notify(msg, level = "info") {
      notifies.push({ message: msg, level });
    }
  };
}

// packages/pi-vendor/src/config-document.ts
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
function error(code, path) {
  return { ok: false, error: { code, path, message: code.replaceAll("_", " ") } };
}
function pointer(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
function providerKey(value) {
  return value.trim() || void 0;
}
function modelId(value) {
  return value.trim() || void 0;
}
function clonedProviders(models) {
  return cloneJson(models.providers ?? {});
}
function hasProvider(providers, key) {
  return Object.hasOwn(providers, key);
}
function setProvider(providers, key, config) {
  Object.defineProperty(providers, key, { configurable: true, enumerable: true, value: config, writable: true });
}
function createProvider(models, key, config) {
  const nextKey = providerKey(key);
  if (!nextKey) return error("invalid_provider_key", "/providers");
  const providers = clonedProviders(models);
  if (hasProvider(providers, nextKey)) return error("provider_exists", `/providers/${pointer(nextKey)}`);
  setProvider(providers, nextKey, cloneJson(config));
  return { ok: true, value: { ...cloneJson(models), providers } };
}
function providerModels(models, provider) {
  const key = providerKey(provider);
  if (!key) return error("invalid_provider_key", "/providers");
  const document = cloneJson(models);
  const providers = clonedProviders(models);
  if (!hasProvider(providers, key)) return error("provider_not_found", `/providers/${pointer(key)}`);
  const config = providers[key];
  return { document, providers, config, models: Array.isArray(config.models) ? config.models : [] };
}
function addModel(models, provider, model) {
  const id = modelId(model.id);
  if (!id) return error("invalid_model_id", "/providers/models");
  const state = providerModels(models, provider);
  if ("ok" in state) return state;
  if (state.models.some((entry) => entry.id === id)) return error("model_exists", "/providers/models");
  state.config.models = [...state.models, { ...cloneJson(model), id }];
  return { ok: true, value: { ...state.document, providers: state.providers } };
}
function replaceModel(models, provider, previousId, model, options = {}) {
  const source = modelId(previousId);
  const target = modelId(model.id);
  if (!source || !target) return error("invalid_model_id", "/providers/models");
  const state = providerModels(models, provider);
  if ("ok" in state) return state;
  const sourceIndex = state.models.findIndex((entry) => entry.id === source);
  if (sourceIndex < 0) return error("model_not_found", "/providers/models");
  const targetIndex = state.models.findIndex((entry) => entry.id === target);
  if (targetIndex >= 0 && targetIndex !== sourceIndex && options.conflict !== "overwrite-confirmed") {
    return error("model_exists", "/providers/models");
  }
  const replacement = { ...cloneJson(model), id: target };
  const insertIndex = targetIndex >= 0 && targetIndex !== sourceIndex ? Math.min(sourceIndex, targetIndex) : sourceIndex;
  state.config.models = state.models.flatMap((entry, index) => {
    if (index === insertIndex) return [replacement];
    return index === sourceIndex || index === targetIndex ? [] : [entry];
  });
  return { ok: true, value: { ...state.document, providers: state.providers } };
}

// packages/pi-vendor/src/fuzzy.ts
function fuzzyMatch(query, text) {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  const matchQuery = (normalizedQuery) => {
    if (normalizedQuery.length === 0) {
      return { matches: true, score: 0 };
    }
    if (normalizedQuery.length > textLower.length) {
      return { matches: false, score: 0 };
    }
    let queryIndex = 0;
    let score = 0;
    let lastMatchIndex = -1;
    let consecutiveMatches = 0;
    for (let i = 0; i < textLower.length && queryIndex < normalizedQuery.length; i++) {
      if (textLower[i] === normalizedQuery[queryIndex]) {
        const isWordBoundary = i === 0 || /[\s\-_./:]/.test(textLower[i - 1]);
        if (lastMatchIndex === i - 1) {
          consecutiveMatches++;
          score -= consecutiveMatches * 5;
        } else {
          consecutiveMatches = 0;
          if (lastMatchIndex >= 0) {
            score += (i - lastMatchIndex - 1) * 2;
          }
        }
        if (isWordBoundary) {
          score -= 10;
        }
        score += i * 0.1;
        lastMatchIndex = i;
        queryIndex++;
      }
    }
    if (queryIndex < normalizedQuery.length) {
      return { matches: false, score: 0 };
    }
    if (normalizedQuery === textLower) {
      score -= 100;
    }
    return { matches: true, score };
  };
  const primaryMatch = matchQuery(queryLower);
  if (primaryMatch.matches) {
    return primaryMatch;
  }
  const alphaNumericMatch = queryLower.match(/^(?<letters>[a-z]+)(?<digits>[0-9]+)$/);
  const numericAlphaMatch = queryLower.match(/^(?<digits>[0-9]+)(?<letters>[a-z]+)$/);
  const swappedQuery = alphaNumericMatch ? `${alphaNumericMatch.groups?.digits ?? ""}${alphaNumericMatch.groups?.letters ?? ""}` : numericAlphaMatch ? `${numericAlphaMatch.groups?.letters ?? ""}${numericAlphaMatch.groups?.digits ?? ""}` : "";
  if (!swappedQuery) {
    return primaryMatch;
  }
  const swappedMatch = matchQuery(swappedQuery);
  if (!swappedMatch.matches) {
    return primaryMatch;
  }
  return { matches: true, score: swappedMatch.score + 5 };
}
function fuzzyFilter(items, query, getText) {
  if (!query.trim()) {
    return items;
  }
  const tokens = query.trim().split(/[\s/]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return items;
  }
  const results = [];
  for (const item of items) {
    const text = getText(item);
    let totalScore = 0;
    let allMatch = true;
    for (const token of tokens) {
      const match = fuzzyMatch(token, text);
      if (match.matches) {
        totalScore += match.score;
      } else {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      results.push({ item, score: totalScore });
    }
  }
  results.sort((a, b) => a.score - b.score);
  return results.map((r) => r.item);
}

// packages/pi-vendor/src/model-source/config-resolver.ts
var CommandResolutionError = class extends Error {
  kind;
  constructor(kind) {
    super(kind === "timeout" ? "Command timed out" : "Command aborted");
    this.name = "CommandResolutionError";
    this.kind = kind;
  }
};
function resolveTemplate(value, providerEnv, processEnv) {
  let result = "";
  let unresolved = false;
  let i = 0;
  while (i < value.length) {
    if (value[i] !== "$" || i + 1 >= value.length) {
      result += value[i];
      i++;
      continue;
    }
    const next = value[i + 1];
    if (next === "$") {
      result += "$";
      i += 2;
      continue;
    }
    if (next === "!") {
      result += "!";
      i += 2;
      continue;
    }
    if (next === "{") {
      const close = value.indexOf("}", i + 2);
      if (close === -1) {
        result += value[i];
        i++;
        continue;
      }
      const varName2 = value.slice(i + 2, close);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName2)) {
        result += value.slice(i, close + 1);
        i = close + 1;
        continue;
      }
      const resolved2 = resolveEnv(varName2, providerEnv, processEnv);
      if (resolved2 !== void 0) {
        result += resolved2;
      } else {
        unresolved = true;
      }
      i = close + 1;
      continue;
    }
    if (!/[a-zA-Z_]/.test(next)) {
      result += "$";
      i++;
      continue;
    }
    let j = i + 2;
    while (j < value.length && /[a-zA-Z0-9_]/.test(value[j])) {
      j++;
    }
    const varName = value.slice(i + 1, j);
    const resolved = resolveEnv(varName, providerEnv, processEnv);
    if (resolved !== void 0) {
      result += resolved;
    } else {
      unresolved = true;
    }
    i = j;
  }
  return { resolved: result, unresolved };
}
function resolveEnv(name, providerEnv, processEnv) {
  const pv = providerEnv[name];
  if (pv !== void 0 && pv !== "") return pv;
  const ev = processEnv[name];
  if (ev !== void 0 && ev !== "") return ev;
  return void 0;
}
function isCommand(value) {
  return value.length > 0 && value.charCodeAt(0) === 33;
}
function commandBody(value) {
  return value.slice(1);
}
var localBashPromise;
function localBash() {
  localBashPromise ??= importPiHost("@earendil-works/pi-coding-agent").then((module) => module.createLocalBashOperations());
  return localBashPromise;
}
function createProductionCommandRunner() {
  return async (commandBody2, options) => {
    let stdoutBytes = 0;
    let outputTooLarge = false;
    const chunks = [];
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const bash = await localBash();
      const result = await bash.exec(commandBody2, process.cwd(), {
        signal: controller.signal,
        timeout: options.timeoutMs / 1e3,
        onData: (chunk) => {
          if (outputTooLarge) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          stdoutBytes += buffer.length;
          if (stdoutBytes > options.maxStdoutBytes) {
            outputTooLarge = true;
            controller.abort();
            return;
          }
          chunks.push(buffer);
        }
      });
      if (outputTooLarge) throw new Error("Command output exceeded maximum size");
      if (options.signal.aborted) throw new CommandResolutionError("aborted");
      if (result.exitCode !== 0) throw new Error("Command execution failed");
      return Buffer.concat(chunks).toString("utf8").trim();
    } catch (error2) {
      if (outputTooLarge) throw new Error("Command output exceeded maximum size");
      if (error2 instanceof CommandResolutionError) throw error2;
      if (options.signal.aborted || error2 instanceof Error && error2.message === "aborted") {
        throw new CommandResolutionError("aborted");
      }
      if (error2 instanceof Error && error2.message.startsWith("timeout:")) {
        throw new CommandResolutionError("timeout");
      }
      throw new Error("Command execution failed");
    } finally {
      options.signal.removeEventListener("abort", onAbort);
    }
  };
}
async function resolveConfigValue(value, context) {
  if (isCommand(value)) {
    try {
      const output = await context.runCommand(commandBody(value), {
        signal: context.signal,
        timeoutMs: 1e4,
        maxStdoutBytes: 64 * 1024
      });
      return output === "" ? { kind: "unresolved", reason: "Command execution failed" } : { kind: "resolved", value: output, source: "command" };
    } catch (err) {
      if (err instanceof CommandResolutionError) throw err;
      if (context.signal.aborted) throw new CommandResolutionError("aborted");
      return { kind: "unresolved", reason: "Command execution failed" };
    }
  }
  const tmpl = resolveTemplate(value, context.providerEnv, context.processEnv);
  if (tmpl.unresolved) {
    return { kind: "unresolved", reason: "Environment variable not set" };
  }
  if (tmpl.resolved === "") {
    return { kind: "resolved", value: "", source: "literal" };
  }
  return { kind: "resolved", value: tmpl.resolved, source: "env" };
}
function collectCommandPaths(provider) {
  const paths = [];
  if (provider.apiKey !== void 0 && isCommand(provider.apiKey)) {
    paths.push({ path: { kind: "apiKey" }, rawValue: provider.apiKey });
  }
  if (provider.headers) {
    for (const [name, value] of Object.entries(provider.headers)) {
      if (isCommand(value)) {
        paths.push({ path: { kind: "header", name }, rawValue: value });
      }
    }
  }
  return paths;
}
function preflightCommandTrust(currentProvider, initialProvider) {
  const current = collectCommandPaths(currentProvider);
  if (current.length === 0) return [];
  const trusted = [];
  for (const cp of current) {
    if (cp.path.kind === "apiKey") {
      if (initialProvider.apiKey === cp.rawValue) {
        trusted.push(cp);
      }
    } else {
      const initialHeaders = initialProvider.headers ?? {};
      if (initialHeaders[cp.path.name] === cp.rawValue) {
        trusted.push(cp);
      }
    }
  }
  return trusted;
}
function allCommandsTrusted(currentProvider, initialProvider) {
  const current = collectCommandPaths(currentProvider);
  if (current.length === 0) return true;
  const trusted = preflightCommandTrust(currentProvider, initialProvider);
  return trusted.length === current.length;
}

// packages/pi-vendor/src/model-source/model-source-error.ts
var ModelSourceError = class extends Error {
  code;
  status;
  constructor(code, message, status) {
    super(message);
    this.name = "ModelSourceError";
    this.code = code;
    if (status !== void 0) this.status = status;
  }
};

// packages/pi-vendor/src/model-source/bounded-discover.ts
var OVERALL_DEADLINE_MS = 15e3;
var COMMAND_MAX_STDOUT = 64 * 1024;
var BODY_MAX_BYTES = 2 * 1024 * 1024;
var MAX_IDS = 1e4;
var MAX_ID_BYTES = 1024;
function buildModelsUrl(baseUrl, api = "openai-completions") {
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new ModelSourceError("invalid_request", "baseUrl must start with http:// or https://");
  }
  try {
    const u = new URL(baseUrl);
    if (u.username || u.password) {
      throw new ModelSourceError("invalid_request", "baseUrl must not contain credentials");
    }
    const pathname = u.pathname.replace(/\/$/, "");
    if (api === "anthropic-messages") {
      u.pathname = `${pathname.endsWith("/v1") ? pathname : `${pathname}/v1`}/models`;
    } else if (api === "google-generative-ai") {
      const base = pathname.endsWith("/v1") ? pathname.slice(0, -"/v1".length) : pathname;
      u.pathname = `${base.endsWith("/v1beta") ? base : `${base}/v1beta`}/models`;
    } else {
      u.pathname = `${pathname}/models`;
    }
    return u.toString();
  } catch {
    throw new ModelSourceError("invalid_request", "Invalid base URL");
  }
}
async function readBoundedBody(stream, signal) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) throw new Error("aborted");
      total += value.byteLength;
      if (total > BODY_MAX_BYTES) {
        await reader.cancel();
        throw new ModelSourceError("upstream_too_large", "Response body exceeds maximum size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const decoder = new TextDecoder();
  let text = "";
  for (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
}
function parseAndSortModelIds(json, api = "openai-completions") {
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  const obj = json;
  const data = api === "google-generative-ai" ? obj.models : obj.data;
  if (!Array.isArray(data)) return [];
  const seen = /* @__PURE__ */ new Set();
  const ids = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const field = api === "google-generative-ai" ? "name" : "id";
    const raw = item[field];
    if (typeof raw !== "string") continue;
    const trimmed = (api === "google-generative-ai" ? raw.replace(/^models\//, "") : raw).trim();
    if (!trimmed) continue;
    if (new TextEncoder().encode(trimmed).length > MAX_ID_BYTES) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
    if (ids.length >= MAX_IDS) break;
  }
  ids.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return ids;
}
function hasHeader(headers, name) {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}
function applyApiKey(headers, api, apiKey, authHeader) {
  if (api === "anthropic-messages") {
    if (!hasHeader(headers, "x-api-key")) headers["x-api-key"] = apiKey;
  } else if (api === "google-generative-ai") {
    if (!hasHeader(headers, "x-goog-api-key")) headers["x-goog-api-key"] = apiKey;
  } else if (!hasHeader(headers, "authorization")) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (authHeader) headers.Authorization = `Bearer ${apiKey}`;
}
async function discoverModelIds(provider, options = {}) {
  const initialProvider = options.initialProvider;
  const providerEnv = options.providerEnv ?? {};
  const processEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    processEnv[k] = v;
  }
  const callerSignal = options.signal;
  const deadline = AbortSignal.timeout(OVERALL_DEADLINE_MS);
  const combinedSignal = callerSignal ? AbortSignal.any([deadline, callerSignal]) : deadline;
  const runCommand = options.runCommand ?? createProductionCommandRunner();
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  try {
    if (combinedSignal.aborted) {
      if (callerSignal?.aborted) throw new ModelSourceError("aborted", "Request aborted");
      throw new ModelSourceError("upstream_timeout", "Upstream request timed out");
    }
    if (initialProvider) {
      if (!allCommandsTrusted(provider, initialProvider)) {
        throw new ModelSourceError("credential_unresolved", "Command credentials are not trusted");
      }
    } else {
      const paths = collectCommandPaths(provider);
      if (paths.length > 0) {
        throw new ModelSourceError("credential_unresolved", "Command credentials require an initial provider for trust verification");
      }
    }
    const requestHeaders = {};
    if (provider.headers) {
      for (const [name, value] of Object.entries(provider.headers)) {
        const result = await resolveConfigValue(value, {
          path: { kind: "header", name },
          providerEnv,
          processEnv,
          signal: combinedSignal,
          runCommand
        });
        if (result.kind !== "resolved") {
          throw new ModelSourceError("credential_unresolved", "Failed to resolve header value");
        }
        requestHeaders[name] = result.value;
      }
    }
    if (provider.authHeader && !provider.apiKey) {
      throw new ModelSourceError("credential_unresolved", "authHeader requires an API key");
    }
    if (provider.apiKey) {
      const nativeHeader = provider.api === "anthropic-messages" ? "x-api-key" : provider.api === "google-generative-ai" ? "x-goog-api-key" : "authorization";
      if (!hasHeader(requestHeaders, nativeHeader) || provider.authHeader) {
        const result = await resolveConfigValue(provider.apiKey, {
          path: { kind: "apiKey" },
          providerEnv,
          processEnv,
          signal: combinedSignal,
          runCommand
        });
        if (result.kind !== "resolved") {
          throw new ModelSourceError("credential_unresolved", "Failed to resolve API key");
        }
        if (result.value) applyApiKey(requestHeaders, provider.api, result.value, provider.authHeader);
      }
    }
    if (provider.api === "anthropic-messages" && !hasHeader(requestHeaders, "anthropic-version")) {
      requestHeaders["anthropic-version"] = "2023-06-01";
    }
    const url = buildModelsUrl(provider.baseUrl, provider.api);
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: requestHeaders,
        redirect: "error",
        signal: combinedSignal
      });
    } catch (err) {
      if (combinedSignal.aborted) {
        if (callerSignal?.aborted) {
          throw new ModelSourceError("aborted", "Request aborted");
        }
        throw new ModelSourceError("upstream_timeout", "Upstream request timed out");
      }
      throw new ModelSourceError("upstream_failed", "Upstream request failed");
    }
    if (!response.ok) {
      if (response.body) {
        try {
          await response.body.cancel();
        } catch {
        }
      }
      throw new ModelSourceError("upstream_failed", "Upstream returned an error", response.status);
    }
    if (!response.body) {
      throw new ModelSourceError("upstream_failed", "Empty response body");
    }
    let text;
    try {
      text = await readBoundedBody(response.body, combinedSignal);
    } catch (err) {
      if (err instanceof ModelSourceError) throw err;
      if (combinedSignal.aborted) {
        if (callerSignal?.aborted) {
          throw new ModelSourceError("aborted", "Request aborted");
        }
        throw new ModelSourceError("upstream_timeout", "Upstream request timed out");
      }
      throw new ModelSourceError("upstream_too_large", "Response body exceeded size limit");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ModelSourceError("upstream_failed", "Invalid JSON response");
    }
    return parseAndSortModelIds(parsed, provider.api);
  } catch (err) {
    if (err instanceof ModelSourceError) throw err;
    if (err instanceof CommandResolutionError) {
      if (err.kind === "aborted" && callerSignal?.aborted) {
        throw new ModelSourceError("aborted", "Request aborted");
      }
      throw new ModelSourceError("upstream_timeout", "Upstream request timed out");
    }
    if (combinedSignal.aborted) {
      if (callerSignal?.aborted) {
        throw new ModelSourceError("aborted", "Request aborted");
      }
      throw new ModelSourceError("upstream_timeout", "Upstream request timed out");
    }
    throw new ModelSourceError("upstream_failed", "Unexpected error during discovery");
  }
}

// packages/pi-vendor/src/model-source/catalog-search.ts
var DEFAULT_LIMIT = 50;
var MIN_LIMIT = 1;
var MAX_LIMIT = 100;
function utf8ByteLength(s) {
  return new TextEncoder().encode(s).length;
}
async function searchOfficialModels(query, limit, loadCatalog = loadOfficialCatalog) {
  if (utf8ByteLength(query) > CATALOG_SEARCH_MAX_QUERY_BYTES) {
    throw new ModelSourceError("invalid_request", "Query exceeds maximum length");
  }
  const effectiveLimit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, limit ?? DEFAULT_LIMIT));
  const catalog = await loadCatalog();
  if (!catalog) throw new ModelSourceError("catalog_unavailable", "Official model catalog is unavailable");
  return searchCatalogShared(catalog, query, effectiveLimit).map((entry) => typeof entry.model?.id === "string" ? entry.model.id : "").filter(Boolean);
}

// packages/pi-vendor/src/model-source/enrich.ts
async function enrichModelId(modelId2, options = {}) {
  const catalog = Object.hasOwn(options, "catalog") ? options.catalog : await loadOfficialCatalog();
  if (catalog === null || catalog === void 0) {
    return {
      kind: "catalog-unavailable",
      modelId: modelId2,
      model: { id: modelId2 },
      warning: `Official catalog unavailable; using a minimal entry for ${modelId2}. Metadata (context window, cost, compat) is unknown.`
    };
  }
  const candidates = collectOfficialCandidates(catalog, modelId2);
  if (candidates.length > 0) return { kind: "official-ambiguous", modelId: modelId2, candidates };
  return {
    kind: "ready",
    model: { id: modelId2 },
    warning: `No official catalog match for ${modelId2}; using a minimal model entry.`
  };
}

// packages/pi-vendor/src/tui/model-pick.ts
var FILTER_THRESHOLD = 20;
var CATALOG_SEARCH_LIMIT = 100;
async function acquireOneModel(ui, provider, options = {}) {
  const ids = await listUpstreamIds(ui, provider, options.discover ?? discoverModelIds);
  const modelId2 = ids ? await pickModelId(ui, ids) : await promptModelId(ui, options.searchCatalog ?? searchOfficialModels);
  if (modelId2 === null) return null;
  return resolveModelConfig(ui, modelId2, provider, options.enrich);
}
async function pickModelId(ui, ids) {
  let pool = ids;
  if (ids.length > FILTER_THRESHOLD) {
    const query = await ui.input({
      message: `${ids.length} models upstream. Filter (Enter to list all):`,
      placeholder: "e.g. claude, gpt-5, qwen"
    });
    if (query === null) return null;
    if (query.trim()) {
      const filtered = fuzzyFilter(ids, query, (id) => id);
      if (filtered.length === 0) {
        ui.notify(`No upstream id matches "${query.trim()}". Listing all.`, "warning");
      } else {
        pool = filtered;
      }
    }
  }
  return ui.select({
    message: "Select model:",
    choices: pool.map((id) => ({ value: id, label: id }))
  });
}
async function resolveModelConfig(ui, modelId2, provider, enrichOptions) {
  const enriched = await enrichModelId(modelId2, enrichOptions);
  if (enriched.kind === "ready") {
    if (enriched.warning) ui.notify(enriched.warning, "warning");
    return applyProviderRouting(enriched.model, provider);
  }
  if (enriched.kind === "catalog-unavailable") {
    ui.notify(enriched.warning, "warning");
    return applyProviderRouting(enriched.model, provider);
  }
  const candidates = enriched.candidates;
  const only = candidates.length === 1 ? candidates[0] : void 0;
  if (only) {
    ui.notify(`Using official template from ${only.provider}.`, "info");
    return applyProviderRouting(stripOfficialRoutingFields(only.model), provider);
  }
  const picked = await ui.select({
    message: `"${modelId2}" has ${candidates.length} official templates. Select source:`,
    choices: candidates.map((candidate, index) => ({
      value: String(index),
      label: formatOfficialCandidate(candidate)
    }))
  });
  if (picked === null) return null;
  const chosen = candidates[Number(picked)];
  if (!chosen) return null;
  return applyProviderRouting(stripOfficialRoutingFields(chosen.model), provider);
}
function applyProviderRouting(model, provider) {
  const next = { ...model };
  if (!next.api && provider.api) next.api = provider.api;
  if (next.api === "anthropic-messages") {
    const withoutV1 = stripTrailingV1(provider.baseUrl);
    if (withoutV1 !== null) next.baseUrl = withoutV1;
  } else if (next.api === "google-generative-ai") {
    const withV1Beta = toGoogleV1Beta(provider.baseUrl);
    if (withV1Beta !== null) next.baseUrl = withV1Beta;
  }
  return next;
}
function stripTrailingV1(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/v1")) return null;
  url.pathname = path.slice(0, -"/v1".length);
  return url.toString().replace(/\/+$/, "");
}
function toGoogleV1Beta(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/v1beta")) return null;
  const base = path.endsWith("/v1") ? path.slice(0, -"/v1".length) : path;
  url.pathname = `${base}/v1beta`;
  return url.toString().replace(/\/+$/, "");
}
async function listUpstreamIds(ui, provider, discover) {
  if (hasUntrustedCommandCredential(provider)) {
    ui.notify("Provider uses command-based credentials that are not saved yet; enter a model id instead.", "info");
    return null;
  }
  ui.notify(`Listing ${provider.api ?? "OpenAI-compatible"} models \u2026`, "info");
  try {
    const ids = await discover(
      { baseUrl: provider.baseUrl, api: provider.api, apiKey: provider.apiKey, headers: provider.headers, authHeader: provider.authHeader },
      provider.initialProvider ? { initialProvider: provider.initialProvider } : {}
    );
    if (ids.length === 0) {
      ui.notify("Provider returned no models; enter a model id instead.", "warning");
      return null;
    }
    return ids;
  } catch (error2) {
    const reason = error2 instanceof ModelSourceError ? error2.message : "unexpected error";
    ui.notify(`Could not list upstream models (${reason}); enter a model id instead.`, "warning");
    return null;
  }
}
function hasUntrustedCommandCredential(provider) {
  if (provider.initialProvider) return false;
  const values = [provider.apiKey, ...Object.values(provider.headers ?? {})];
  return values.some((value) => typeof value === "string" && value.startsWith("!"));
}
var USE_LITERAL = "\0literal";
async function promptModelId(ui, searchCatalog) {
  for (; ; ) {
    const input = await ui.input({
      message: "Model id (searches the official catalog):",
      placeholder: "e.g. opus, gpt-5, my-custom-model"
    });
    if (input === null) return null;
    const trimmed = input.trim();
    if (!trimmed) {
      ui.notify("Model id cannot be empty.", "warning");
      continue;
    }
    return resolveTypedId(ui, trimmed, searchCatalog);
  }
}
async function resolveTypedId(ui, text, searchCatalog) {
  let matches = [];
  try {
    const results = await searchCatalog(text, CATALOG_SEARCH_LIMIT);
    matches = results;
  } catch {
  }
  if (matches.length === 0) return text;
  if (matches.length === 1 && matches[0] === text) return text;
  const ranked = fuzzyFilter(matches, text, (id) => id);
  const ordered = ranked.length > 0 ? ranked : matches;
  const picked = await ui.select({
    message: `Official catalog matches for "${text}":`,
    choices: [
      ...ordered.map((id) => ({ value: id, label: id })),
      { value: USE_LITERAL, label: `Use "${text}" as a custom id` }
    ]
  });
  if (picked === null) return null;
  return picked === USE_LITERAL ? text : picked;
}

// packages/pi-vendor/src/tui/quick-add-model.ts
async function runAddModelFlow(ui, providerKey2, models, initialProvider, options) {
  const provider = models.providers?.[providerKey2];
  if (!provider?.baseUrl) {
    ui.notify(`Provider "${providerKey2}" has no base URL.`, "error");
    return { kind: "cancelled" };
  }
  const model = await acquireOneModel(ui, {
    baseUrl: provider.baseUrl,
    api: typeof provider.api === "string" ? provider.api : void 0,
    apiKey: typeof provider.apiKey === "string" ? provider.apiKey : void 0,
    headers: provider.headers,
    authHeader: provider.authHeader,
    initialProvider
  }, options);
  if (model === null) return { kind: "cancelled" };
  const exists = (provider.models ?? []).some((entry) => entry.id === model.id);
  if (exists) {
    const confirmed = await ui.confirm(
      `Model "${model.id}" already exists in ${providerKey2}. Replace it?`,
      "The existing model configuration will be overwritten."
    );
    if (!confirmed) return { kind: "cancelled" };
    const replaced = replaceModel(models, providerKey2, model.id, model, { conflict: "overwrite-confirmed" });
    if (!replaced.ok) {
      ui.notify(`Failed to replace model: ${replaced.error.message}`, "error");
      return { kind: "cancelled" };
    }
    return { kind: "saved", models: replaced.value };
  }
  const added = addModel(models, providerKey2, model);
  if (!added.ok) {
    ui.notify(`Failed to add model: ${added.error.message}`, "error");
    return { kind: "cancelled" };
  }
  return { kind: "saved", models: added.value };
}

// packages/pi-vendor/src/tui/quick-add-provider.ts
var API_CHOICES = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
  { value: "_custom", label: "Custom\u2026" }
];
async function acquireProviderKey(ui, models) {
  for (; ; ) {
    const key = await ui.input({ message: "Provider key (unique name):" });
    if (key === null) return null;
    const trimmed = key.trim();
    if (!trimmed) {
      ui.notify("Provider key cannot be empty.", "warning");
      continue;
    }
    if (trimmed in (models.providers ?? {})) {
      ui.notify(`Provider "${trimmed}" already exists. Choose a different key.`, "error");
      continue;
    }
    return trimmed;
  }
}
async function acquireBaseUrl(ui) {
  for (; ; ) {
    const input = await ui.input({
      message: "Base URL:",
      placeholder: "https://api.example.com/v1"
    });
    if (input === null) return null;
    const trimmed = input.trim();
    if (!trimmed) {
      ui.notify("Base URL cannot be empty.", "warning");
      continue;
    }
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      ui.notify("Invalid URL. Must be a valid http or https address.", "error");
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      ui.notify("URL must use http or https.", "error");
      continue;
    }
    if (url.username || url.password) {
      ui.notify("URL must not contain username or password.", "error");
      continue;
    }
    return trimmed;
  }
}
async function acquireApiFormat(ui) {
  const choice = await ui.select({
    message: "API format:",
    choices: API_CHOICES.map((c) => ({ value: c.value, label: c.label })),
    default: "openai-completions"
  });
  if (choice === null) return null;
  if (choice === "_custom") {
    const custom = await ui.input({ message: "Custom API format:" });
    if (custom === null) return null;
    const trimmed = custom.trim();
    if (!trimmed) {
      ui.notify("Custom API format cannot be empty.", "warning");
      return acquireApiFormat(ui);
    }
    return trimmed;
  }
  return choice;
}
async function acquireApiKey(ui) {
  for (; ; ) {
    const key = await ui.input({ message: "API key (required):" });
    if (key === null) return null;
    if (!key.trim()) {
      ui.notify("API key cannot be empty.", "warning");
      continue;
    }
    return key.trim();
  }
}
async function runAddProviderFlow(ui, models, options) {
  const key = await acquireProviderKey(ui, models);
  if (key === null) return { kind: "cancelled" };
  const baseUrl = await acquireBaseUrl(ui);
  if (baseUrl === null) return { kind: "cancelled" };
  const api = await acquireApiFormat(ui);
  if (api === null) return { kind: "cancelled" };
  const apiKey = await acquireApiKey(ui);
  if (apiKey === null) return { kind: "cancelled" };
  const encodedApiKey = encodeConfigLiteral(apiKey);
  const model = await acquireOneModel(ui, { baseUrl, api, apiKey: encodedApiKey }, options);
  if (model === null) return { kind: "cancelled" };
  const providerConfig = { baseUrl, api, apiKey: encodedApiKey, models: [model] };
  const draft = { ...models, providers: { ...models.providers ?? {} } };
  const created = createProvider(draft, key, providerConfig);
  if (!created.ok) {
    ui.notify(`Cannot create provider: ${created.error.message}`, "error");
    return { kind: "cancelled" };
  }
  return { kind: "saved", models: created.value };
}

// packages/pi-vendor/src/tui/quick-root.ts
var ROOT_CHOICES = [
  { value: "add-provider", label: "Add provider" },
  { value: "add-model", label: "Add model" }
];
async function showRootMenu(ui) {
  return ui.select({
    message: "Manage providers and models",
    choices: ROOT_CHOICES,
    default: "add-provider"
  });
}
function supportsInteractiveUI(mode, hasUI) {
  return hasUI === true && mode === "tui";
}

// packages/pi-vendor/src/command.ts
var COMMAND_NAME = "vendor";
function describe(error2) {
  return error2 instanceof Error ? error2.message : String(error2);
}
async function saveAndRefresh(ctx, models, expectedRevision) {
  try {
    commitModelsSnapshot({ models, expectedRevision });
  } catch (error2) {
    if (error2 instanceof ConfigCoreError && error2.code === "config_changed") {
      ctx.ui.notify("Configuration changed by another process. Please re-open /vendor.", "error");
    } else {
      ctx.ui.notify(`Failed to save: ${describe(error2)}`, "error");
    }
    return;
  }
  try {
    await ctx.modelRegistry.refresh();
    const registryError = ctx.modelRegistry.getError();
    if (registryError) {
      ctx.ui.notify(`Configuration saved but Pi rejected it: ${registryError}`, "warning");
    } else {
      ctx.ui.notify("Configuration saved and models refreshed.", "info");
    }
  } catch (error2) {
    ctx.ui.notify(`Configuration saved but model reload failed: ${describe(error2)}`, "warning");
  }
}
async function selectProviderAndAddModel(ui, models) {
  const providerKeys = Object.keys(models.providers ?? {});
  if (providerKeys.length === 0) {
    ui.notify('No providers configured. Choose "Add provider" first.', "warning");
    return { kind: "cancelled" };
  }
  const providerKey2 = await ui.select({
    message: "Select provider:",
    choices: providerKeys.map((key) => ({ value: key, label: key }))
  });
  if (!providerKey2) return { kind: "cancelled" };
  const provider = models.providers?.[providerKey2];
  const initialProvider = provider ? {
    apiKey: typeof provider.apiKey === "string" ? provider.apiKey : void 0,
    headers: provider.headers
  } : void 0;
  return runAddModelFlow(ui, providerKey2, models, initialProvider);
}
function registerVendorCommand(pi) {
  pi.registerCommand(COMMAND_NAME, {
    description: "Add a custom provider or model in ~/.pi/agent/models.json",
    handler: async (args, ctx) => {
      if (String(args ?? "").trim() !== "") {
        ctx.ui.notify("Usage: /vendor", "error");
        return;
      }
      if (!supportsInteractiveUI(ctx.mode, ctx.hasUI)) {
        ctx.ui.notify(
          `/vendor needs interactive TUI mode. Edit ${getModelsJsonPath()} directly if you want to work non-interactively.`,
          "error"
        );
        return;
      }
      let snapshot;
      try {
        snapshot = readModelsSnapshot();
      } catch (error2) {
        ctx.ui.notify(describe(error2), "error");
        return;
      }
      const ui = createProductionQuickUI(ctx.ui);
      const action = await showRootMenu(ui);
      if (!action) {
        ctx.ui.notify("Vendor config unchanged.", "info");
        return;
      }
      const result = action === "add-provider" ? await runAddProviderFlow(ui, snapshot.models) : await selectProviderAndAddModel(ui, snapshot.models);
      if (result.kind === "cancelled") {
        ctx.ui.notify("Vendor config unchanged.", "info");
        return;
      }
      await saveAndRefresh(ctx, result.models, snapshot.revision);
    }
  });
}

// Pi prompt command: the prompt is embedded in this single extension file.
const VENDOR_PROMPT = "# Pi Vendor\n\nManage Pi's `models.json` with normal read/edit tools. It lives at the agent dir root (`$PI_CODING_AGENT_DIR/models.json`, default `~/.pi/agent/models.json`) on purpose: Pi itself reads it at startup, so it is not part of the `pi-pkg-cfg` directory that holds the other `@bytetrue` packages' private config. The bundled script has exactly four AI-facing read-only queries:\n\n```sh\nnode '<absolute-skill-directory>/scripts/vendor.mjs' catalog '<keyword>' ['<limit>']\nnode '<absolute-skill-directory>/scripts/vendor.mjs' discover '<provider-key>'\nnode '<absolute-skill-directory>/scripts/vendor.mjs' drift '<provider-key>' ['<official-provider>,...']\nnode '<absolute-skill-directory>/scripts/vendor.mjs' order '<models.dev-snapshot-file>' ['<provider-key>,...']\n```\n\n`drift` compares a provider's configured models against the active Pi installation's built-in official catalog (the same templates `catalog` serves) and reports per-field differences plus a machine-generated drift table; a model counts as up to date when it still matches at least one current official template exactly. `order` compares every provider's configured `models` array against the agreed series/`release_date` order and prints a machine-generated audit table plus its deviations; it reads a models.dev snapshot file, so fetch `https://models.dev/api.json` first (retry once through the environment's configured proxy if the direct fetch fails) and pass the saved path. Replace `<absolute-skill-directory>` with the directory containing this `SKILL.md`. Shell-quote the script path and every argument as one positional value (single quotes), so user text reaches the script literally. There is no AI-facing CRUD or lint command. `/vendor` remains the human cold-start TUI.\n\n`set-key` is a separate user-terminal-only helper because it prompts for a secret:\n\n```sh\nnode '<absolute-skill-directory>/scripts/vendor.mjs' set-key '<provider-key>'\n```\n\nHand this command to the user to run in their own terminal and wait for them to report completion; the secret stays out of chat entirely.\n\nWhen a bundled query fails (for example `catalog` printing `Official catalog is unavailable`), make at most one documented recovery attempt — locate the active Pi install prefix and retry once with `PI_VENDOR_PI_ROOT` — then report to the user in one short message what failed and what you tried, and wait for their direction. Diagnose from command output and package paths; `models.json` contents and credential values stay out of the transcript.\n\n## Boundaries\n\n- Treat every `apiKey` and authentication header value as secret: refer to it only as configured, missing, or changed — in replies, diffs, logs, tool arguments, and summaries alike.\n- Locate provider/model keys first (targeted search), then read only the smallest range needed for the mutation. The file carries secrets, so a whole-file read (`cat`, full `read`) is the one read shape to avoid.\n- Make the smallest targeted edit that preserves unknown fields and unrelated providers; everything outside the edit stays as the user wrote it.\n- Distinguish the configured target provider from the official catalog provider whose metadata is copied.\n- `catalog` is official metadata, not evidence that a target provider exposes a model. `discover` is upstream evidence, not official metadata.\n- Every pricing, capability, context/token limit, compat field, model ID, and routing value comes from the selected catalog template, `discover` output, or the user; when none of them supplies it, ask.\n- The user decides ambiguous model identity, official source, target provider, overwrite conflicts, and destructive operations.\n- Edit only `models.json`, and in it only the requested provider/model. `auth.json`, OAuth state, Pi settings, and unrelated providers change only on an explicit request.\n- For an exact synchronization, the machine-generated plan JSON is the only mutation authority: show it verbatim and refer to its arrays by name (`add`, `remove`, `after`) rather than retyping IDs. Machine-generated tables are relayed as-is, and user-facing references name each model by its exact ID.\n- `drift` output is evidence for the user to confirm; its updates land only after the user approves them field by field.\n\n## The models.json schema is an authority, not a suggestion\n\nPi validates `models.json` against its published schema\n(`https://pi.dev/schemas/models.schema.json`, field reference at\n`https://pi.dev/docs/latest/models-configuration`) and refuses the **whole file**\nwhen a field it knows fails validation. Read that reference before introducing a\nfield you have not used before; it is the only acceptable source for a field name,\ntype, or allowed value.\n\n- Unknown fields pass validation and must be preserved unchanged. The schema is\n  strict only about the fields it declares.\n- A `models` entry that has `cost` at all must carry all four of `input`,\n  `output`, `cacheRead`, `cacheWrite`. A partial `cost` fails the entire file even\n  when every other model is valid; there is no partial-cost form for `models`.\n  `modelOverrides` cost fields are individually optional and merge onto the\n  model's cost field by field.\n- Pi reports schema violations as a warning and still exits 0, so a successful\nexit never proves the file loaded. That is why the mandatory `pi --list-models\n  --offline` check reads both streams for `errors loading models.json`.\n- `$schema` is an ordinary top-level key: keep whatever the file already has, and\n  do not add or rewrite it on an existing file.\n\n## Exact synchronization templates\n\nThese are the only templates for exact synchronization. Keep `sync_dir`, `discovery_file`, and `plan_file` for the entire confirmation and mutation sequence; clean them after a successful finish or an abandoned plan. They contain only model IDs and route status, never credentials. Substitute only the shell-quoted provider key and absolute skill directory; the Node programs run byte-for-byte as written.\n\n### Generate the plan\n\nRun this once after `discover` has returned only `status: \"ok\"` routes. It writes the immutable plan file and prints the plan JSON followed by a machine-generated summary table; it reads only `providers.<key>.models` internally. Exact synchronization covers `models` only; `modelOverrides` go through workflow 4.\n\n```sh\nsync_dir=\"$(mktemp -d \"${TMPDIR:-/tmp}/pi-vendor-sync.XXXXXX\")\"\ndiscovery_file=\"$sync_dir/discovery.json\"\nplan_file=\"$sync_dir/plan.json\"\nnode '<absolute-skill-directory>/scripts/vendor.mjs' discover '<provider-key>' > \"$discovery_file\"\nPI_VENDOR_PROVIDER_KEY='<provider-key>' PI_VENDOR_DISCOVERY_FILE=\"$discovery_file\" PI_VENDOR_SYNC_PLAN_FILE=\"$plan_file\" node <<'NODE'\nconst { readFileSync, writeFileSync } = require(\"node:fs\");\nconst { homedir } = require(\"node:os\");\nconst { join } = require(\"node:path\");\nconst sorted = (ids) => [...new Set(ids)].sort((a, b) => a.localeCompare(b));\nconst providerKey = process.env.PI_VENDOR_PROVIDER_KEY;\nconst configPath = join(process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), \".pi\", \"agent\"), \"models.json\");\nconst provider = JSON.parse(readFileSync(configPath, \"utf8\"))?.providers?.[providerKey];\nif (!provider || !Array.isArray(provider.models) || Object.keys(provider.modelOverrides ?? {}).length) throw new Error(\"exact_sync_requires_models_without_overrides\");\nconst rawBefore = provider.models.map((model) => { if (!model || typeof model.id !== \"string\") throw new Error(\"invalid_model_id\"); return model.id; });\nif (new Set(rawBefore).size !== rawBefore.length) throw new Error(\"duplicate_configured_model_id\");\nconst discovery = JSON.parse(readFileSync(process.env.PI_VENDOR_DISCOVERY_FILE, \"utf8\"));\nif (!Array.isArray(discovery.routes) || discovery.routes.some((route) => route?.status !== \"ok\" || !Array.isArray(route.modelIds))) throw new Error(\"exact_sync_requires_verified_routes\");\nconst before = sorted(rawBefore);\nconst after = sorted(discovery.routes.flatMap((route) => route.modelIds));\nconst beforeSet = new Set(before);\nconst afterSet = new Set(after);\nconst plan = { before, add: after.filter((id) => !beforeSet.has(id)), remove: before.filter((id) => !afterSet.has(id)), after };\nwriteFileSync(process.env.PI_VENDOR_SYNC_PLAN_FILE, `${JSON.stringify(plan)}\\n`, { mode: 0o600 });\nconst kept = plan.before.filter((id) => !plan.remove.includes(id));\nlet summary = \"#### Sync plan summary (machine-generated; the JSON above is the only mutation authority)\\n\\n\";\nif (plan.add.length + plan.remove.length === 0) summary += \"No additions or removals: the configured set already equals the verified upstream union.\\n\";\nelse {\n  summary += \"| action | model id |\\n|---|---|\\n\";\n  for (const id of plan.add) summary += `| add | ${id} |\\n`;\n  for (const id of plan.remove) summary += `| remove | ${id} |\\n`;\n}\nsummary += `\\nkept ${kept.length} of ${plan.before.length} configured models unchanged${kept.length ? `: ${kept.join(\", \")}` : \"\"}\\n`;\nprocess.stdout.write(`${JSON.stringify(plan)}\\n\\n${summary}`);\nNODE\n```\n\nShow that printed output verbatim: the one-line plan JSON is the mutation authority and the summary table below it is for the user. Resolve catalog source for every `add` ID, present that resolution as a table (model ID, official provider, key metadata, status), and obtain confirmation for the exact `remove` and `after` arrays. Every model ID the user sees comes from that machine output, quoted as-is; prose refers to models by their exact ID.\n\n### Assert before and after\n\nImmediately before editing, run this exact stale check with `PI_VENDOR_SYNC_EXPECT=before`. A `plan_stale` result invalidates the plan; regenerate it and obtain fresh confirmation. Immediately after editing, run the same unchanged program with `PI_VENDOR_SYNC_EXPECT=after`; it must print `plan_after_matches=yes` before continuing.\n\n```sh\nPI_VENDOR_PROVIDER_KEY='<provider-key>' PI_VENDOR_SYNC_PLAN_FILE=\"$plan_file\" PI_VENDOR_SYNC_EXPECT=before node <<'NODE'\nconst { readFileSync } = require(\"node:fs\");\nconst { homedir } = require(\"node:os\");\nconst { join } = require(\"node:path\");\nconst sorted = (ids) => [...new Set(ids)].sort((a, b) => a.localeCompare(b));\nconst expected = process.env.PI_VENDOR_SYNC_EXPECT;\nif (expected !== \"before\" && expected !== \"after\") throw new Error(\"invalid_sync_assertion\");\nconst configPath = join(process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), \".pi\", \"agent\"), \"models.json\");\nconst provider = JSON.parse(readFileSync(configPath, \"utf8\"))?.providers?.[process.env.PI_VENDOR_PROVIDER_KEY];\nconst actual = sorted((provider?.models ?? []).map((model) => model?.id));\nconst plan = JSON.parse(readFileSync(process.env.PI_VENDOR_SYNC_PLAN_FILE, \"utf8\"));\nif (JSON.stringify(actual) !== JSON.stringify(plan[expected])) { console.error(expected === \"before\" ? \"plan_stale\" : \"plan_after_mismatch\"); process.exit(1); }\nconsole.log(`plan_${expected}_matches=yes`);\nNODE\n```\n\nFor the post-edit assertion, change only the shell assignment to `PI_VENDOR_SYNC_EXPECT=after`. On `plan_after_mismatch`, repair toward the plan's `after` array (or restore the prior state), then rerun the assertion.\n\n### Assert the final discovery union\n\nAfter the mandatory Pi offline verification, rerun `discover` into `$discovery_file`, then run this assertion. It blocks success if any route fails or if the verified upstream union differs from the confirmed plan.\n\n```sh\nnode '<absolute-skill-directory>/scripts/vendor.mjs' discover '<provider-key>' > \"$discovery_file\"\nPI_VENDOR_DISCOVERY_FILE=\"$discovery_file\" PI_VENDOR_SYNC_PLAN_FILE=\"$plan_file\" node <<'NODE'\nconst { readFileSync } = require(\"node:fs\");\nconst sorted = (ids) => [...new Set(ids)].sort((a, b) => a.localeCompare(b));\nconst discovery = JSON.parse(readFileSync(process.env.PI_VENDOR_DISCOVERY_FILE, \"utf8\"));\nconst plan = JSON.parse(readFileSync(process.env.PI_VENDOR_SYNC_PLAN_FILE, \"utf8\"));\nif (!Array.isArray(discovery.routes) || discovery.routes.some((route) => route?.status !== \"ok\" || !Array.isArray(route.modelIds))) { console.error(\"discovery_unverified\"); process.exit(1); }\nif (JSON.stringify(sorted(discovery.routes.flatMap((route) => route.modelIds))) !== JSON.stringify(plan.after)) { console.error(\"discovery_union_mismatch\"); process.exit(1); }\nconsole.log(\"discovery_union_matches=yes\");\nNODE\n```\n\n## Choose one workflow\n\nClassify the request into exactly one workflow and follow its numbered steps. When a step hands off (\"continue with workflow 1\"), that hand-off is the only way into another workflow; a single `discover` call is the whole discovery for a request.\n\n### 1. Configure a model\n\n1. Treat the user's text as a model *request* and preserve it verbatim; the canonical ID is whatever `catalog` resolves it to.\n2. Derive a useful catalog keyword and run `catalog`. For example, search `千问 3.7` with likely catalog terms such as `qwen 3.7`. If the first search is empty, retry with simpler brand/version terms.\n3. Compare `count` with `total`. If truncated, rerun with limit `100` and narrow the keyword until every relevant candidate is visible.\n4. Show the mapping `(user text -> candidate ID -> official provider)` and all viable matches. A fuzzy result is a candidate that the user confirms. If identity or official source is ambiguous, ask the user to select it.\n5. Resolve the target provider. An exact target named by the user is settled; move on.\n6. Locate only the target provider/model range and apply the narrow edit. When copying from the selected official template, preserve 100% of the official template's non-routing metadata verbatim:\n   - Retain every official field (e.g. `allowedFallbackModels`, `compat`, `thinkingLevelMap`, `contextWindow`, etc.) without dropping or trimming anything.\n   - Retain the exact key order of the official template, even when neighbouring models in the file use a different order.\n   - Routing fields (`baseUrl`, credentials, headers, `provider`, `authHeader`) come from the target provider, so they are left out of the copy.\n   - Apply the Anthropic Messages and Google Generative AI `baseUrl` Rules below if applicable.\n7. Run the mandatory final verification below; completion is reported only after it passes.\n8. Run the mandatory Model ordering check (see the \"Model ordering\" section): fetch the models.dev snapshot, run the `order` query, relay its table verbatim, and act on its deviations or unresolved rows.\n\nIf catalog returns no match, say so — absence is not proof the model is invalid — and ask whether to use the requested text verbatim as a custom ID or to try another search term. The ID the user typed stays exactly as typed until they choose.\n\nUse `models` for new/custom definitions and `modelOverrides` for partial changes to an existing built-in or extension model. Add model-level `api` or `baseUrl` only when it differs from the inherited provider route, with two mandatory adapter rules:\n\n- **Anthropic Messages `baseUrl` Rule**: Pi's `anthropic-messages` adapter (via the Anthropic SDK) automatically appends `/v1/messages` to requests. If a model uses or inherits `api: \"anthropic-messages\"` while the provider's `baseUrl` contains a trailing `/v1` (e.g. `http://host:port/v1`), you **must** configure a model-level `baseUrl` stripped of the trailing `/v1` (e.g. `baseUrl: \"http://host:port\"`). Leaving it unconfigured causes requests to hit `/v1/v1/messages` and fail with 404. When the provider's `baseUrl` has no `/v1` segment, the model inherits it unchanged (no model-level `baseUrl`).\n\n- **Google Generative AI `baseUrl` Rule**: Pi's `google-generative-ai` adapter sets `httpOptions.apiVersion = \"\"` on `@google/genai` whenever `baseUrl` is present, so the SDK never appends `/v1beta` itself and calls `<baseUrl>/models/<id>:streamGenerateContent` directly. If a model uses or inherits `api: \"google-generative-ai\"` while the provider's `baseUrl` does not already end in `/v1beta` (e.g. `http://host:port/v1` or `http://host:port`), you **must** configure a model-level `baseUrl` ending in `/v1beta` (replacing a trailing `/v1` with `/v1beta`, e.g. `baseUrl: \"http://host:port/v1beta\"`, or appending `/v1beta` when no version segment is present). Leaving it unconfigured causes requests to hit `/v1/models/<id>:streamGenerateContent` or `/models/<id>:streamGenerateContent` and fail with 404. When the provider's `baseUrl` already ends in `/v1beta`, the model inherits it unchanged (no model-level `baseUrl`).\n\n- **Strict-Patch Rule (In-Place Integrity)**:\n  - When updating an existing model, change **only** the specific field value requested by the user. Every other field and the original key declaration order remain 100% unchanged.\n  - When adding a model from an official template, carry over all non-routing fields in their exact official key order.\n\nEach model ID appears once per provider's `models` array; when the ID already exists, the request is an update (workflow 4), not a second entry.\n\n### 2. List or synchronize a provider's upstream models\n\n1. Run exactly one aggregate query:\n\n   ```sh\n   node '<absolute-skill-directory>/scripts/vendor.mjs' discover '<provider-key>'\n   ```\n\n2. Report each returned route by `routeId`, API type, status, and model IDs. The command already deduplicates effective provider/model routes across the four supported API adapters, so this one call is the whole discovery.\n3. A returned ID is positive evidence that route listed it. An error means that route is unverified. Absence alone is not proof that a configured model is unsupported.\n4. For a plain listing, stop here and report the routes and IDs as returned. Configured/unconfigured/unsupported set comparisons belong to exact synchronization only.\n5. Only when the user explicitly requests an exact synchronization and every intended route has `status: \"ok\"`, use **Generate the plan** from the exact synchronization templates. It emits the sorted `{\"before\":[],\"add\":[],\"remove\":[],\"after\":[]}` JSON plus a machine-generated summary table without exposing configuration or credentials.\n6. Treat that generated JSON as immutable. Show the printed plan JSON and its summary table verbatim, run `catalog` for every ID in `add`, and resolve every official source. Present the resolution as a table (model ID, official provider, key metadata, status), naming each model by its exact ID. Ask the user to confirm the exact `remove` and `after` arrays. Keep the whole batch read-only until every source and destructive choice is resolved.\n7. **Kept-model drift check.** For the models that stay configured (present in both `before` and `after`), run `node '<absolute-skill-directory>/scripts/vendor.mjs' drift '<provider-key>'` and relay its drift table verbatim. A drifted model is a question: its configured copy no longer matches any current official template, and the user decides whether that is intended or stale. Combine this with the plan confirmation into a single confirmation round when both are ready; the update waits for the user's per-field approval.\n8. If any intended route failed, report the unverified route and offer only additions with positive evidence (workflow 1); removals and exact synchronization wait until every intended route is `ok`.\n9. Immediately before editing, run **Assert before and after**. If it returns `plan_stale`, stop, regenerate the plan, show it verbatim, and obtain fresh confirmation — the old plan is discarded.\n10. Apply only the confirmed plan and selected catalog templates, ensuring any `anthropic-messages` models on a provider with a trailing `/v1` `baseUrl` receive a model-level `baseUrl` stripped of `/v1`, and any `google-generative-ai` models on a provider whose `baseUrl` does not end in `/v1beta` receive a model-level `baseUrl` normalized to `/v1beta`. Immediately run its after assertion. `plan_after_mismatch` means repair only this mutation or restore its prior state, then rerun the assertion; the gate is the assertion, beyond Pi merely loading the file.\n11. After the sync assertions pass, apply the user-approved drift updates as strict in-place patches: change only the approved field values, keep every other field and the original key declaration order 100% unchanged, and leave unapproved fields as they are.\n12. Run the mandatory final verification, then **Assert the final discovery union**. Exact sync is successful only when all three assertion templates pass.\n13. Run the mandatory Model ordering check: fetch `https://models.dev/api.json` to a file (retry once through the environment's configured proxy if the direct fetch fails), run the `order` query against it, relay its table verbatim, and act on its deviations or unresolved rows.\n14. If the user chooses only one model to add instead of synchronizing, continue with workflow 1 and use `catalog` only to resolve its official metadata.\n\n### 3. Add a provider\n\n1. Collect the provider key, `baseUrl`, API adapter, and any required non-secret headers; ask for anything unresolved.\n2. Locate the `providers` object and add only the new provider with a narrow edit. Preserve every unrelated field.\n3. If a key is required, create the provider without exposing it and give the user the `set-key` command. Continue only after the user reports completion.\n4. Run the mandatory Pi offline verification.\n5. When credentials are configured, run `discover <provider-key>`. At least the intended route must have `status: \"ok\"` before reporting the provider as upstream-verified.\n6. If the user also requested a model, continue with workflow 1.\n\n### 4. Read, update, or delete a provider/model\n\n1. Locate the exact provider key or model ID with a targeted search and read only that range.\n2. For a read, report only non-secret routing fields and model IDs.\n3. For an update, apply a strict in-place patch: modify only the requested field value. Keep every other existing field, nested structure, and key declaration order 100% intact. Before changing inherited provider routing, identify affected models and preserve required model-level overrides (including the Anthropic Messages trailing `/v1` and Google Generative AI `/v1beta` `baseUrl` rules).\n4. For deletion, show the exact target and confirm unless the user already requested that exact deletion. Removing a built-in override restores built-in behavior; it does not delete Pi's built-in provider.\n5. Apply the narrow edit, then run the mandatory final verification.\n6. After a model update or deletion, run the mandatory Model ordering check: fetch the models.dev snapshot, run the `order` query, relay its table verbatim, and act on its deviations or unresolved rows.\n\nFor conflicts, report the exact JSON path and ask whether to update, replace, skip, or choose another target; the edit waits for that answer.\n\n## Mandatory final verification\n\nEvery mutation has a hard completion gate:\n\n1. Run the active Pi executable against the active configuration:\n\n   ```sh\n   pi --list-models --offline\n   ```\n\n2. Inspect both streams. Pi can exit zero even when it prints `Warning: errors loading models.json:`. Require no models.json loading warning; after a model mutation, also require the intended model ID to be present or absent as requested.\n3. For an exact synchronization, structurally compare the configured sorted ID set with the confirmed plan's `after` array. Exact equality is mandatory; both sides come from the assertion template, never from a hand-built list.\n4. If the command fails, emits any models.json loading warning, or any intended or exact-set assertion fails, repair only the targeted edit or restore its previous value, then rerun every failed check. The task ends only with a configuration that passes every check.\n5. After provider routing, authentication, model routing, or synchronization changes, also run `discover <provider-key>`. Require every intended route to return `status: \"ok\"`; for exact sync, require its discovered-ID union to equal the confirmed `after` set. Otherwise report verification failure, not configuration success.\n6. Report verification by changed JSON paths and check results; the whole provider block, full diff, credential-bearing diagnostics, and raw secret values stay out of the transcript.\n\nAn actual generation request can consume quota and is not part of the default gate. Run one only when the user explicitly asks for a live model call.\n\nAfter successful verification, run the model ordering audit (next section), then report only the changed JSON paths, selected official source or custom status, Pi offline verification result, and applicable discovery status.\n\n## Model ordering\n\nEvery model mutation workflow (Configure a model, Exact sync, Update/delete a model) has a mandatory ordering audit gate before reporting completion. The audit covers the entire file just edited — every provider's `models` array, not only the provider you touched — because partial reordering is meaningless.\n\nThe agreed order is:\n\n1. Model series / families in alphabetical order (A-Z) by top-level brand or series name (e.g. `claude` before `deepseek`, `deepseek` before `gemini`, `gemini` before `glm`, `glm` before `gpt`, `gpt` before `kimi`, `kimi` before `qwen`).\n2. Within the same model series, models are ordered strictly by release date (`release_date`), oldest first (e.g. across the entire `claude` series: `claude-haiku-4-5` [2025-10-15] before `claude-fable-5` [2026-06-07] before `claude-sonnet-5` [2026-06-29] before `claude-opus-5` [2026-07-24] before `claude-fable-5-1` [2026-09-01]; fable-5 was released before sonnet-5 and opus-5, so it must precede them). The dates above are illustrative: the audit table carries each snapshot date and flags any multi-source conflicts.\n\nThe audit is machine-generated, so never assert order from memory or from the fact that a mutation left positions untouched:\n\n```sh\nsnapshot=\"$(mktemp \"${TMPDIR:-/tmp}/pi-vendor-order.XXXXXX\")\"\ncurl -s --max-time 30 'https://models.dev/api.json' -o \"$snapshot\"\nnode '<absolute-skill-directory>/scripts/vendor.mjs' order \"$snapshot\"\n```\n\nFetch the snapshot directly, and on failure retry once through the environment's configured proxy before reporting the failure. Relay the audit table and its deviation/unresolved tables verbatim; do not restate model order in prose as if it were your own finding.\n\n**Enforcement Gate**: the audit exits nonzero when it detects a deviation or an unresolved date. In both cases, **explicitly alert the user with the audit's own rows** and ask whether to reorganize the whole file; never conclude silently. Resolve deviations by proposing the audit's `proposedOrder` and confirming with the user before editing. For unresolved rows (a model with no release date in the snapshot), ask the user for its date, or keep its relative position when they prefer.\n\nReordering is a narrow edit: move whole model objects without changing any field or key order within them. After the edit, rerun the mandatory final verification and the audit until it reports no deviations and no unresolved rows.\n\nThis audit applies to the file just edited only.\n\n## API keys\n\nGive the user this command to run in their own terminal:\n\n```sh\nnode '<absolute-skill-directory>/scripts/vendor.mjs' set-key '<provider-key>'\n```\n\nIt prompts without echo and atomically writes mode `0600`. After the user reports completion, run the mandatory final verification; the value itself stays with the user.\n\n## Audit\n\nFor an audit, run Pi offline validation, use `discover` for configured upstream routes, and use `catalog` only for model metadata questions. Run `drift <provider-key>` against the built-in official catalog and report per-model template drift alongside the Pi version the comparison used. Verify routing constraints, especially the Anthropic Messages and Google Generative AI rules: any model with `api: \"anthropic-messages\"` under a provider whose `baseUrl` ends in `/v1` must specify a model-level `baseUrl` without `/v1`, and any model with `api: \"google-generative-ai\"` under a provider whose `baseUrl` does not end in `/v1beta` must specify a model-level `baseUrl` ending in `/v1beta`. Report exact JSON paths, route statuses, routing defects, ambiguity, and remediation without credential values. A clean file gets a clean report and no edit.\n";

function vendorScriptPath() {
  const extensionDir = dirname(fileURLToPath(import.meta.url));
  const installed = join(extensionDir, "pi-vendor", "scripts", "vendor.mjs");
  if (existsSync(installed)) return installed;
  return join(extensionDir, "scripts", "vendor.mjs");
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function vendorPromptText(args) {
  const scriptPath = vendorScriptPath();
  const prompt = VENDOR_PROMPT
    .replace("Replace `<absolute-skill-directory>` with the directory containing this `SKILL.md`.", "Use the absolute bundled script paths shown in the commands.")
    .replaceAll("'<absolute-skill-directory>/scripts/vendor.mjs'", shellQuote(scriptPath))
    .replaceAll("<absolute-skill-directory>", shellQuote(dirname(scriptPath)))
    .replaceAll("this `SKILL.md`", "the vendor prompt");
  const request = String(args ?? "").trim();
  return request ? `${prompt}\n\nUser request:\n${request}` : prompt;
}

function registerVendorPromptCommand(pi) {
  pi.registerCommand("vendor-ai", {
    description: "Manage Pi providers and models with the vendor prompt and bundled script",
    handler: async (args) => {
      pi.sendUserMessage(vendorPromptText(args), { deliverAs: "nextTurn" });
    }
  });
}

// packages/pi-vendor/src/index.ts
function registerVendor(pi) {
  registerVendorCommand(pi);
  registerVendorPromptCommand(pi);
}
export {
  CommandResolutionError,
  ConfigCoreError,
  MODELS_JSON_SCHEMA_URL,
  ModelSourceError,
  acquireOneModel,
  addModel,
  allCommandsTrusted,
  collectCommandPaths,
  collectOfficialCandidates,
  commitModelsSnapshot,
  createConfigCoreForTesting,
  createProductionCommandRunner,
  createProductionQuickUI,
  createProvider,
  createScriptedQuickUI,
  registerVendor as default,
  discoverModelIds,
  encodeConfigLiteral,
  enrichModelId,
  findOfficialCatalogPath,
  formatOfficialCandidate,
  fuzzyFilter,
  fuzzyMatch,
  getModelsJsonPath,
  loadOfficialCatalog,
  pickModelId,
  preflightCommandTrust,
  readModelsSnapshot,
  registerVendorCommand,
  replaceModel,
  resolveCandidateRoots,
  resolveConfigValue,
  resolveModelConfig,
  runAddModelFlow,
  runAddProviderFlow,
  searchOfficialModels,
  selectProviderAndAddModel,
  showRootMenu,
  stripOfficialRoutingFields,
  stripTrailingV1,
  supportsInteractiveUI,
  toGoogleV1Beta,
  validateModelsJson,
  withSchemaHint
};
