// src/config-mutations.ts
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
function renameProvider(models, fromKey, toKey, options = {}) {
  const source = providerKey(fromKey);
  const target = providerKey(toKey);
  if (!source || !target) return error("invalid_provider_key", "/providers");
  const providers = clonedProviders(models);
  if (!hasProvider(providers, source)) return error("provider_not_found", `/providers/${pointer(source)}`);
  if (source === target) return { ok: true, value: { ...cloneJson(models), providers } };
  if (hasProvider(providers, target) && options.conflict !== "overwrite-confirmed") {
    return error("provider_exists", `/providers/${pointer(target)}`);
  }
  const config = providers[source];
  delete providers[source];
  setProvider(providers, target, config);
  return { ok: true, value: { ...cloneJson(models), providers } };
}
function deleteProvider(models, key) {
  const target = providerKey(key);
  if (!target) return error("invalid_provider_key", "/providers");
  const providers = clonedProviders(models);
  if (!hasProvider(providers, target)) return error("provider_not_found", `/providers/${pointer(target)}`);
  delete providers[target];
  return { ok: true, value: { ...cloneJson(models), providers } };
}
function providerModels(models, provider) {
  const key = providerKey(provider);
  if (!key) return error("invalid_provider_key", "/providers");
  const document2 = cloneJson(models);
  const providers = clonedProviders(models);
  if (!hasProvider(providers, key)) return error("provider_not_found", `/providers/${pointer(key)}`);
  const config = providers[key];
  return { document: document2, providers, config, models: Array.isArray(config.models) ? config.models : [] };
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
function deleteModel(models, provider, idValue) {
  const id = modelId(idValue);
  if (!id) return error("invalid_model_id", "/providers/models");
  const state = providerModels(models, provider);
  if ("ok" in state) return state;
  const index = state.models.findIndex((entry) => entry.id === id);
  if (index < 0) return error("model_not_found", "/providers/models");
  state.config.models = state.models.filter((_, current) => current !== index);
  return { ok: true, value: { ...state.document, providers: state.providers } };
}
function isUnderProviderPath(path, providerKeyValue) {
  const prefix = `/providers/${pointer(providerKeyValue)}`;
  return path === prefix || path.startsWith(`${prefix}/`);
}
function categorizeSecretSlot(path) {
  if (path.endsWith("/apiKey")) return "apiKey";
  if (path.includes("/headers/")) return "header";
  return "other";
}

// src/web/client/state.ts
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function issue(message, opts) {
  return { message, ...opts };
}
function ok(value, warnings) {
  return { ok: true, value, warnings };
}
function fail(message, opts) {
  return { ok: false, error: issue(message, opts) };
}
function providerKey2(value) {
  return value.trim() || void 0;
}
function hasProvider2(draft, key) {
  const providers = draft.providers;
  return providers ? Object.hasOwn(providers, key) : false;
}
function getProviders(draft) {
  return draft.providers ?? {};
}
function sortedProviderKeys(draft) {
  return Object.keys(getProviders(draft)).sort();
}
function selectAfterDelete(draft, deletedKey, currentSelection) {
  const keys = sortedProviderKeys(draft);
  if (keys.length === 0) return null;
  if (currentSelection !== deletedKey && currentSelection && hasProvider2(draft, currentSelection)) return currentSelection;
  const oldSorted = [...keys, deletedKey].sort();
  const idx = oldSorted.indexOf(deletedKey);
  const nextIdx = Math.min(idx, keys.length - 1);
  return keys[nextIdx] ?? null;
}
function countSecretsForProvider(slots, key) {
  const matching = slots.filter((s) => isUnderProviderPath(s.path, key));
  let apiKey = 0;
  let header = 0;
  let other = 0;
  for (const s of matching) {
    const cat = categorizeSecretSlot(s.path);
    if (cat === "apiKey") apiKey += 1;
    else if (cat === "header") header += 1;
    else other += 1;
  }
  return { total: matching.length, apiKey, header, other };
}
function formatSecretRemovalMessage(slots) {
  let apiKey = 0;
  let header = 0;
  let other = 0;
  for (const s of slots) {
    const cat = categorizeSecretSlot(s.path);
    if (cat === "apiKey") apiKey += 1;
    else if (cat === "header") header += 1;
    else other += 1;
  }
  const parts = [];
  if (apiKey > 0) parts.push(`${apiKey} apiKey secret(s)`);
  if (header > 0) parts.push(`${header} header secret(s)`);
  if (other > 0) parts.push(`${other} other secret(s)`);
  return parts.length > 0 ? `This will remove ${parts.join(", ")}. Continue?` : "Configured secrets will be removed. Continue?";
}
var SECRET_PREFIX = "pi-vendor-secret:";
function isSecretRef(value) {
  return typeof value === "string" && value.startsWith(SECRET_PREFIX);
}
function scanSecretRefs(draft) {
  const refLocations = /* @__PURE__ */ new Map();
  const invalid = [];
  function walk(value, path) {
    if (isSecretRef(value)) {
      const existing = refLocations.get(value);
      if (existing) existing.push(path);
      else refLocations.set(value, [path]);
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], `${path}/${i}`);
      }
    } else if (value && typeof value === "object") {
      for (const [key, val] of Object.entries(value)) {
        const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
        walk(val, `${path}/${escaped}`);
      }
    }
  }
  walk(draft, "");
  for (const [ref, paths] of refLocations) {
    if (paths.length > 1) {
      invalid.push({ ref, path: paths[0], reason: "SecretRef appears in multiple locations" });
    }
  }
  return { refLocations, invalid };
}
function validateSecretRefLocations(draft, slots) {
  const slotMap = new Map(slots.map((s) => [s.ref, s]));
  const { refLocations, invalid } = scanSecretRefs(draft);
  if (invalid.length > 0) {
    return fail(`Invalid secret references: ${invalid.map((i) => i.reason).join("; ")}`);
  }
  const removed = [];
  const moved = [];
  for (const slot of slots) {
    const paths = refLocations.get(slot.ref);
    if (!paths || paths.length === 0) {
      removed.push(slot);
    } else if (paths.length > 1) {
      return fail(`Secret reference appears in multiple locations: ${slot.ref} at [${paths.join(", ")}]`);
    } else if (paths[0] === slot.path) {
    } else {
      moved.push(slot);
      return fail(`Secret reference moved from ${slot.path} to ${paths[0]}`);
    }
  }
  for (const ref of refLocations.keys()) {
    if (!slotMap.has(ref)) {
      return fail(`Unknown secret reference: ${ref}`);
    }
  }
  return ok({ removed, moved });
}
function mapConfigIssues(issues, fallbackMessage) {
  if (!issues.length) return [issue(fallbackMessage)];
  return issues.map((item) => {
    const path = item.path;
    const message = item.message || fallbackMessage;
    if (!path) return issue(message);
    const m = path.match(/^\/providers\/([^/]+)(?:\/([^/]+))?/);
    if (!m) return issue(message, { path });
    const provider = m[1].replaceAll("~1", "/").replaceAll("~0", "~");
    const field = m[2]?.replaceAll("~1", "/").replaceAll("~0", "~");
    return issue(message, { path, provider, field });
  });
}
function reduceProviderAction(state, action) {
  const next = { ...state, errors: [] };
  switch (action.type) {
    case "load": {
      return ok({
        baseline: clone(action.apiState.models),
        draft: clone(action.apiState.models),
        revision: action.apiState.revision,
        secretSlots: clone(action.apiState.secretSlots),
        selectedProvider: sortedProviderKeys(action.apiState.models)[0] ?? null,
        rawText: null,
        dirty: false,
        errors: []
      });
    }
    case "select": {
      if (action.key && !hasProvider2(next.draft, action.key)) {
        return fail("Provider not found", { provider: action.key });
      }
      return ok({ ...next, selectedProvider: action.key, rawText: null });
    }
    case "create": {
      const key = providerKey2(action.key);
      if (!key) return fail("Provider key cannot be empty", { field: "key" });
      const result = createProvider(next.draft, key, {});
      if (!result.ok) return fail(result.error.message, { provider: key, field: "key" });
      return ok({
        ...next,
        draft: result.value,
        selectedProvider: key,
        rawText: null,
        dirty: true
      });
    }
    case "rename": {
      const source = providerKey2(action.from);
      const target = providerKey2(action.to);
      if (!source || !target) return fail("Provider key cannot be empty", { field: "key" });
      const blockedSlots = next.secretSlots.filter((s) => isUnderProviderPath(s.path, source));
      if (blockedSlots.length > 0) {
        return fail(
          `Cannot rename: provider contains ${blockedSlots.length} configured secret(s). Replace or remove secrets first.`,
          { provider: source, field: "key" }
        );
      }
      const targetSecrets = next.secretSlots.filter((s) => isUnderProviderPath(s.path, target));
      if (hasProvider2(next.draft, target) && action.conflict !== "overwrite-confirmed") {
        const result2 = renameProvider(next.draft, source, target, { conflict: "reject" });
        if (!result2.ok) {
          const secretHint = targetSecrets.length > 0 ? ` Overwrite would remove ${targetSecrets.length} secret(s).` : "";
          return fail(`${result2.error.message}.${secretHint} Confirm overwrite to continue.`, {
            provider: source,
            field: "key"
          });
        }
      }
      const result = renameProvider(next.draft, source, target, { conflict: action.conflict });
      if (!result.ok) return fail(result.error.message, { provider: source, field: "key" });
      const remainingSlots = action.conflict === "overwrite-confirmed" ? next.secretSlots.filter((s) => !isUnderProviderPath(s.path, target)) : next.secretSlots;
      return ok({
        ...next,
        draft: result.value,
        secretSlots: remainingSlots,
        selectedProvider: target,
        rawText: null,
        dirty: true
      });
    }
    case "delete": {
      const key = providerKey2(action.key);
      if (!key) return fail("Provider key cannot be empty");
      const result = deleteProvider(next.draft, key);
      if (!result.ok) return fail(result.error.message, { provider: key });
      const newSelection = selectAfterDelete(result.value, key, next.selectedProvider);
      const remainingSlots = next.secretSlots.filter((s) => !isUnderProviderPath(s.path, key));
      return ok({
        ...next,
        draft: result.value,
        secretSlots: remainingSlots,
        selectedProvider: newSelection,
        rawText: null,
        dirty: true
      });
    }
    case "set-field": {
      if (!action.key || !hasProvider2(next.draft, action.key)) {
        return fail("Provider not found", { provider: action.key });
      }
      const providers = clone(getProviders(next.draft));
      const config = { ...providers[action.key] };
      config[action.field] = action.value;
      providers[action.key] = config;
      return ok({
        ...next,
        draft: { ...clone(next.draft), providers },
        dirty: true
      });
    }
    case "remove-field": {
      if (!action.key || !hasProvider2(next.draft, action.key)) {
        return fail("Provider not found", { provider: action.key });
      }
      const providers = clone(getProviders(next.draft));
      const config = { ...providers[action.key] };
      delete config[action.field];
      providers[action.key] = config;
      return ok({
        ...next,
        draft: { ...clone(next.draft), providers },
        dirty: true
      });
    }
    case "apply-raw": {
      let parsed;
      try {
        parsed = JSON.parse(action.text);
      } catch {
        return fail("Invalid JSON", { field: "raw" });
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return fail("Configuration must be a JSON object", { field: "raw" });
      }
      const obj = parsed;
      if (!obj.providers || typeof obj.providers !== "object" || Array.isArray(obj.providers)) {
        return fail("Configuration must contain a providers object", { field: "raw" });
      }
      const refCheck = validateSecretRefLocations(obj, next.secretSlots);
      if (!refCheck.ok) {
        return refCheck;
      }
      if (refCheck.value.removed.length > 0 && !action.confirmSecretRemoval) {
        return fail(formatSecretRemovalMessage(refCheck.value.removed), { field: "raw" });
      }
      const newKeys = sortedProviderKeys(obj);
      const newSelection = next.selectedProvider && hasProvider2(obj, next.selectedProvider) ? next.selectedProvider : newKeys[0] ?? null;
      const remainingSlots = next.secretSlots.filter(
        (s) => !refCheck.value.removed.some((r) => r.ref === s.ref)
      );
      return ok({
        ...next,
        draft: clone(obj),
        secretSlots: remainingSlots,
        rawText: null,
        selectedProvider: newSelection,
        dirty: true
      });
    }
    case "set-raw-text": {
      return ok({ ...next, rawText: action.text });
    }
    case "set-dirty": {
      return ok({ ...next, dirty: true });
    }
    case "clear-errors": {
      return ok({ ...next, errors: [] });
    }
    case "set-errors": {
      return ok({ ...next, errors: action.errors });
    }
    default:
      return fail("Unknown action");
  }
}
function createApiClient(token) {
  const headers = () => ({
    Authorization: `Bearer ${token}`
  });
  return {
    async fetchState() {
      const res = await fetch("/api/state", { headers: headers() });
      const text = await res.text();
      if (!res.ok) {
        let message = `Server error: ${res.status}`;
        try {
          const body = JSON.parse(text);
          if (body.error?.message) message = body.error.message;
        } catch {
          if (text.trim()) message = text.slice(0, 200);
        }
        throw new Error(message);
      }
      if (!text.trim()) throw new Error("Empty state response from server");
      const raw = JSON.parse(text);
      const models = raw.models ?? raw.draft;
      if (!models || typeof models !== "object") {
        throw new Error("Invalid state payload: missing models");
      }
      const secretSlotsRaw = raw.secretSlots ?? raw.slots;
      const secretSlots = Array.isArray(secretSlotsRaw) ? secretSlotsRaw.map((entry) => {
        if (entry && typeof entry === "object" && "path" in entry && "ref" in entry) {
          return { ref: String(entry.ref), path: String(entry.path) };
        }
        if (entry && typeof entry === "object" && "slot" in entry) {
          const nested = entry.slot;
          if (nested?.ref && nested?.path) return { ref: String(nested.ref), path: String(nested.path) };
        }
        throw new Error("Invalid secret slot in state payload");
      }) : [];
      return {
        models,
        revision: raw.revision,
        secretSlots,
        providerFields: Array.isArray(raw.providerFields) ? raw.providerFields : [],
        modelFields: Array.isArray(raw.modelFields) ? raw.modelFields : []
      };
    },
    async saveConfig(draft, revision) {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ models: draft, expectedRevision: revision })
      });
      if (res.status === 409) {
        throw Object.assign(
          new Error("Configuration was modified by another process. Please close and reopen this page."),
          { code: "config_changed" }
        );
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: "Save failed" } }));
        const errMsg = body.error;
        throw Object.assign(new Error(errMsg?.message ?? "Save failed"), {
          code: errMsg?.code ?? "save_failed",
          issues: errMsg?.issues ?? []
        });
      }
      const result = await res.json();
      return result.revision;
    },
    async cancelSession() {
      try {
        await fetch("/api/cancel", { method: "POST", headers: headers() });
      } catch {
      }
    }
  };
}

// src/web/client/provider-view.ts
function esc(text) {
  const el = document.createElement("span");
  el.textContent = text;
  return el.innerHTML;
}
function escAttr(text) {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function $id(id) {
  return document.getElementById(id);
}
function listen(id, event, fn) {
  $id(id)?.addEventListener(event, fn);
}
var SECRET_PREFIX2 = "pi-vendor-secret:";
function isSecretRef2(value) {
  return typeof value === "string" && value.startsWith(SECRET_PREFIX2);
}
var API_FORMATS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai"
];
var lastFocusedFieldId = null;
function renderProviderSidebar(state) {
  const providers = state.draft.providers ?? {};
  const keys = Object.keys(providers).sort();
  let html = '<aside class="sidebar" aria-label="Provider navigation">';
  html += '<div class="sidebar-header">';
  html += `<div><h2>Providers</h2><p>${keys.length} configured</p></div>`;
  html += '<button class="btn-add" id="btn-add-provider" type="button">New</button>';
  html += "</div>";
  if (keys.length === 0) {
    html += '<div class="sidebar-empty"><strong>No providers yet</strong><span>Create one to start adding models.</span></div>';
  } else {
    html += '<ul class="provider-list" role="listbox" aria-label="Providers">';
    for (const key of keys) {
      const sel = key === state.selectedProvider ? ' aria-selected="true" class="selected"' : "";
      const modelCount = Array.isArray(providers[key]?.models) ? providers[key].models.length : 0;
      html += `<li role="option"${sel} data-provider="${escAttr(key)}" tabindex="0">`;
      html += `<span class="provider-name">${esc(key)}</span>`;
      html += `<span class="provider-meta">${modelCount} model${modelCount !== 1 ? "s" : ""}</span>`;
      html += "</li>";
    }
    html += "</ul>";
  }
  html += "</aside>";
  return html;
}
function fieldError(state, field) {
  return state.errors.find((e) => e.field === field || e.path?.endsWith(`/${field}`))?.message;
}
function renderProviderDetail(state, fieldDescs2, slots) {
  if (!state.selectedProvider) {
    return '<main class="detail detail-empty" id="main-content"><div class="empty-state"><h1>Select a provider</h1><p>Choose one from the rail, or create a provider to begin.</p></div></main>';
  }
  const providers = state.draft.providers;
  const config = providers?.[state.selectedProvider];
  if (!config) return '<main class="detail detail-empty" id="main-content"><div class="empty-state"><h1>Provider not found</h1><p>Close and reopen this manager to reload the configuration.</p></div></main>';
  const modelCount = Array.isArray(config.models) ? config.models.length : 0;
  let html = '<main class="detail" id="main-content">';
  html += '<div class="workspace-header">';
  html += '<div><p class="workspace-kicker">Provider</p>';
  html += `<h1 class="provider-key">${esc(state.selectedProvider)}</h1>`;
  html += `<p class="workspace-subtitle">${modelCount} model${modelCount !== 1 ? "s" : ""} configured</p></div>`;
  html += '<div class="detail-actions">';
  html += '<button class="btn-secondary" id="btn-rename" type="button">Rename</button>';
  html += '<button class="btn-danger" id="btn-delete" type="button">Delete</button>';
  html += "</div></div>";
  if (state.errors.length > 0) {
    html += '<div class="errors" role="alert">';
    for (const err of state.errors) {
      const loc = err.field ? ` (${err.field})` : "";
      html += `<div class="error-msg"><strong>Needs attention</strong><span>${esc(err.message)}${esc(loc)}</span></div>`;
    }
    html += "</div>";
  }
  const commonFields = fieldDescs2.filter((f) => f.common);
  const optionalFields = fieldDescs2.filter((f) => !f.common && !f.required);
  const hasKeys = Object.hasOwn;
  html += '<section class="settings-section" aria-labelledby="connection-heading">';
  html += '<div class="section-heading"><div><h2 id="connection-heading">Connection</h2><p>Where Pi sends requests for this provider.</p></div></div>';
  html += '<div class="form-grid">';
  for (const fd of commonFields) html += renderField(fd, config, state.selectedProvider, slots, fieldError(state, fd.key));
  html += "</div></section>";
  html += '<section class="settings-section" aria-labelledby="settings-heading">';
  html += '<div class="section-heading"><div><h2 id="settings-heading">Provider settings</h2><p>Add only the options this provider needs.</p></div></div>';
  const existingOptional = optionalFields.filter((f) => hasKeys(config, f.key));
  if (existingOptional.length > 0) {
    html += '<div class="form-grid">';
    for (const fd of existingOptional) html += renderField(fd, config, state.selectedProvider, slots, fieldError(state, fd.key));
    html += "</div>";
  }
  const missingOptional = optionalFields.filter((f) => !hasKeys(config, f.key));
  if (missingOptional.length > 0) {
    html += '<div class="add-setting"><label for="add-setting-select">Add setting</label><select id="add-setting-select">';
    html += '<option value="">Choose a setting\u2026</option>';
    for (const fd of missingOptional) html += `<option value="${escAttr(fd.key)}">${esc(fd.label)}</option>`;
    html += "</select></div>";
  } else if (existingOptional.length > 0) {
    html += '<p class="settings-complete">All available settings are in use.</p>';
  }
  html += "</section>";
  html += '<div class="workspace-tools" aria-label="Configuration tools"><button class="btn-secondary" id="btn-toggle-raw" type="button">Edit raw JSON</button></div>';
  html += '<div id="models-workspace"></div></main>';
  return html;
}
function renderField(fd, config, _providerKey, slots, errorMsg) {
  const fieldId = `field-${fd.key}`;
  const errorId = `${fieldId}-error`;
  const rawValue = config[fd.key];
  const slot = slots.find((s) => s.path.endsWith(`/${fd.key}`));
  let inputHtml = "";
  switch (fd.kind) {
    case "secret-text": {
      if (isSecretRef2(rawValue) || slot) {
        inputHtml = `<div class="secret-badge" id="${fieldId}" data-secret-field="${escAttr(fd.key)}">configured (unchanged)</div>`;
        inputHtml += `<div class="secret-actions">`;
        inputHtml += `<button type="button" class="btn-replace-secret" data-field="${escAttr(fd.key)}">Replace</button>`;
        inputHtml += `<button type="button" class="btn-remove-secret" data-field="${escAttr(fd.key)}">Remove</button>`;
        inputHtml += `</div>`;
        inputHtml += `<div class="hint">The current value stays private. Replace enters a new value; Remove deletes it.</div>`;
      } else {
        const val = typeof rawValue === "string" ? rawValue : "";
        inputHtml = `<input type="password" id="${fieldId}" value="${escAttr(val)}" autocomplete="off" aria-describedby="${errorId}">`;
      }
      break;
    }
    case "boolean": {
      const checked = rawValue === true;
      inputHtml = `<label class="checkbox-label"><input type="checkbox" id="${fieldId}"${checked ? " checked" : ""}> Enabled</label>`;
      break;
    }
    case "json": {
      const jsonVal = rawValue !== void 0 && rawValue !== null ? JSON.stringify(rawValue, null, 2) : "";
      inputHtml = `<textarea id="${fieldId}" rows="3" autocomplete="off" aria-describedby="${errorId}" data-json-field="${escAttr(fd.key)}">${esc(jsonVal)}</textarea>`;
      inputHtml += `<div class="hint">Opaque secret refs (pi-vendor-secret:\u2026) mean configured unchanged. Moving fails; deleting removes the secret.</div>`;
      break;
    }
    case "text":
    default: {
      if (fd.key === "api") {
        const val = typeof rawValue === "string" ? rawValue : "";
        inputHtml = `<input type="text" id="${fieldId}" value="${escAttr(val)}" list="api-formats" autocomplete="off" aria-describedby="${errorId}">`;
        inputHtml += '<datalist id="api-formats">';
        for (const fmt of API_FORMATS) {
          inputHtml += `<option value="${escAttr(fmt)}">`;
        }
        inputHtml += "</datalist>";
      } else {
        const val = typeof rawValue === "string" ? rawValue : "";
        inputHtml = `<input type="text" id="${fieldId}" value="${escAttr(val)}" autocomplete="off" aria-describedby="${errorId}">`;
      }
      break;
    }
  }
  const removeBtn = fd.common || fd.required ? "" : ` <button class="btn-remove-field" data-field="${escAttr(fd.key)}" title="Remove ${escAttr(fd.label)}">\xD7</button>`;
  const errHtml = errorMsg ? `<div id="${errorId}" class="field-error" role="alert">${esc(errorMsg)}</div>` : `<div id="${errorId}" class="field-error" role="alert"></div>`;
  return `<div class="field">
		<label for="${fieldId}">${esc(fd.label)}</label>
		${inputHtml}
		${removeBtn}
		${errHtml}
	</div>`;
}
function showConfirmDialog(title, message, confirmLabel) {
  return new Promise((resolve) => {
    const existing = document.getElementById("confirm-dialog");
    if (existing) existing.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "confirm-dialog";
    dialog.innerHTML = `
			<form method="dialog">
				<h3>${esc(title)}</h3>
				<p>${esc(message)}</p>
				<div class="dialog-actions">
					<button type="submit" class="btn-cancel" value="cancel" autofocus>Cancel</button>
					<button type="submit" class="btn-save" value="confirm">${esc(confirmLabel)}</button>
				</div>
			</form>
		`;
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => {
      const val = dialog.returnValue;
      dialog.remove();
      resolve(val === "confirm");
    });
    dialog.showModal();
    const cancelBtn = dialog.querySelector('button[value="cancel"]');
    cancelBtn?.focus();
  });
}
function showPromptDialog(title, label, defaultValue) {
  return new Promise((resolve) => {
    const existing = document.getElementById("prompt-dialog");
    if (existing) existing.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "prompt-dialog";
    dialog.innerHTML = `
			<form method="dialog">
				<h3>${esc(title)}</h3>
				<label for="prompt-input">${esc(label)}</label>
				<input type="text" id="prompt-input" value="${escAttr(defaultValue)}" autocomplete="off">
				<div class="dialog-actions">
					<button type="submit" class="btn-cancel" value="cancel">Cancel</button>
					<button type="submit" class="btn-save" value="confirm">OK</button>
				</div>
			</form>
		`;
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => {
      const val = dialog.returnValue;
      const input2 = dialog.querySelector("#prompt-input");
      dialog.remove();
      resolve(val === "confirm" ? input2?.value ?? null : null);
    });
    dialog.showModal();
    const input = dialog.querySelector("#prompt-input");
    input?.focus();
    input?.select();
  });
}
function renderApp(state, fieldDescs2, callbacks) {
  const root2 = $id("app");
  if (!root2) return;
  if (state.errors.length > 0 && state.errors[0]?.message?.includes("close and reopen")) {
    root2.innerHTML = `<div class="status status-error">${esc(state.errors[0].message)}</div>
			<div class="actions"><button class="btn-cancel" id="btn-cancel">Close</button></div>`;
    listen("btn-cancel", "click", () => callbacks.onCancel());
    return;
  }
  const sidebar = renderProviderSidebar(state);
  const detail = renderProviderDetail(state, fieldDescs2, state.secretSlots);
  const draftState = state.dirty ? '<span class="command-status is-dirty" aria-live="polite">Draft changes</span>' : '<span class="command-status" aria-live="polite">All changes saved</span>';
  root2.innerHTML = `
		<a class="skip-link" href="#main-content">Skip to workspace</a>
		<header class="app-header">
			<div class="brand-lockup"><span class="brand-mark" aria-hidden="true">\u03C0</span><div><strong>Pi Vendor</strong><span>Local configuration</span></div></div>
			${draftState}
			<div class="header-actions">
				<button class="btn-quiet" id="btn-header-cancel" type="button">Cancel</button>
				<button class="btn-secondary" id="btn-header-preview" type="button">Review changes</button>
				<button class="btn-save" id="btn-header-save" type="button">Save &amp; Close</button>
			</div>
		</header>
		<div class="layout">${sidebar}${detail}</div>
	`;
  listen("btn-add-provider", "click", async () => {
    const name = await showPromptDialog("Add Provider", "Provider key", "");
    if (name) callbacks.onCreate(name);
  });
  $id("app")?.querySelectorAll(".provider-list li").forEach((li) => {
    li.addEventListener("click", () => {
      const key = li.getAttribute("data-provider");
      if (key) callbacks.onSelect(key);
    });
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const key = li.getAttribute("data-provider");
        if (key) callbacks.onSelect(key);
      }
    });
  });
  listen("btn-rename", "click", async () => {
    const newName = await showPromptDialog("Rename Provider", "New key", state.selectedProvider ?? "");
    if (!newName || !state.selectedProvider || newName === state.selectedProvider) return;
    callbacks.onRename(state.selectedProvider, newName, "reject");
  });
  listen("btn-delete", "click", async () => {
    if (!state.selectedProvider) return;
    const providers = state.draft.providers ?? {};
    const config = providers[state.selectedProvider];
    const modelCount = Array.isArray(config?.models) ? config.models.length : 0;
    const secrets = countSecretsForProvider(state.secretSlots, state.selectedProvider);
    let msg = `Delete provider "${state.selectedProvider}"?`;
    if (modelCount > 0) msg += `
${modelCount} model(s) will be deleted.`;
    if (secrets.total > 0) {
      const parts = [];
      if (secrets.apiKey) parts.push(`${secrets.apiKey} apiKey`);
      if (secrets.header) parts.push(`${secrets.header} header`);
      if (secrets.other) parts.push(`${secrets.other} other`);
      msg += `
${secrets.total} secret(s) will be removed (${parts.join(", ")}).`;
    }
    const confirmed = await showConfirmDialog("Delete Provider", msg, "Delete");
    if (confirmed) callbacks.onDelete(state.selectedProvider);
  });
  listen("btn-header-save", "click", () => callbacks.onSave());
  listen("btn-header-cancel", "click", () => callbacks.onCancel());
  listen("btn-toggle-raw", "click", () => callbacks.onToggleRaw());
  listen("btn-header-preview", "click", () => callbacks.onPreview());
  for (const fd of fieldDescs2) {
    const el = $id(`field-${fd.key}`);
    if (!el) continue;
    if (fd.kind === "secret-text" && el.classList.contains("secret-badge")) {
      continue;
    }
    if (fd.kind === "boolean") {
      el.addEventListener("change", () => {
        if (!state.selectedProvider) return;
        callbacks.onSetField(state.selectedProvider, fd.key, el.checked);
      });
    } else if (fd.kind === "json") {
      el.addEventListener("input", () => {
        if (!state.selectedProvider) return;
        lastFocusedFieldId = fieldIdOf(fd.key);
        const text = el.value;
        if (text.trim() === "") {
          callbacks.onRemoveField(state.selectedProvider, fd.key);
          return;
        }
        try {
          const parsed = JSON.parse(text);
          callbacks.onSetField(state.selectedProvider, fd.key, parsed);
          const err = $id(`field-${fd.key}-error`);
          if (err) err.textContent = "";
        } catch {
          const err = $id(`field-${fd.key}-error`);
          if (err) err.textContent = "Invalid JSON";
        }
      });
      el.addEventListener("focus", () => {
        lastFocusedFieldId = fieldIdOf(fd.key);
      });
    } else {
      el.addEventListener("input", () => {
        if (!state.selectedProvider) return;
        lastFocusedFieldId = fieldIdOf(fd.key);
        const value = el.value;
        if (value === "" && fd.common) {
          callbacks.onRemoveField(state.selectedProvider, fd.key);
          return;
        }
        callbacks.onSetField(state.selectedProvider, fd.key, value);
      });
      el.addEventListener("focus", () => {
        lastFocusedFieldId = fieldIdOf(fd.key);
      });
    }
  }
  $id("app")?.querySelectorAll(".btn-replace-secret").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!state.selectedProvider) return;
      const field = btn.getAttribute("data-field");
      if (!field) return;
      const value = await showPromptDialog("Replace secret", "New value (will not be revealed later)", "");
      if (value === null) return;
      callbacks.onReplaceSecret(state.selectedProvider, field, value);
    });
  });
  $id("app")?.querySelectorAll(".btn-remove-secret").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!state.selectedProvider) return;
      const field = btn.getAttribute("data-field");
      if (!field) return;
      const confirmed = await showConfirmDialog(
        "Remove secret",
        "Remove this configured secret? The original value will not be recoverable from this page.",
        "Remove"
      );
      if (confirmed) callbacks.onRemoveSecret(state.selectedProvider, field);
    });
  });
  $id("app")?.querySelectorAll(".btn-remove-field").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.selectedProvider) return;
      const field = btn.getAttribute("data-field");
      if (field) callbacks.onRemoveField(state.selectedProvider, field);
    });
  });
  listen("add-setting-select", "change", () => {
    const sel = $id("add-setting-select");
    if (!sel || !sel.value || !state.selectedProvider) return;
    callbacks.onAddSetting(state.selectedProvider, sel.value);
    sel.value = "";
  });
  if (lastFocusedFieldId) {
    const restore = $id(lastFocusedFieldId);
    if (restore && "focus" in restore) {
      const pos = typeof restore.selectionStart === "number" ? restore.selectionStart : null;
      restore.focus();
      if (pos !== null && "setSelectionRange" in restore) {
        try {
          restore.setSelectionRange(pos, pos);
        } catch {
        }
      }
    }
  }
}
function fieldIdOf(key) {
  return `field-${key}`;
}

// src/web/client/raw-view.ts
function renderRawView(state) {
  const rawText = state.rawText ?? JSON.stringify(state.draft, null, 2);
  const secretCount = state.secretSlots.length;
  const rawError = state.errors.find((e) => e.field === "raw")?.message;
  let html = '<main class="standalone-view raw-editor" id="main-content">';
  html += '<div class="standalone-header raw-header"><div>';
  html += '<p class="workspace-kicker">Advanced</p><h1>Raw JSON</h1>';
  html += "<p>Edit the complete configuration. Apply validates the draft before returning to the workspace.</p></div>";
  html += '<div class="raw-actions">';
  html += '<button class="btn-quiet" id="btn-discard-raw" type="button">Back to configuration</button>';
  html += '<button class="btn-save" id="btn-apply-raw" type="button">Apply JSON</button>';
  html += "</div></div>";
  if (secretCount > 0) {
    html += `<div class="raw-secret-hint"><strong>${secretCount} configured secret${secretCount === 1 ? "" : "s"}</strong><span>Keep their references in the same place. Moving or copying one cannot be saved.</span></div>`;
  }
  html += `<textarea id="raw-textarea" rows="20" autocomplete="off" spellcheck="false" aria-label="Raw configuration JSON">${esc(rawText)}</textarea>`;
  html += `<div id="raw-error" class="field-error" role="alert">${rawError ? esc(rawError) : ""}</div>`;
  html += "</main>";
  return html;
}
function bindRawView(handlers) {
  const textarea = document.getElementById("raw-textarea");
  textarea?.addEventListener("input", () => {
    if (textarea) handlers.onSetText(textarea.value);
  });
  document.getElementById("btn-apply-raw")?.addEventListener("click", () => {
    if (textarea) handlers.onApply(textarea.value);
  });
  document.getElementById("btn-discard-raw")?.addEventListener("click", () => handlers.onDiscard());
}

// src/web/client/preview.ts
function computeProviderChangeSummary(baseline, current) {
  const baseKeys = new Set(Object.keys(baseline));
  const currKeys = new Set(Object.keys(current));
  const added = [...currKeys].filter((k) => !baseKeys.has(k)).sort();
  const removed = [...baseKeys].filter((k) => !currKeys.has(k)).sort();
  const changed = [];
  const renamed = [];
  const common = [...baseKeys].filter((k) => currKeys.has(k));
  for (const key of common) {
    const baseVal = JSON.stringify(baseline[key]);
    const currVal = JSON.stringify(current[key]);
    if (baseVal !== currVal) {
      changed.push(key);
    }
  }
  changed.sort();
  return { added, removed, renamed, changed };
}
function sanitizeForPreview(obj) {
  if (typeof obj === "string" && obj.startsWith("pi-vendor-secret:")) {
    return "[configured secret]";
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForPreview);
  }
  if (obj && typeof obj === "object") {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeForPreview(value);
    }
    return result;
  }
  return obj;
}
function renderPreview(state) {
  const baselineProviders = state.baseline.providers ?? {};
  const draftProviders = state.draft.providers ?? {};
  const summary = computeProviderChangeSummary(baselineProviders, draftProviders);
  const sanitizedBaseline = sanitizeForPreview(state.baseline);
  const sanitizedDraft = sanitizeForPreview(state.draft);
  let html = '<main class="standalone-view preview" id="main-content">';
  html += '<div class="standalone-header"><div>';
  html += '<p class="workspace-kicker">Review</p><h1>Changes before saving</h1>';
  html += "<p>Secrets remain hidden. This is the exact draft Pi will validate when you save.</p></div></div>";
  html += '<section class="preview-summary" aria-label="Change summary">';
  if (summary.added.length > 0) html += `<div class="preview-change preview-added"><strong>Added</strong><span>${summary.added.map((k) => esc(k)).join(", ")}</span></div>`;
  if (summary.removed.length > 0) html += `<div class="preview-change preview-removed"><strong>Deleted</strong><span>${summary.removed.map((k) => esc(k)).join(", ")}</span></div>`;
  if (summary.changed.length > 0) html += `<div class="preview-change preview-changed"><strong>Changed</strong><span>${summary.changed.map((k) => esc(k)).join(", ")}</span></div>`;
  if (summary.added.length === 0 && summary.removed.length === 0 && summary.changed.length === 0) {
    html += '<div class="preview-change preview-none"><strong>No draft changes</strong><span>Return to configuration to make an edit.</span></div>';
  }
  html += "</section>";
  html += '<section class="preview-columns" aria-label="Configuration comparison">';
  html += '<div class="preview-col"><h2>Saved configuration</h2>';
  html += `<pre>${esc(JSON.stringify(sanitizedBaseline, null, 2))}</pre></div>`;
  html += '<div class="preview-col"><h2>Current draft</h2>';
  html += `<pre>${esc(JSON.stringify(sanitizedDraft, null, 2))}</pre></div>`;
  html += "</section></main>";
  return html;
}

// src/model-source/web-model-dto.ts
var COMPAT_ALLOWED = /* @__PURE__ */ new Set([
  "supportsStore",
  "supportsDeveloperRole",
  "supportsReasoningEffort",
  "supportsUsageInStreaming",
  "maxTokensField",
  "requiresToolResultName",
  "requiresAssistantAfterToolResult",
  "requiresThinkingAsText",
  "requiresReasoningContentOnAssistantMessages",
  "thinkingFormat",
  "chatTemplateKwargs",
  "cacheControlFormat",
  "supportsStrictMode",
  "supportsLongCacheRetention",
  "sendSessionIdHeader",
  "supportsEagerToolInputStreaming",
  "sendSessionAffinityHeaders",
  "supportsCacheControlOnTools",
  "forceAdaptiveThinking",
  "zaiToolStream",
  "supportsTemperature",
  "allowEmptySignature"
]);
var THINKING_LEVELS = /* @__PURE__ */ new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);
var VALID_MAX_TOKENS_FIELDS = /* @__PURE__ */ new Set([
  "max_completion_tokens",
  "max_tokens"
]);
var VALID_THINKING_FORMATS = /* @__PURE__ */ new Set([
  "openai",
  "openrouter",
  "together",
  "deepseek",
  "zai",
  "qwen",
  "chat-template",
  "qwen-chat-template",
  "string-thinking",
  "ant-ling"
]);
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function safeBoolean(v) {
  return typeof v === "boolean" ? v : void 0;
}
function safeNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}
function safeString(v) {
  return typeof v === "string" ? v : void 0;
}
function toWebCostTier(raw) {
  const inputTokensAbove = safeNumber(raw.inputTokensAbove);
  const input = safeNumber(raw.input);
  const output = safeNumber(raw.output);
  const cacheRead = safeNumber(raw.cacheRead);
  const cacheWrite = safeNumber(raw.cacheWrite);
  if (inputTokensAbove == null || input == null || output == null || cacheRead == null || cacheWrite == null) return void 0;
  return { inputTokensAbove, input, output, cacheRead, cacheWrite };
}
function toWebCostTiers(raw) {
  const tiers = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const tier = toWebCostTier(item);
    if (tier) tiers.push(tier);
  }
  return tiers.length > 0 ? tiers : void 0;
}
function toWebCost(raw) {
  const input = safeNumber(raw.input);
  const output = safeNumber(raw.output);
  const cacheRead = safeNumber(raw.cacheRead);
  const cacheWrite = safeNumber(raw.cacheWrite);
  if (input == null || output == null || cacheRead == null || cacheWrite == null) return void 0;
  const cost = { input, output, cacheRead, cacheWrite };
  if (Array.isArray(raw.tiers)) {
    const tiers = toWebCostTiers(raw.tiers);
    if (tiers) cost.tiers = tiers;
  }
  return cost;
}
function isChatTemplateKwarg(v) {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) return true;
  if (!isRecord(v)) return false;
  const keys = Object.keys(v);
  if (keys.length < 1 || keys.length > 2) return false;
  if (v.$var !== "thinking.enabled" && v.$var !== "thinking.effort") return false;
  for (const k of keys) {
    if (k !== "$var" && k !== "omitWhenOff") return false;
    if (k === "omitWhenOff" && typeof v.omitWhenOff !== "boolean") return false;
  }
  return true;
}
function toChatTemplateKwargs(raw) {
  const out = {};
  let hasAny = false;
  for (const [k, v] of Object.entries(raw)) {
    if (isChatTemplateKwarg(v)) {
      out[k] = v;
      hasAny = true;
    }
  }
  return hasAny ? out : void 0;
}
function toWebCompat(raw) {
  const compat = {};
  let hasAny = false;
  for (const [k, v] of Object.entries(raw)) {
    if (!COMPAT_ALLOWED.has(k)) continue;
    switch (k) {
      case "maxTokensField":
        if (typeof v === "string" && VALID_MAX_TOKENS_FIELDS.has(v)) {
          compat.maxTokensField = v;
          hasAny = true;
        }
        break;
      case "thinkingFormat":
        if (typeof v === "string" && VALID_THINKING_FORMATS.has(v)) {
          compat.thinkingFormat = v;
          hasAny = true;
        }
        break;
      case "chatTemplateKwargs": {
        if (!isRecord(v)) break;
        const kwargs = toChatTemplateKwargs(v);
        if (kwargs) {
          compat.chatTemplateKwargs = kwargs;
          hasAny = true;
        }
        break;
      }
      case "cacheControlFormat":
        if (v === "anthropic") {
          compat.cacheControlFormat = v;
          hasAny = true;
        }
        break;
      default: {
        const b = safeBoolean(v);
        if (b !== void 0) {
          compat[k] = b;
          hasAny = true;
        }
        break;
      }
    }
  }
  return hasAny ? compat : void 0;
}
function toThinkingLevelMap(raw) {
  const map = {};
  let hasAny = false;
  for (const [k, v] of Object.entries(raw)) {
    if (!THINKING_LEVELS.has(k)) continue;
    if (v === null || typeof v === "string") {
      map[k] = v;
      hasAny = true;
    }
  }
  return hasAny ? map : void 0;
}
function toWebModelConfig(raw) {
  const id = safeString(raw.id);
  if (!id) return void 0;
  const config = { id };
  const name = safeString(raw.name);
  if (name !== void 0) config.name = name;
  const api2 = safeString(raw.api);
  if (api2 !== void 0) config.api = api2;
  const reasoning = safeBoolean(raw.reasoning);
  if (reasoning !== void 0) config.reasoning = reasoning;
  if (isRecord(raw.thinkingLevelMap)) {
    const tlm = toThinkingLevelMap(raw.thinkingLevelMap);
    if (tlm) config.thinkingLevelMap = tlm;
  }
  if (Array.isArray(raw.input)) {
    const input = [];
    for (const item of raw.input) {
      if (item === "text" || item === "image") input.push(item);
    }
    if (input.length > 0) config.input = input;
  }
  if (isRecord(raw.cost)) {
    const cost = toWebCost(raw.cost);
    if (cost) config.cost = cost;
  }
  const contextWindow = safeNumber(raw.contextWindow);
  if (contextWindow !== void 0) config.contextWindow = contextWindow;
  const maxTokens = safeNumber(raw.maxTokens);
  if (maxTokens !== void 0) config.maxTokens = maxTokens;
  if (isRecord(raw.compat)) {
    const compat = toWebCompat(raw.compat);
    if (compat) config.compat = compat;
  }
  return config;
}

// src/web/client/models/state.ts
function clone2(value) {
  return JSON.parse(JSON.stringify(value));
}
function issue2(message, opts) {
  return { message, ...opts };
}
function ok2(value, warnings) {
  return { ok: true, value, warnings };
}
function fail2(message, opts) {
  return { ok: false, error: issue2(message, opts) };
}
function pointer2(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
function getProviders2(draft) {
  return draft.providers ?? {};
}
function getModels(draft, providerKey3) {
  const config = getProviders2(draft)[providerKey3];
  return Array.isArray(config?.models) ? config.models : [];
}
function pathUnderPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}
function modelSubtreePrefix(providerKey3, index) {
  return `/providers/${pointer2(providerKey3)}/models/${index}`;
}
function compareCodeUnit(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
function closedModelFromUnknown(raw) {
  const closed = toWebModelConfig(raw);
  if (!closed) return void 0;
  return clone2(closed);
}
var OFFICIAL_TEMPLATE_KEYS = [
  "id",
  "name",
  "api",
  "reasoning",
  "thinkingLevelMap",
  "input",
  "cost",
  "contextWindow",
  "maxTokens",
  "compat"
];
function applyOfficialTemplate(current, official) {
  const projected = closedModelFromUnknown(official) ?? { id: String(official.id ?? "") };
  const next = { ...current };
  const headers = current.headers;
  for (const key of OFFICIAL_TEMPLATE_KEYS) {
    const value = projected[key];
    if (value === void 0) delete next[key];
    else next[key] = clone2(value);
  }
  if (headers !== void 0) next.headers = headers;
  else delete next.headers;
  return next;
}
function parseEditorJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return void 0;
  return JSON.parse(trimmed);
}
function buildEditorInputModes(text, image) {
  const modes = [];
  if (text) modes.push("text");
  if (image) modes.push("image");
  return modes.length > 0 ? modes : void 0;
}
function buildEditorCost(values, tiersText = "") {
  const cost = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
    const raw = values[key]?.trim() ?? "";
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${key} cost must be a number`);
    cost[key] = value;
  }
  const tiers = parseEditorJson(tiersText);
  if (tiers !== void 0) {
    if (!Array.isArray(tiers)) throw new Error("Cost tiers must be a JSON array");
    cost.tiers = tiers;
  }
  return Object.keys(cost).length > 0 ? cost : void 0;
}
function findModelIndex(models, id) {
  return models.findIndex((m) => m.id === id);
}
function listModelRows(draft, providerKey3, query, sort) {
  const models = getModels(draft, providerKey3);
  const indexed = models.map((model, index) => ({
    providerKey: providerKey3,
    index,
    previousId: String(model.id ?? ""),
    model
  }));
  const filtered = query ? indexed.filter((row) => {
    const id = row.previousId.toLowerCase();
    const name = String(row.model.name ?? "").toLowerCase();
    const q = query.toLowerCase();
    return id.includes(q) || name.includes(q);
  }) : indexed;
  if (sort === "document") return filtered;
  return [...filtered].sort((a, b) => {
    if (sort === "id") return compareCodeUnit(a.previousId, b.previousId);
    return compareCodeUnit(String(a.model.name ?? ""), String(b.model.name ?? ""));
  });
}
var SECRET_PREFIX3 = "pi-vendor-secret:";
function isSecretRef3(value) {
  return typeof value === "string" && value.startsWith(SECRET_PREFIX3);
}
function collectSecretPaths(draft) {
  const paths = /* @__PURE__ */ new Map();
  function walk(value, path) {
    if (isSecretRef3(value)) {
      const existing = paths.get(value);
      if (existing) existing.push(path);
      else paths.set(value, [path]);
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) walk(value[i], `${path}/${i}`);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        walk(v, `${path}/${k.replaceAll("~", "~0").replaceAll("/", "~1")}`);
      }
    }
  }
  walk(draft, "");
  return paths;
}
function countSecretsUnderPrefixes(slots, prefixes) {
  return slots.filter((s) => prefixes.some((p) => pathUnderPrefix(s.path, p))).length;
}
function previewModelMutation(before, mutation, slots, options) {
  const result = mutation();
  if (!result.ok) {
    return fail2(result.error.message);
  }
  const after = result.value;
  const beforePaths = collectSecretPaths(before);
  const afterPaths = collectSecretPaths(after);
  const slotMap = new Map(slots.map((s) => [s.ref, s]));
  const removedSecrets = [];
  for (const [ref, paths] of beforePaths) {
    const slot = slotMap.get(ref);
    if (!slot) continue;
    const afterPathList = afterPaths.get(ref);
    if (!afterPathList || afterPathList.length === 0) {
      const isAllowed = options.allowedRemovedPrefixes.some((prefix) => pathUnderPrefix(slot.path, prefix));
      if (!isAllowed) {
        return fail2(`Secret reference was removed unexpectedly at ${slot.path}`);
      }
      removedSecrets.push(slot);
      continue;
    }
    if (afterPathList.length > 1) {
      return fail2(`Secret reference appears in multiple locations: ${ref}`);
    }
    const newPath = afterPathList[0];
    if (newPath !== slot.path) {
      return fail2(`Secret reference moved from ${slot.path} to ${newPath}`);
    }
  }
  return ok2({ draft: after, removedSecrets });
}
function dropRemovedSlots(slots, removed) {
  if (removed.length === 0) return slots;
  const refs = new Set(removed.map((s) => s.ref));
  return slots.filter((s) => !refs.has(s.ref));
}
function reduceModelAction(state, action) {
  const next = { ...state, errors: [] };
  switch (action.type) {
    case "model-search":
      return ok2({ ...next, modelQuery: action.query });
    case "model-sort":
      return ok2({ ...next, visualSort: action.sort });
    case "model-open-editor": {
      if (!action.handle) {
        return ok2({
          ...next,
          editor: {
            handle: null,
            value: action.value ? clone2(action.value) : { id: "" },
            issues: []
          }
        });
      }
      const models = getModels(next.draft, action.handle.providerKey);
      const model = models[action.handle.index];
      if (!model || String(model.id ?? "") !== action.handle.previousId) {
        return fail2("Model has changed. Please reopen the editor.");
      }
      return ok2({
        ...next,
        editor: {
          handle: action.handle,
          value: clone2(model),
          issues: []
        }
      });
    }
    case "model-update-editor": {
      if (!next.editor) return fail2("No editor open");
      const value = { ...next.editor.value };
      if (action.value === void 0 || action.value === null || action.value === "") {
        delete value[action.field];
      } else {
        value[action.field] = action.value;
      }
      return ok2({ ...next, editor: { ...next.editor, value } });
    }
    case "model-apply-template": {
      if (!next.editor) return fail2("No editor open");
      const value = applyOfficialTemplate(next.editor.value, action.official);
      return ok2({
        ...next,
        editor: {
          ...next.editor,
          value,
          issues: [],
          fillStatus: action.status ?? "Filled template fields from official source.",
          fillError: false,
          // Keep candidates so users can switch official sources without re-searching.
          fillCandidates: next.editor.fillCandidates
        }
      });
    }
    case "model-set-fill-status": {
      if (!next.editor) return fail2("No editor open");
      return ok2({
        ...next,
        editor: {
          ...next.editor,
          fillStatus: action.status,
          fillError: Boolean(action.error),
          fillCandidates: action.candidates ?? next.editor.fillCandidates
        }
      });
    }
    case "model-close-editor":
      return ok2({ ...next, editor: null });
    case "model-add": {
      const id = String(action.model.id ?? "").trim();
      if (!id) return fail2("Model ID is required");
      const model = { ...clone2(action.model), id };
      const result = previewModelMutation(
        next.draft,
        () => addModel(next.draft, action.providerKey, model),
        next.secretSlots,
        { allowedRemovedPrefixes: [] }
      );
      if (!result.ok) return result;
      return ok2({
        ...next,
        draft: result.value.draft,
        secretSlots: dropRemovedSlots(next.secretSlots, result.value.removedSecrets),
        editor: null,
        dirty: true
      });
    }
    case "model-replace": {
      const previousId = action.previousId.trim();
      const newId = String(action.model.id ?? "").trim();
      if (!previousId || !newId) return fail2("Model ID is required");
      const model = { ...clone2(action.model), id: newId };
      const models = getModels(next.draft, action.providerKey);
      const allowedPrefixes = [];
      if (action.conflict === "overwrite-confirmed") {
        const targetIdx = models.findIndex((m) => m.id === newId);
        const sourceIdx = models.findIndex((m) => m.id === previousId);
        if (targetIdx >= 0 && targetIdx !== sourceIdx) {
          allowedPrefixes.push(modelSubtreePrefix(action.providerKey, targetIdx));
        }
      }
      const result = previewModelMutation(
        next.draft,
        () => replaceModel(next.draft, action.providerKey, previousId, model, {
          conflict: action.conflict
        }),
        next.secretSlots,
        { allowedRemovedPrefixes: allowedPrefixes }
      );
      if (!result.ok) return result;
      return ok2({
        ...next,
        draft: result.value.draft,
        secretSlots: dropRemovedSlots(next.secretSlots, result.value.removedSecrets),
        editor: null,
        dirty: true
      });
    }
    case "model-delete": {
      const id = action.modelId.trim();
      if (!id) return fail2("Model ID is required");
      const models = getModels(next.draft, action.providerKey);
      const idx = models.findIndex((m) => m.id === id);
      if (idx < 0) return fail2("Model not found");
      const allowedPrefixes = [modelSubtreePrefix(action.providerKey, idx)];
      const result = previewModelMutation(
        next.draft,
        () => deleteModel(next.draft, action.providerKey, id),
        next.secretSlots,
        { allowedRemovedPrefixes: allowedPrefixes }
      );
      if (!result.ok) return result;
      return ok2({
        ...next,
        draft: result.value.draft,
        secretSlots: dropRemovedSlots(next.secretSlots, result.value.removedSecrets),
        editor: null,
        dirty: true
      });
    }
    case "import-set-rows":
      return ok2({ ...next, importRows: action.rows });
    case "import-toggle": {
      const rows = next.importRows.map(
        (r) => r.id === action.id ? { ...r, selected: !r.selected } : r
      );
      const selected = rows.filter((r) => r.selected).length;
      if (selected > 100) return fail2("Maximum 100 models per batch");
      return ok2({ ...next, importRows: rows });
    }
    case "import-select-ids": {
      const idSet = new Set(action.ids);
      const rows = next.importRows.map(
        (r) => idSet.has(r.id) ? { ...r, selected: action.selected } : r
      );
      const selected = rows.filter((r) => r.selected).length;
      if (selected > 100) return fail2("Maximum 100 models per batch");
      return ok2({ ...next, importRows: rows });
    }
    case "import-update-row": {
      const rows = next.importRows.map(
        (r) => r.id === action.id ? { ...r, ...action.update } : r
      );
      return ok2({ ...next, importRows: rows });
    }
    case "import-choose-candidate": {
      const closed = closedModelFromUnknown(action.choice.model);
      if (!closed) return fail2("Selected candidate is not a closed model DTO");
      const rows = next.importRows.map(
        (r) => r.id === action.id ? {
          ...r,
          state: "ready",
          choice: action.choice,
          model: closed,
          candidates: void 0,
          error: void 0
        } : r
      );
      return ok2({ ...next, importRows: rows });
    }
    case "import-confirm-default": {
      const row = next.importRows.find((r) => r.id === action.id);
      if (!row || row.state !== "default-warning" || !row.model) {
        return fail2("No default-warning row to confirm");
      }
      const closed = closedModelFromUnknown(row.model);
      if (!closed) return fail2("Default model is not a closed model DTO");
      const rows = next.importRows.map(
        (r) => r.id === action.id ? { ...r, state: "ready", model: closed, error: void 0 } : r
      );
      return ok2({ ...next, importRows: rows });
    }
    case "import-apply": {
      const selected = next.importRows.filter((r) => r.selected && r.state === "ready" && r.model);
      if (selected.length === 0) return fail2("No ready models selected");
      if (selected.length > 100) return fail2("Maximum 100 models per batch");
      let draft = clone2(next.draft);
      let secretSlots = next.secretSlots;
      const skipped = [];
      const errors = [];
      for (const row of selected) {
        const closed = closedModelFromUnknown(row.model);
        if (!closed) {
          errors.push(`${row.id}: not a closed model DTO`);
          continue;
        }
        const id = String(closed.id ?? "").trim();
        if (!id) {
          errors.push(`${row.id}: invalid model id`);
          continue;
        }
        const existingModels = getModels(draft, action.providerKey);
        const exists = existingModels.some((m) => m.id === id);
        if (exists && action.conflict === "skip-existing") {
          skipped.push(id);
          continue;
        }
        const allowedPrefixes = [];
        if (exists) {
          const targetIdx = findModelIndex(existingModels, id);
          if (targetIdx >= 0) allowedPrefixes.push(modelSubtreePrefix(action.providerKey, targetIdx));
        }
        const before = draft;
        const mutation = exists ? () => replaceModel(before, action.providerKey, id, closed, {
          conflict: "overwrite-confirmed"
        }) : () => addModel(before, action.providerKey, closed);
        const refResult = previewModelMutation(before, mutation, secretSlots, {
          allowedRemovedPrefixes: allowedPrefixes
        });
        if (!refResult.ok) {
          errors.push(`${id}: ${refResult.error.message}`);
          continue;
        }
        draft = refResult.value.draft;
        secretSlots = dropRemovedSlots(secretSlots, refResult.value.removedSecrets);
      }
      const warnings = [];
      if (skipped.length > 0) {
        warnings.push(issue2(`${skipped.length} existing model(s) skipped`));
      }
      if (errors.length > 0) {
        warnings.push(issue2(`${errors.length} model(s) failed: ${errors.join("; ")}`));
      }
      return ok2(
        {
          ...next,
          draft,
          secretSlots,
          importRows: [],
          dirty: true
        },
        warnings
      );
    }
    default:
      return fail2("Unknown model action");
  }
}
function createModelApiClient(token) {
  const h = { Authorization: `Bearer ${token}` };
  return {
    async fetchCatalog(query, limit, signal) {
      const res = await fetch(`/api/catalog?q=${encodeURIComponent(query)}&limit=${limit}`, {
        headers: h,
        signal
      });
      if (!res.ok) throw new Error("Catalog unavailable");
      const data = await res.json();
      return data.entries;
    },
    async fetchEnrich(modelId2, signal) {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: modelId2 }),
        signal
      });
      if (!res.ok) throw new Error("Enrichment failed");
      return res.json();
    },
    async fetchDiscover(providerKey3, provider, signal) {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey: providerKey3, provider }),
        signal
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: "Discovery failed" } }));
        throw new Error(
          body.error?.message ?? "Discovery failed"
        );
      }
      return res.json();
    }
  };
}
var ENRICH_CONCURRENCY = 8;
async function enrichSelectedRows(rows, api2, signal, onProgress) {
  const results = rows.map((r) => ({ ...r }));
  const selectedIdx = results.map((r, i) => r.state === "selected-unenriched" ? i : -1).filter((i) => i >= 0);
  async function enrichOne(row) {
    if (signal?.aborted) return row;
    try {
      const result = await api2.fetchEnrich(row.id, signal);
      if (signal?.aborted && result) {
      }
      if (result.kind === "ready") {
        const model = result.model ? closedModelFromUnknown(result.model) : void 0;
        if (!model) {
          return { ...row, state: "failed", error: "Enrichment returned non-closed model" };
        }
        const state = result.warning ? "default-warning" : "ready";
        return {
          ...row,
          state,
          model,
          choice: { provider: "", modelId: row.id, model },
          error: void 0
        };
      }
      return {
        ...row,
        state: "ambiguous",
        candidates: result.candidates ?? [],
        choice: void 0,
        model: void 0,
        error: void 0
      };
    } catch (err) {
      if (signal?.aborted) return row;
      return {
        ...row,
        state: "failed",
        error: err instanceof Error ? err.message : "Enrichment failed"
      };
    }
  }
  let cursor = 0;
  async function worker() {
    while (cursor < selectedIdx.length) {
      if (signal?.aborted) return;
      const my = cursor++;
      const idx = selectedIdx[my];
      const updated = await enrichOne(results[idx]);
      results[idx] = updated;
      onProgress?.(updated);
    }
  }
  const workers = Array.from(
    { length: Math.min(ENRICH_CONCURRENCY, selectedIdx.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}
function importRowsFromIds(ids) {
  const seen = /* @__PURE__ */ new Set();
  const rows = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, selected: false, state: "selected-unenriched" });
  }
  return rows;
}
function countImportReplaceTargets(draft, providerKey3, rows, slots) {
  const models = getModels(draft, providerKey3);
  const prefixes = [];
  for (const row of rows) {
    if (!row.selected || row.state !== "ready" || !row.model) continue;
    const id = String(row.model.id ?? row.id).trim();
    if (!id) continue;
    const idx = findModelIndex(models, id);
    if (idx < 0) continue;
    prefixes.push(modelSubtreePrefix(providerKey3, idx));
  }
  return {
    modelCount: prefixes.length,
    secretCount: countSecretsUnderPrefixes(slots, prefixes)
  };
}

// src/web/client/models/model-view.ts
function escAttr2(text) {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function $id2(id) {
  return document.getElementById(id);
}
function listen2(id, event, fn) {
  $id2(id)?.addEventListener(event, fn);
}
var lastEditorFocus = null;
var editorSearchTimer;
var editorSearchSeq = 0;
function scheduleLiveCatalogSearch(rawQuery, callbacks, modelApi2) {
  if (editorSearchTimer) clearTimeout(editorSearchTimer);
  editorSearchSeq++;
  const query = rawQuery.trim();
  if (query.length < 2) {
    callbacks.onSetFillStatus("", { candidates: [] });
    return;
  }
  editorSearchTimer = setTimeout(() => {
    void runOfficialFill(query, callbacks, modelApi2);
  }, 250);
}
async function runOfficialFill(query, callbacks, modelApi2, applyWithConfirm) {
  const seq = ++editorSearchSeq;
  const q = query.trim();
  if (!q) {
    callbacks.onSetFillStatus("Enter a model id first", { error: true, candidates: [] });
    return;
  }
  callbacks.onSetFillStatus("Searching official catalog\u2026", { candidates: [] });
  try {
    const entries = await modelApi2.fetchCatalog(q, 25);
    if (seq !== editorSearchSeq) return;
    if (entries.length > 0) {
      const candidates = entries.map((e) => ({
        provider: e.provider,
        modelId: e.modelId,
        model: e.model
      }));
      callbacks.onSetFillStatus(
        entries.length === 1 ? "One catalog match \u2014 select to fill (required even for a single hit)." : `${entries.length} catalog matches \u2014 select one.`,
        { candidates }
      );
      return;
    }
    if (!applyWithConfirm) {
      callbacks.onSetFillStatus("No catalog matches", { candidates: [] });
      return;
    }
    callbacks.onSetFillStatus("No catalog hits \u2014 enriching\u2026", { candidates: [] });
    const result = await modelApi2.fetchEnrich(q);
    if (result.kind === "ready" && result.model) {
      await applyWithConfirm(result.model, result.warning);
      return;
    }
    if (result.kind === "official-candidates" && result.candidates?.length) {
      const candidates = result.candidates.map((c) => ({
        provider: c.provider,
        modelId: c.modelId,
        model: c.model
      }));
      callbacks.onSetFillStatus("Multiple official candidates \u2014 select one.", { candidates });
      return;
    }
    callbacks.onSetFillStatus("Could not enrich model", { error: true, candidates: [] });
  } catch (err) {
    if (seq !== editorSearchSeq) return;
    const msg = err instanceof Error ? err.message : "Catalog/enrich failed";
    callbacks.onSetFillStatus(msg, { error: true, candidates: [] });
  }
}
function renderModelSection(state, _fieldDescs, _callbacks) {
  if (!state.selectedProvider) return "";
  const rows = listModelRows(state.draft, state.selectedProvider, state.modelQuery, state.visualSort);
  let html = '<section class="model-section" aria-labelledby="models-heading">';
  html += '<div class="section-heading model-section-heading"><div>';
  html += '<h2 id="models-heading">Models</h2>';
  html += `<p>${rows.length} visible model${rows.length !== 1 ? "s" : ""}. Search, edit, or add a configuration.</p>`;
  html += "</div></div>";
  html += '<div class="model-toolbar">';
  html += `<input type="search" id="model-search" placeholder="Filter configured models" value="${escAttr2(state.modelQuery)}" autocomplete="off" aria-label="Filter configured models">`;
  html += '<select id="model-sort" aria-label="Sort models">';
  html += `<option value="document"${state.visualSort === "document" ? " selected" : ""}>Document order</option>`;
  html += `<option value="id"${state.visualSort === "id" ? " selected" : ""}>Model ID</option>`;
  html += `<option value="name"${state.visualSort === "name" ? " selected" : ""}>Model name</option>`;
  html += '</select><div class="model-actions">';
  html += '<button class="btn-secondary" id="btn-import-models" type="button">Import from /models</button>';
  html += '<button class="btn-save" id="btn-add-model" type="button">Add model</button>';
  html += "</div></div>";
  if (rows.length === 0) {
    html += '<div class="model-empty">';
    if (state.modelQuery) {
      html += `<strong>No matching models</strong><span>Try a different name or model ID.</span>`;
    } else {
      html += "<strong>No models configured</strong><span>Add a model, find one in the official catalog, or import from this provider.</span>";
    }
    html += "</div>";
  } else {
    html += '<div class="model-table-wrap"><table class="model-table" aria-label="Models">';
    html += '<thead><tr><th>ID</th><th>Name</th><th>API</th><th>Context</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>';
    for (const row of rows) {
      const model = row.model;
      const id = row.previousId;
      const name = String(model.name ?? "");
      const api2 = String(model.api ?? "");
      const ctxWin = model.contextWindow ? String(model.contextWindow) : "\u2014";
      const handle = { providerKey: row.providerKey, index: row.index, previousId: id };
      html += "<tr>";
      html += `<td data-label="ID"><code>${esc(id)}</code></td>`;
      html += `<td data-label="Name">${esc(name || "\u2014")}</td>`;
      html += `<td data-label="API"><span class="api-value">${esc(api2 || "\u2014")}</span></td>`;
      html += `<td data-label="Context" class="numeric-value">${esc(ctxWin)}</td>`;
      html += '<td data-label="Actions" class="model-row-actions">';
      html += `<button class="btn-secondary btn-sm" data-edit="${escAttr2(JSON.stringify(handle))}" aria-label="Edit ${escAttr2(id)}">Edit</button>`;
      html += `<button class="btn-danger btn-sm" data-delete="${escAttr2(JSON.stringify({ providerKey: state.selectedProvider, modelId: id }))}" aria-label="Delete ${escAttr2(id)}">Delete</button>`;
      html += "</td></tr>";
    }
    html += "</tbody></table></div>";
  }
  html += "</section>";
  return html;
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function jsonText(value) {
  return value === void 0 ? "" : JSON.stringify(value, null, 2);
}
function numberText(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}
function renderModelEditor(state, _fieldDescs, _callbacks) {
  if (!state.editor) return "";
  const isNew = !state.editor.handle;
  const title = isNew ? "Add Model" : `Edit Model: ${esc(String(state.editor.value.id ?? ""))}`;
  let html = '<dialog id="model-editor"><div class="model-editor">';
  html += '<div class="editor-header"><div>';
  html += `<h2>${title}</h2>`;
  html += `<p>${isNew ? "Start with an ID, then choose an official configuration or enter the details yourself." : "Changes stay in this draft until you save the session."}</p>`;
  html += "</div></div>";
  html += '<div class="editor-layout">';
  html += '<section class="editor-config-pane" aria-label="Model configuration">';
  const editorValue = state.editor.value;
  const idVal = String(editorValue.id ?? "");
  const nameVal = String(editorValue.name ?? "");
  const apiVal = String(editorValue.api ?? "");
  const baseUrlVal = String(editorValue.baseUrl ?? "");
  const reasoning = editorValue.reasoning === true;
  const ctxWin = numberText(editorValue.contextWindow);
  const maxToks = numberText(editorValue.maxTokens);
  const inputModes = Array.isArray(editorValue.input) ? editorValue.input : [];
  const cost = asRecord(editorValue.cost);
  html += '<div class="editor-field-group"><div class="editor-group-heading"><h3>Identity & limits</h3><p>How Pi identifies and calls this model.</p></div>';
  html += '<div class="field editor-fill-row field-span">';
  html += '<label for="editor-id">Model ID</label><div class="editor-fill-controls">';
  html += `<input type="text" id="editor-id" value="${escAttr2(idVal)}" autocomplete="off" placeholder="e.g. claude-fable-5">`;
  html += '<button type="button" class="btn-secondary" id="btn-editor-fill">Find official config</button></div></div>';
  html += '<div class="editor-form-grid">';
  html += `<div class="field"><label for="editor-name">Display name</label><input type="text" id="editor-name" value="${escAttr2(nameVal)}" autocomplete="off"></div>`;
  html += '<div class="field"><label for="editor-api">API</label>';
  html += `<input type="text" id="editor-api" value="${escAttr2(apiVal)}" list="api-formats" autocomplete="off">`;
  html += '<datalist id="api-formats">';
  for (const fmt of ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]) html += `<option value="${escAttr2(fmt)}">`;
  html += "</datalist></div>";
  html += `<div class="field field-span"><label for="editor-baseUrl">Base URL override</label><input type="text" id="editor-baseUrl" value="${escAttr2(baseUrlVal)}" autocomplete="off" placeholder="Use provider base URL"></div>`;
  html += `<div class="field"><label for="editor-contextWindow">Context window</label><input type="text" inputmode="numeric" id="editor-contextWindow" value="${escAttr2(ctxWin)}" autocomplete="off"></div>`;
  html += `<div class="field"><label for="editor-maxTokens">Max output tokens</label><input type="text" inputmode="numeric" id="editor-maxTokens" value="${escAttr2(maxToks)}" autocomplete="off"></div>`;
  html += "</div></div>";
  html += '<div class="editor-field-group"><div class="editor-group-heading"><h3>Capabilities</h3><p>Inputs and reasoning behavior exposed to Pi.</p></div>';
  html += '<div class="capability-row">';
  html += `<label class="checkbox-label"><input type="checkbox" id="editor-reasoning"${reasoning ? " checked" : ""}> Supports reasoning</label>`;
  html += '<fieldset class="input-capabilities"><legend>Input</legend>';
  html += `<label class="checkbox-label"><input type="checkbox" id="editor-input-text"${inputModes.includes("text") ? " checked" : ""}> Text</label>`;
  html += `<label class="checkbox-label"><input type="checkbox" id="editor-input-image"${inputModes.includes("image") ? " checked" : ""}> Image</label></fieldset></div>`;
  html += `<div class="field"><label for="editor-thinkingLevelMap">Thinking level map (JSON)</label><textarea id="editor-thinkingLevelMap" rows="4" autocomplete="off" spellcheck="false" placeholder='{"off": null, "xhigh": "xhigh"}'>${esc(jsonText(editorValue.thinkingLevelMap))}</textarea></div></div>`;
  html += '<div class="editor-field-group"><div class="editor-group-heading"><h3>Cost</h3><p>USD per million tokens. Zero is a valid value.</p></div>';
  html += '<div class="cost-grid">';
  for (const [key, label] of [["input", "Input"], ["output", "Output"], ["cacheRead", "Cache read"], ["cacheWrite", "Cache write"]]) {
    html += `<div class="field"><label for="editor-cost-${key}">${label}</label><input type="text" inputmode="decimal" id="editor-cost-${key}" value="${escAttr2(numberText(cost[key]))}" autocomplete="off"></div>`;
  }
  html += "</div>";
  html += `<div class="field"><label for="editor-cost-tiers">Tier overrides (JSON)</label><textarea id="editor-cost-tiers" rows="3" autocomplete="off" spellcheck="false" placeholder="Optional array of tier overrides">${esc(jsonText(cost.tiers))}</textarea></div></div>`;
  html += '<div class="editor-field-group"><div class="editor-group-heading"><h3>Compatibility & headers</h3><p>Advanced Pi adapter behavior and model-specific headers.</p></div>';
  html += `<div class="field"><label for="editor-compat">Compatibility (JSON)</label><textarea id="editor-compat" rows="4" autocomplete="off" spellcheck="false" placeholder='{"forceAdaptiveThinking": true}'>${esc(jsonText(editorValue.compat))}</textarea></div>`;
  html += `<div class="field"><label for="editor-headers">Headers (JSON)</label><textarea id="editor-headers" rows="4" autocomplete="off" spellcheck="false" placeholder="Optional model-specific headers">${esc(jsonText(editorValue.headers))}</textarea></div></div>`;
  if (state.editor.issues.length > 0) {
    html += '<div class="errors" role="alert">';
    for (const iss of state.editor.issues) html += `<div class="error-msg"><strong>Check this model</strong><span>${esc(iss.message)}</span></div>`;
    html += "</div>";
  }
  html += "</section>";
  const fillStatus = state.editor.fillStatus ?? "";
  const fillErr = state.editor.fillError ? " error-msg" : "";
  const candidates = state.editor.fillCandidates ?? [];
  html += '<aside class="editor-catalog-pane" aria-labelledby="editor-catalog-heading">';
  html += '<div class="editor-catalog-heading"><div><h3 id="editor-catalog-heading">Official configurations</h3>';
  html += "<p>Choose the provider template that matches your endpoint.</p></div>";
  html += `<span class="candidate-count">${candidates.length || "\u2014"}</span></div>`;
  html += `<div id="editor-fill-status" class="editor-fill-status${fillErr}" aria-live="polite">${esc(fillStatus)}</div>`;
  html += '<div id="editor-fill-results" class="editor-fill-results" tabindex="0" aria-label="Official configuration candidates">';
  if (candidates.length === 0) {
    html += '<div class="editor-catalog-empty"><strong>No results yet</strong><span>Enter a model ID to search Pi\u2019s built-in catalog.</span></div>';
  } else {
    for (let i = 0; i < candidates.length; i++) {
      const entry = candidates[i];
      const name = String(entry.model?.name ?? entry.modelId);
      html += '<div class="catalog-entry">';
      html += '<span class="catalog-copy">';
      html += `<strong>${esc(name)}</strong><code>${esc(entry.modelId)}</code>`;
      html += "</span>";
      html += `<span class="catalog-provider">${esc(entry.provider)}</span>`;
      html += `<button type="button" class="btn-secondary btn-sm" data-fill-pick="${i}">Use</button></div>`;
    }
  }
  html += "</div></aside></div>";
  html += '<div class="dialog-actions">';
  html += '<button class="btn-quiet" id="btn-editor-cancel" type="button">Keep editing later</button>';
  html += `<button class="btn-save" id="btn-editor-save" type="button">${isNew ? "Add model" : "Save model"}</button>`;
  html += "</div></div></dialog>";
  return html;
}
function renderCatalogSearch(state) {
  if (!state.catalogAvailable) return "";
  let html = '<details class="catalog-section">';
  html += "<summary><span><strong>Official catalog</strong><small>Start a new model from a Pi template</small></span></summary>";
  html += '<div class="catalog-body"><div class="catalog-search">';
  html += '<input type="search" id="catalog-query" placeholder="Search official models" autocomplete="off" aria-label="Search official models">';
  html += '<button class="btn-secondary" id="btn-catalog-search" type="button">Search</button></div>';
  html += '<div id="catalog-results" class="catalog-results" aria-live="polite"></div></div></details>';
  return html;
}
function renderImportTray(state) {
  if (state.importRows.length === 0) return "";
  const selected = state.importRows.filter((r) => r.selected);
  const ready = selected.filter((r) => r.state === "ready");
  const enriching = state.importRows.filter((r) => r.state === "selected-unenriched").length;
  const allSelected = state.importRows.length > 0 && selected.length === state.importRows.length;
  let html = '<dialog id="import-dialog"><div class="import-dialog">';
  html += '<div class="import-dialog-header"><div><h3 id="import-heading">Import from /models</h3>';
  html += `<p class="import-status" aria-live="polite">${selected.length} selected \xB7 ${ready.length} ready`;
  if (enriching > 0) html += ` \xB7 resolving ${enriching}`;
  html += ` \xB7 ${state.importRows.length} total \xB7 max 100</p></div>`;
  html += '<div class="import-toolbar">';
  html += `<button type="button" class="btn-secondary btn-sm" id="btn-import-select-all">${allSelected ? "Clear all" : "Select all"}</button>`;
  html += "</div></div>";
  html += '<div class="import-table-wrapper" tabindex="0" aria-label="Discovered models"><table class="import-table">';
  html += '<thead><tr><th class="import-check-col"></th><th>Model</th><th>Status</th><th>Details</th></tr></thead><tbody>';
  for (const row of state.importRows) {
    const checked = row.selected ? " checked" : "";
    const rowClass = row.selected ? " is-selected" : "";
    html += `<tr class="import-row${rowClass}" data-import-row="${escAttr2(row.id)}">`;
    html += `<td class="import-check-col"><label class="import-check"><input type="checkbox" data-import-toggle="${escAttr2(row.id)}"${checked} aria-label="Select ${escAttr2(row.id)}"><span></span></label></td>`;
    html += `<td class="import-id-cell"><code>${esc(row.id)}</code></td>`;
    html += `<td class="import-state-cell import-state-${row.state}">${esc(statusLabel(row.state))}</td><td class="import-detail-cell">`;
    if (row.error) html += `<span class="error-msg">${esc(row.error)}</span>`;
    if (row.model?.name) html += `<span class="import-name">${esc(String(row.model.name))}</span>`;
    if (row.choice?.provider) html += ` <span class="import-provider">${esc(row.choice.provider)}</span>`;
    if (row.state === "ambiguous" && row.candidates?.length) {
      html += '<div class="import-candidates">';
      for (let i = 0; i < row.candidates.length; i++) {
        const c = row.candidates[i];
        html += `<button class="btn-secondary btn-sm" data-import-candidate="${escAttr2(JSON.stringify({ id: row.id, index: i }))}">${esc(c.provider)}/${esc(c.modelId)}</button>`;
      }
      html += "</div>";
    }
    if (row.state === "default-warning") html += `<button class="btn-secondary btn-sm" data-import-confirm-default="${escAttr2(row.id)}">Use default</button>`;
    html += "</td></tr>";
  }
  html += '</tbody></table></div><div class="import-actions dialog-actions">';
  html += '<button class="btn-quiet" id="btn-import-cancel" type="button">Cancel</button>';
  html += '<button class="btn-secondary" id="btn-import-apply-replace" type="button">Replace selected</button>';
  html += '<button class="btn-save" id="btn-import-apply-skip" type="button">Add selected</button>';
  html += "</div></div></dialog>";
  return html;
}
function statusLabel(state) {
  switch (state) {
    case "selected-unenriched":
      return "Resolving\u2026";
    case "ready":
      return "Ready";
    case "ambiguous":
      return "Choose source";
    case "default-warning":
      return "Default";
    case "failed":
      return "Failed";
  }
}
function bindModelEvents(state, callbacks, modelApi2) {
  $id2("model-search")?.addEventListener("input", (e) => {
    callbacks.onSearch(e.target.value);
  });
  $id2("model-sort")?.addEventListener("change", (e) => {
    callbacks.onSort(e.target.value);
  });
  $id2("btn-add-model")?.addEventListener("click", () => {
    callbacks.onOpenEditor(null);
  });
  $id2("btn-import-models")?.addEventListener("click", () => {
    if (state.selectedProvider) callbacks.onDiscover(state.selectedProvider);
  });
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const handle = JSON.parse(btn.getAttribute("data-edit"));
      callbacks.onOpenEditor(handle);
    });
  });
  document.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const data = JSON.parse(btn.getAttribute("data-delete"));
      const confirmed = await showConfirmDialog(
        "Delete Model",
        `Delete model "${data.modelId}"?`,
        "Delete"
      );
      if (confirmed) callbacks.onDelete(data.providerKey, data.modelId);
    });
  });
  if (state.editor) {
    const rememberEditorFocus = (el) => {
      const id = el.id;
      if (!id) return;
      const input = el;
      const start = typeof input.selectionStart === "number" ? input.selectionStart : null;
      const end = typeof input.selectionEnd === "number" ? input.selectionEnd : null;
      lastEditorFocus = { id, start, end };
    };
    const bindEditorField = (id, field) => {
      const el = $id2(id);
      if (!el) return;
      el.addEventListener("focus", () => rememberEditorFocus(el));
      el.addEventListener("click", () => rememberEditorFocus(el));
      el.addEventListener("keyup", () => rememberEditorFocus(el));
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        el.addEventListener("change", () => {
          rememberEditorFocus(el);
          callbacks.onUpdateEditor(field, el.checked);
        });
      } else if (el instanceof HTMLTextAreaElement) {
        el.addEventListener("input", () => {
          rememberEditorFocus(el);
          const text = el.value;
          if (text.trim() === "") {
            callbacks.onUpdateEditor(field, void 0);
            return;
          }
          try {
            callbacks.onUpdateEditor(field, JSON.parse(text));
          } catch {
          }
        });
      } else if (field === "contextWindow" || field === "maxTokens") {
        el.addEventListener("input", () => {
          rememberEditorFocus(el);
          const val = el.value;
          callbacks.onUpdateEditor(field, val === "" ? void 0 : Number(val));
        });
      } else {
        el.addEventListener("input", () => {
          rememberEditorFocus(el);
          const val = el.value;
          callbacks.onUpdateEditor(field, val || void 0);
          if (field === "id" && modelApi2) {
            scheduleLiveCatalogSearch(val, callbacks, modelApi2);
          }
        });
      }
    };
    if (lastEditorFocus) {
      const el = $id2(lastEditorFocus.id);
      if (el) {
        el.focus();
        if (lastEditorFocus.start != null && lastEditorFocus.end != null && typeof el.setSelectionRange === "function") {
          try {
            el.setSelectionRange(lastEditorFocus.start, lastEditorFocus.end);
          } catch {
          }
        }
      }
    }
    bindEditorField("editor-id", "id");
    bindEditorField("editor-name", "name");
    bindEditorField("editor-api", "api");
    bindEditorField("editor-baseUrl", "baseUrl");
    bindEditorField("editor-reasoning", "reasoning");
    bindEditorField("editor-contextWindow", "contextWindow");
    bindEditorField("editor-maxTokens", "maxTokens");
    bindEditorField("editor-thinkingLevelMap", "thinkingLevelMap");
    bindEditorField("editor-compat", "compat");
    bindEditorField("editor-headers", "headers");
    const updateInputModes = () => {
      const modes = buildEditorInputModes(
        $id2("editor-input-text")?.checked === true,
        $id2("editor-input-image")?.checked === true
      );
      callbacks.onUpdateEditor("input", modes);
    };
    for (const id of ["editor-input-text", "editor-input-image"]) {
      const el = $id2(id);
      el?.addEventListener("change", () => {
        rememberEditorFocus(el);
        updateInputModes();
      });
    }
    const updateCost = () => {
      try {
        const values = {};
        for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
          values[key] = $id2(`editor-cost-${key}`)?.value ?? "";
        }
        const tiersText = $id2("editor-cost-tiers")?.value ?? "";
        callbacks.onUpdateEditor("cost", buildEditorCost(values, tiersText));
      } catch {
      }
    };
    for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
      const el = $id2(`editor-cost-${key}`);
      el?.addEventListener("input", () => {
        rememberEditorFocus(el);
        updateCost();
      });
    }
    const tiers = $id2("editor-cost-tiers");
    tiers?.addEventListener("input", () => {
      rememberEditorFocus(tiers);
      updateCost();
    });
    listen2("btn-editor-save", "click", () => {
      if (state.editor?.handle) {
        callbacks.onReplace(state.editor.handle.providerKey, state.editor.handle.previousId, "reject");
      } else {
        callbacks.onAdd(state.selectedProvider ?? "");
      }
    });
    listen2("btn-editor-cancel", "click", () => {
      lastEditorFocus = null;
      if (editorSearchTimer) clearTimeout(editorSearchTimer);
      callbacks.onCloseEditor();
    });
    if (modelApi2) {
      const applyWithConfirm = async (official, warning) => {
        if (state.editor?.handle) {
          const ok3 = await showConfirmDialog(
            "Fill from official",
            "Replace template fields (name, api, context, \u2026) with the official catalog values? Headers and secrets stay unchanged.",
            "Fill"
          );
          if (!ok3) return;
        }
        callbacks.onApplyTemplate(
          official,
          warning ?? "Filled template fields from official source."
        );
      };
      listen2("btn-editor-fill", "click", () => {
        const idInput = $id2("editor-id");
        const query = (idInput?.value ?? String(state.editor?.value.id ?? "")).trim();
        void runOfficialFill(query, callbacks, modelApi2, applyWithConfirm);
      });
      document.querySelectorAll("[data-fill-pick]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.getAttribute("data-fill-pick"));
          const entry = (state.editor?.fillCandidates ?? [])[idx];
          if (!entry) return;
          void applyWithConfirm({ ...entry.model, id: entry.modelId });
        });
      });
    } else {
      listen2("btn-editor-fill", "click", () => {
        callbacks.onSetFillStatus("Catalog API client not ready", { error: true, candidates: [] });
      });
    }
  }
  if (modelApi2 && state.catalogAvailable) {
    listen2("btn-catalog-search", "click", async () => {
      const query = $id2("catalog-query")?.value ?? "";
      if (!query) return;
      const resultsDiv = $id2("catalog-results");
      if (!resultsDiv) return;
      resultsDiv.innerHTML = '<div class="catalog-loading" aria-live="polite">Searching the official catalog\u2026</div>';
      try {
        const entries = await modelApi2.fetchCatalog(query, 50);
        let html = "";
        for (const entry of entries) {
          const name = String(entry.model?.name ?? entry.modelId);
          html += `<div class="catalog-entry" data-catalog="${escAttr2(JSON.stringify(entry))}">`;
          html += `<span class="catalog-id"><code>${esc(entry.modelId)}</code></span>`;
          html += `<span class="catalog-name">${esc(name)}</span>`;
          html += `<span class="catalog-provider">${esc(entry.provider)}</span>`;
          html += '<button class="btn-secondary btn-sm" type="button">Use</button>';
          html += "</div>";
        }
        if (entries.length === 0) html = '<div class="catalog-empty">No official models matched this search. Try another ID.</div>';
        resultsDiv.innerHTML = html;
        resultsDiv.querySelectorAll("[data-catalog]").forEach((div) => {
          const btn = div.querySelector("button");
          btn?.addEventListener("click", () => {
            const entry = JSON.parse(div.getAttribute("data-catalog"));
            const model = { id: entry.modelId };
            for (const [k, v] of Object.entries(entry.model)) {
              if (k === "id") continue;
              model[k] = v;
            }
            model.id = entry.modelId;
            callbacks.onOpenEditor(null, model);
          });
        });
      } catch {
        resultsDiv.innerHTML = '<div class="error-msg"><strong>Catalog unavailable</strong><span>Try again, or enter the model details manually.</span></div>';
      }
    });
  }
  const runDiscover = async () => {
    if (!state.selectedProvider || !modelApi2) return;
    const importBtn = $id2("btn-import-models");
    const originalLabel = importBtn?.textContent ?? "Import from /models";
    if (importBtn) {
      importBtn.textContent = "Checking /models\u2026";
      importBtn.setAttribute("disabled", "");
    }
    try {
      const providers = state.draft.providers;
      const provider = providers[state.selectedProvider] ?? {};
      const result = await modelApi2.fetchDiscover(state.selectedProvider, provider);
      const rows = importRowsFromIds(result.ids);
      callbacks.onImportSetRows(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Discovery failed";
      const importArea = document.querySelector(".model-section");
      if (importArea) {
        importArea.querySelectorAll(".discover-error").forEach((el) => el.remove());
        const errDiv = document.createElement("div");
        errDiv.className = "error-msg discover-error";
        errDiv.innerHTML = `<strong>Could not import models</strong><span>${esc(msg)}</span>`;
        importArea.appendChild(errDiv);
      }
    } finally {
      if (importBtn) {
        importBtn.textContent = originalLabel;
        importBtn.removeAttribute("disabled");
      }
    }
  };
  window.__piVendorRunDiscover = runDiscover;
}

// src/web/client/app.ts
var appState = {
  baseline: {},
  draft: {},
  revision: "missing",
  secretSlots: [],
  selectedProvider: null,
  rawText: null,
  dirty: false,
  errors: [],
  modelQuery: "",
  visualSort: "document",
  editor: null,
  importRows: [],
  catalogAvailable: false
};
var api;
var modelApi;
var fieldDescs = [];
var currentView = "provider";
var appStatus = "loading";
var appError = "";
var root = document.getElementById("app");
function dispatchProvider(action, opts) {
  const result = reduceProviderAction(appState, action);
  if (result.ok) {
    appState = { ...appState, ...result.value };
    if (result.warnings?.length) {
      appState = { ...appState, errors: [...appState.errors, ...result.warnings] };
    }
    if (!opts?.silent) render();
    return true;
  }
  appState = { ...appState, errors: [...appState.errors, result.error] };
  if (!opts?.silent) render();
  return false;
}
function dispatchModel(action, opts) {
  const result = reduceModelAction(appState, action);
  if (result.ok) {
    appState = { ...appState, ...result.value };
    if (result.warnings?.length) {
      appState = { ...appState, errors: [...appState.errors, ...result.warnings] };
    }
    if (!opts?.silent) render();
    return true;
  }
  appState = { ...appState, errors: [...appState.errors, result.error] };
  if (!opts?.silent) render();
  return false;
}
function patchImportDialog() {
  const importTop = document.querySelector(".import-table-wrapper")?.scrollTop ?? 0;
  document.querySelectorAll("#import-dialog").forEach((el) => el.remove());
  const importHtml = renderImportTray(appState);
  if (!importHtml) return;
  document.body.insertAdjacentHTML("beforeend", importHtml);
  const importDialog = document.getElementById("import-dialog");
  if (importDialog && !importDialog.open) importDialog.showModal();
  const nextImport = document.querySelector(".import-table-wrapper");
  if (nextImport) nextImport.scrollTop = importTop;
  if (modelCallbacksRef) bindImportDialogEvents(modelCallbacksRef);
}
var modelCallbacksRef = null;
function bindImportDialogEvents(callbacks) {
  const $id3 = (id) => document.getElementById(id);
  $id3("btn-import-apply-skip")?.addEventListener("click", () => {
    callbacks.onImportApply(appState.selectedProvider ?? "", "skip-existing");
  });
  $id3("btn-import-apply-replace")?.addEventListener("click", async () => {
    const pk = appState.selectedProvider ?? "";
    const { modelCount, secretCount } = countImportReplaceTargets(
      appState.draft,
      pk,
      appState.importRows,
      appState.secretSlots
    );
    const msg = secretCount > 0 ? `Replace ${modelCount} existing model(s)? Removes ${secretCount} known secret(s) under those targets.` : `Replace ${modelCount} existing model(s) with imported versions?`;
    const confirmed = await showConfirmDialog("Replace Models", msg, "Replace");
    if (confirmed) callbacks.onImportApply(pk, "replace-selected");
  });
  $id3("btn-import-cancel")?.addEventListener("click", () => callbacks.onImportClear());
  $id3("btn-import-select-all")?.addEventListener("click", () => callbacks.onImportSelectAll?.());
  document.querySelectorAll("[data-import-toggle]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.getAttribute("data-import-toggle");
      callbacks.onImportToggle(id);
    });
  });
  document.querySelectorAll("[data-import-candidate]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const data = JSON.parse(btn.getAttribute("data-import-candidate"));
      const row = appState.importRows.find((r) => r.id === data.id);
      const choice = row?.candidates?.[data.index];
      if (choice) callbacks.onImportChooseCandidate(data.id, choice);
    });
  });
  document.querySelectorAll("[data-import-confirm-default]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-import-confirm-default");
      callbacks.onImportConfirmDefault(id);
    });
  });
}
var enrichAbort = null;
function abortEnrich() {
  enrichAbort?.abort();
  enrichAbort = null;
}
async function enrichImportIfNeeded() {
  if (!modelApi) return;
  const rows = appState.importRows ?? [];
  const needs = rows.some((r) => r.state === "selected-unenriched");
  if (!needs) return;
  abortEnrich();
  const ac = new AbortController();
  enrichAbort = ac;
  try {
    const updated = await enrichSelectedRows(rows, modelApi, ac.signal, (row) => {
      if (enrichAbort !== ac) return;
      dispatchModel({ type: "import-update-row", id: row.id, update: row }, { silent: true });
      patchImportDialog();
    });
    if (enrichAbort !== ac) return;
    dispatchModel({ type: "import-set-rows", rows: updated }, { silent: true });
    patchImportDialog();
  } catch {
  }
}
function render() {
  if (appStatus === "loading") {
    root.innerHTML = '<div class="status status-loading">Loading configuration\u2026</div>';
    return;
  }
  if (appStatus === "error") {
    root.innerHTML = `<div class="status status-error">${esc2(appError)}</div>
			<div class="actions"><button class="btn-cancel" id="btn-cancel">Cancel</button></div>`;
    bindCancel();
    return;
  }
  if (appStatus === "saved") {
    root.innerHTML = '<div class="status status-saved">Configuration saved. You may close this page.</div>';
    return;
  }
  if (appStatus === "cancelled") {
    root.innerHTML = '<div class="status status-loading">Session cancelled. You may close this page.</div>';
    return;
  }
  if (appStatus === "conflict") {
    root.innerHTML = `<div class="status status-error">${esc2(appError)}</div>
			<div class="actions"><button class="btn-cancel" id="btn-cancel">Close</button></div>`;
    bindCancel();
    return;
  }
  if (appStatus === "saving") {
    root.innerHTML = '<div class="status status-loading">Saving\u2026</div>';
    return;
  }
  switch (currentView) {
    case "raw": {
      root.innerHTML = renderRawView(appState);
      bindRawView({
        onSetText: (text) => {
          const result = reduceProviderAction(appState, { type: "set-raw-text", text });
          if (result.ok) appState = { ...appState, ...result.value };
        },
        onApply: async (text) => {
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            dispatchProvider({ type: "set-raw-text", text });
            dispatchProvider({ type: "apply-raw", text });
            return;
          }
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const check = validateSecretRefLocations(parsed, appState.secretSlots);
            if (check.ok && check.value.removed.length > 0) {
              const confirmed = await showConfirmDialog(
                "Remove secrets",
                formatSecretRemovalMessage(check.value.removed),
                "Remove secrets"
              );
              if (!confirmed) {
                dispatchProvider({ type: "set-raw-text", text });
                return;
              }
              dispatchProvider({ type: "set-raw-text", text });
              if (dispatchProvider({ type: "apply-raw", text, confirmSecretRemoval: true })) {
                currentView = "provider";
                render();
              }
              return;
            }
          }
          dispatchProvider({ type: "set-raw-text", text });
          if (dispatchProvider({ type: "apply-raw", text, confirmSecretRemoval: true })) {
            currentView = "provider";
            render();
          }
        },
        onDiscard: () => {
          const result = reduceProviderAction(appState, { type: "set-raw-text", text: "" });
          if (result.ok) appState = { ...appState, ...result.value, rawText: null };
          currentView = "provider";
          render();
        },
        onStay: () => {
          const ta = document.getElementById("raw-textarea");
          if (ta) {
            const result = reduceProviderAction(appState, { type: "set-raw-text", text: ta.value });
            if (result.ok) appState = { ...appState, ...result.value };
          }
        }
      });
      break;
    }
    case "preview": {
      root.innerHTML = renderPreview(appState);
      const previewDiv = root.querySelector(".preview");
      if (previewDiv) {
        const backBtn = document.createElement("button");
        backBtn.className = "btn-secondary preview-back";
        backBtn.textContent = "Back to configuration";
        backBtn.addEventListener("click", () => {
          currentView = "provider";
          render();
        });
        previewDiv.insertBefore(backBtn, previewDiv.firstChild);
      }
      break;
    }
    case "provider":
    default: {
      const providerCallbacks = {
        onSelect: (key) => dispatchProvider({ type: "select", key }),
        onCreate: (key) => dispatchProvider({ type: "create", key }),
        onRename: async (from, to) => {
          const first = reduceProviderAction(appState, {
            type: "rename",
            from,
            to,
            conflict: "reject"
          });
          if (first.ok) {
            appState = { ...appState, ...first.value };
            render();
            return;
          }
          if (/confirm overwrite/i.test(first.error.message)) {
            const confirmed = await showConfirmDialog(
              "Overwrite provider",
              first.error.message,
              "Overwrite"
            );
            if (!confirmed) {
              appState = { ...appState, errors: [...appState.errors, first.error] };
              render();
              return;
            }
            dispatchProvider({ type: "rename", from, to, conflict: "overwrite-confirmed" });
            return;
          }
          appState = { ...appState, errors: [...appState.errors, first.error] };
          render();
        },
        onDelete: (key) => dispatchProvider({ type: "delete", key }),
        onSetField: (key, field, value) => dispatchProvider({ type: "set-field", key, field, value }, { silent: true }),
        onRemoveField: (key, field) => dispatchProvider({ type: "remove-field", key, field }),
        onAddSetting: (key, field) => {
          const desc = fieldDescs.find((d) => d.key === field);
          let value = "";
          if (desc?.kind === "boolean") value = false;
          else if (desc?.kind === "json") value = {};
          dispatchProvider({ type: "set-field", key, field, value });
        },
        onReplaceSecret: (key, field, value) => {
          dispatchProvider({ type: "set-field", key, field, value }, { silent: true });
          const exactPath = `/providers/${key.replaceAll("~", "~0").replaceAll("/", "~1")}/${field}`;
          appState = {
            ...appState,
            secretSlots: appState.secretSlots.filter((s) => s.path !== exactPath)
          };
          render();
        },
        onRemoveSecret: (key, field) => {
          dispatchProvider({ type: "remove-field", key, field }, { silent: true });
          const exactPath = `/providers/${key.replaceAll("~", "~0").replaceAll("/", "~1")}/${field}`;
          appState = {
            ...appState,
            secretSlots: appState.secretSlots.filter((s) => s.path !== exactPath)
          };
          render();
        },
        onToggleRaw: async () => {
          if (appState.rawText !== null && appState.rawText !== JSON.stringify(appState.draft, null, 2)) {
            currentView = "raw";
            render();
            return;
          }
          dispatchProvider({ type: "set-raw-text", text: JSON.stringify(appState.draft, null, 2) });
          currentView = "raw";
          render();
        },
        onPreview: () => {
          currentView = "preview";
          render();
        },
        onSave: handleSave,
        onCancel: handleCancel,
        onDiscardDirty: () => {
        }
      };
      renderApp(appState, fieldDescs, providerCallbacks);
      const modelWorkspace = root.querySelector("#models-workspace");
      if (modelWorkspace) {
        const modelHtml = renderModelSection(appState, fieldDescs, {});
        modelWorkspace.insertAdjacentHTML("beforeend", modelHtml);
        const modelSection = modelWorkspace.querySelector(".model-section");
        if (modelSection) {
          modelSection.insertAdjacentHTML("beforeend", renderCatalogSearch(appState));
        }
      }
      document.querySelectorAll("#import-dialog").forEach((el) => el.remove());
      const importHtml = renderImportTray(appState);
      if (importHtml) {
        document.body.insertAdjacentHTML("beforeend", importHtml);
        const importDialog = document.getElementById("import-dialog");
        if (importDialog && !importDialog.open) importDialog.showModal();
      }
      document.querySelectorAll("#model-editor").forEach((el) => el.remove());
      const editorHtml = renderModelEditor(appState, fieldDescs, {});
      if (editorHtml) {
        document.body.insertAdjacentHTML("beforeend", editorHtml);
        const dialog = document.getElementById("model-editor");
        if (dialog && !dialog.open) dialog.showModal();
      }
      const modelCallbacks = {
        onOpenEditor: (handle, value) => dispatchModel({ type: "model-open-editor", handle, value }),
        onUpdateEditor: (field, value) => dispatchModel({ type: "model-update-editor", field, value }),
        onApplyTemplate: (official, status) => dispatchModel({ type: "model-apply-template", official, status }),
        onSetFillStatus: (status, opts) => dispatchModel({
          type: "model-set-fill-status",
          status,
          error: opts?.error,
          candidates: opts?.candidates
        }),
        onCloseEditor: () => dispatchModel({ type: "model-close-editor" }),
        onAdd: (pk) => {
          if (!appState.editor) return;
          const model = appState.editor.value;
          const added = dispatchModel({ type: "model-add", providerKey: pk, model });
          if (added) return;
          const err = appState.errors.at(-1)?.message ?? "";
          if (!/exists|overwrite/i.test(err)) return;
          void (async () => {
            const models = getModels(appState.draft, pk);
            const id = String(model.id ?? "").trim();
            const idx = models.findIndex((m) => m.id === id);
            const secrets = idx >= 0 ? countSecretsUnderPrefixes(appState.secretSlots, [
              modelSubtreePrefix(pk, idx)
            ]) : 0;
            const msg = secrets > 0 ? `Model "${id}" exists and has ${secrets} known secret(s). Overwrite?` : `Model "${id}" already exists. Overwrite?`;
            const ok3 = await showConfirmDialog("Overwrite model", msg, "Overwrite");
            if (!ok3 || !appState.editor) return;
            dispatchModel({
              type: "model-replace",
              providerKey: pk,
              previousId: id,
              model: appState.editor.value,
              conflict: "overwrite-confirmed"
            });
          })();
        },
        onReplace: (pk, prevId, conflict) => {
          if (!appState.editor) return;
          const model = appState.editor.value;
          const ok3 = dispatchModel({
            type: "model-replace",
            providerKey: pk,
            previousId: prevId,
            model,
            conflict
          });
          if (ok3 || conflict === "overwrite-confirmed") return;
          const err = appState.errors.at(-1)?.message ?? "";
          if (!/exists|overwrite/i.test(err)) return;
          void (async () => {
            const models = getModels(appState.draft, pk);
            const id = String(model.id ?? "").trim();
            const idx = models.findIndex((m) => m.id === id);
            const secrets = idx >= 0 ? countSecretsUnderPrefixes(appState.secretSlots, [
              modelSubtreePrefix(pk, idx)
            ]) : 0;
            const msg = secrets > 0 ? `Target model has ${secrets} known secret(s). Overwrite?` : `Model id "${id}" already exists. Overwrite?`;
            const confirmed = await showConfirmDialog("Overwrite model", msg, "Overwrite");
            if (!confirmed || !appState.editor) return;
            dispatchModel({
              type: "model-replace",
              providerKey: pk,
              previousId: prevId,
              model: appState.editor.value,
              conflict: "overwrite-confirmed"
            });
          })();
        },
        onDelete: (pk, modelId2) => {
          const models = getModels(appState.draft, pk);
          const idx = models.findIndex((m) => m.id === modelId2);
          const secrets = idx >= 0 ? countSecretsUnderPrefixes(appState.secretSlots, [
            modelSubtreePrefix(pk, idx)
          ]) : 0;
          void (async () => {
            const msg = secrets > 0 ? `Delete model "${modelId2}"? Removes ${secrets} known secret(s).` : `Delete model "${modelId2}"?`;
            const confirmed = await showConfirmDialog("Delete model", msg, "Delete");
            if (!confirmed) return;
            dispatchModel({ type: "model-delete", providerKey: pk, modelId: modelId2 });
          })();
        },
        onSearch: (q) => dispatchModel({ type: "model-search", query: q }),
        onSort: (s) => dispatchModel({ type: "model-sort", sort: s }),
        onDiscover: () => {
          const run = window.__piVendorRunDiscover;
          void run?.();
        },
        onImportApply: (pk, conflict) => {
          if (!dispatchModel({ type: "import-apply", providerKey: pk, conflict }, { silent: true })) return;
          render();
        },
        onImportSetRows: (rows) => {
          if (!dispatchModel({ type: "import-set-rows", rows }, { silent: true })) return;
          patchImportDialog();
          void enrichImportIfNeeded();
        },
        onImportToggle: (id) => {
          if (!dispatchModel({ type: "import-toggle", id }, { silent: true })) return;
          patchImportDialog();
        },
        onImportSelectAll: () => {
          const rows = appState.importRows;
          const allSelected = rows.length > 0 && rows.every((r) => r.selected);
          const ids = rows.map((r) => r.id);
          if (allSelected) {
            if (!dispatchModel({ type: "import-select-ids", ids, selected: false }, { silent: true })) return;
          } else {
            const capped = ids.slice(0, 100);
            if (!dispatchModel({ type: "import-select-ids", ids: capped, selected: true }, { silent: true })) return;
          }
          patchImportDialog();
        },
        onImportClear: () => {
          abortEnrich();
          if (!dispatchModel({ type: "import-set-rows", rows: [] }, { silent: true })) return;
          document.querySelectorAll("#import-dialog").forEach((el) => el.remove());
        },
        onImportChooseCandidate: (id, choice) => {
          if (!dispatchModel({ type: "import-choose-candidate", id, choice }, { silent: true })) return;
          patchImportDialog();
        },
        onImportConfirmDefault: (id) => {
          if (!dispatchModel({ type: "import-confirm-default", id }, { silent: true })) return;
          patchImportDialog();
        }
      };
      modelCallbacksRef = modelCallbacks;
      bindModelEvents(appState, modelCallbacks, modelApi);
      if (document.getElementById("import-dialog")) bindImportDialogEvents(modelCallbacks);
      bindModelEvents(appState, modelCallbacks, modelApi);
      const firstFieldErr = appState.errors.find((e) => e.field && e.field !== "raw");
      if (firstFieldErr?.field) {
        const el = document.getElementById(`field-${firstFieldErr.field}`);
        el?.focus?.();
      }
      break;
    }
  }
}
function esc2(text) {
  const el = document.createElement("span");
  el.textContent = text;
  return el.innerHTML;
}
function bindCancel() {
  document.getElementById("btn-cancel")?.addEventListener("click", handleCancel);
}
async function handleSave() {
  const pre = validateSecretRefLocations(appState.draft, appState.secretSlots);
  if (!pre.ok) {
    appState = { ...appState, errors: [pre.error] };
    render();
    return;
  }
  if (pre.value.removed.length > 0) {
    const confirmed = await showConfirmDialog(
      "Remove secrets",
      formatSecretRemovalMessage(pre.value.removed),
      "Save without secrets"
    );
    if (!confirmed) return;
  }
  appStatus = "saving";
  render();
  try {
    await api.saveConfig(appState.draft, appState.revision);
    appStatus = "saved";
    try {
      sessionStorage.removeItem("pi-vendor-token");
    } catch {
    }
  } catch (err) {
    const code = err.code;
    if (code === "config_changed") {
      appStatus = "conflict";
      appError = err.message;
    } else if (code === "invalid_config") {
      appStatus = "ready";
      const issues = err.issues ?? [];
      const mapped = mapConfigIssues(issues, err.message);
      appState = { ...appState, errors: mapped };
    } else {
      appStatus = "ready";
      const msg = err.message;
      appState = { ...appState, errors: [{ message: msg }] };
    }
  }
  render();
}
async function handleCancel() {
  if (appState.dirty) {
    const confirmed = await showConfirmDialog("Discard Changes", "You have unsaved changes. Discard them?", "Discard");
    if (!confirmed) return;
  }
  abortEnrich();
  await api.cancelSession();
  appStatus = "cancelled";
  render();
}
async function init() {
  let token = sessionStorage.getItem("pi-vendor-token");
  if (!token && window.location.hash.startsWith("#token=")) {
    token = window.location.hash.slice(7);
    sessionStorage.setItem("pi-vendor-token", token);
    history.replaceState(null, "", window.location.pathname);
  }
  if (!token) {
    appStatus = "error";
    appError = "Missing session token. Please reopen from Pi.";
    render();
    return;
  }
  api = createApiClient(token);
  modelApi = createModelApiClient(token);
  try {
    const apiState = await api.fetchState();
    fieldDescs = apiState.providerFields;
    appState.catalogAvailable = apiState.catalogAvailable === true;
    dispatchProvider({ type: "load", apiState });
    appStatus = "ready";
  } catch (err) {
    appStatus = "error";
    appError = err instanceof Error ? err.message : "Failed to load configuration";
  }
  render();
}
init();
//# sourceMappingURL=app.js.map
