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
  let html = '<div class="sidebar">';
  html += '<div class="sidebar-header">';
  html += "<h2>Providers</h2>";
  html += '<button class="btn-add" id="btn-add-provider" title="Add provider">+ Add</button>';
  html += "</div>";
  if (keys.length === 0) {
    html += '<div class="sidebar-empty">No providers configured</div>';
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
  html += "</div>";
  return html;
}
function fieldError(state, field) {
  return state.errors.find((e) => e.field === field || e.path?.endsWith(`/${field}`))?.message;
}
function renderProviderDetail(state, fieldDescs2, slots) {
  if (!state.selectedProvider) {
    return '<div class="detail-empty">Select a provider or add a new one</div>';
  }
  const providers = state.draft.providers;
  const config = providers?.[state.selectedProvider];
  if (!config) return '<div class="detail-empty">Provider not found</div>';
  let html = '<div class="detail">';
  html += '<div class="detail-header">';
  html += `<h2 class="provider-key">${esc(state.selectedProvider)}</h2>`;
  html += '<div class="detail-actions">';
  html += '<button class="btn-rename" id="btn-rename">Rename</button>';
  html += '<button class="btn-delete" id="btn-delete">Delete</button>';
  html += "</div>";
  html += "</div>";
  if (state.errors.length > 0) {
    html += '<div class="errors" role="alert">';
    for (const err of state.errors) {
      const loc = err.field ? ` (${err.field})` : "";
      html += `<div class="error-msg">${esc(err.message)}${esc(loc)}</div>`;
    }
    html += "</div>";
  }
  const commonFields = fieldDescs2.filter((f) => f.common);
  const optionalFields = fieldDescs2.filter((f) => !f.common && !f.required);
  const hasKeys = Object.hasOwn;
  html += '<fieldset class="field-group"><legend>Connection</legend>';
  for (const fd of commonFields) {
    html += renderField(fd, config, state.selectedProvider, slots, fieldError(state, fd.key));
  }
  html += "</fieldset>";
  html += '<fieldset class="field-group"><legend>Optional settings</legend>';
  const existingOptional = optionalFields.filter((f) => hasKeys(config, f.key));
  for (const fd of existingOptional) {
    html += renderField(fd, config, state.selectedProvider, slots, fieldError(state, fd.key));
  }
  const missingOptional = optionalFields.filter((f) => !hasKeys(config, f.key));
  if (missingOptional.length > 0) {
    html += '<div class="add-setting">';
    html += '<select id="add-setting-select" aria-label="Add setting">';
    html += '<option value="">Add setting\u2026</option>';
    for (const fd of missingOptional) {
      html += `<option value="${escAttr(fd.key)}">${esc(fd.label)}</option>`;
    }
    html += "</select>";
    html += "</div>";
  } else if (existingOptional.length > 0) {
    html += '<div class="add-setting"><span class="hint">All settings added</span></div>';
  }
  html += "</fieldset>";
  html += '<div class="raw-toggle">';
  html += '<button class="btn-raw" id="btn-toggle-raw">Raw JSON</button>';
  html += '<button class="btn-raw" id="btn-preview">Preview</button>';
  html += "</div>";
  html += '<div class="detail-footer">';
  html += `<button class="btn-cancel" id="btn-cancel">Cancel</button>`;
  html += `<button class="btn-save" id="btn-save">Save &amp; Close</button>`;
  html += "</div>";
  html += "</div>";
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
        inputHtml += `<div class="hint">Opaque keep-value: original secret never shown. Replace types a new value; Remove deletes the secret.</div>`;
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
  const dirtyLabel = state.dirty ? '<span class="unsaved" aria-live="polite">Unsaved</span>' : "";
  root2.innerHTML = `
		<header class="app-header">
			<strong>Pi Vendor Manager</strong>
			${dirtyLabel}
			<div class="header-actions">
				<button class="btn-raw" id="btn-header-preview">Preview</button>
				<button class="btn-save" id="btn-header-save">Save &amp; Close</button>
			</div>
		</header>
		<div class="layout">
			${sidebar}
			${detail}
		</div>
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
  listen("btn-save", "click", () => callbacks.onSave());
  listen("btn-header-save", "click", () => callbacks.onSave());
  listen("btn-cancel", "click", () => callbacks.onCancel());
  listen("btn-toggle-raw", "click", () => callbacks.onToggleRaw());
  listen("btn-preview", "click", () => callbacks.onPreview());
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
  let html = '<div class="raw-editor">';
  html += '<div class="raw-header">';
  html += "<h3>Raw JSON (whole document)</h3>";
  html += '<div class="raw-actions">';
  html += '<button class="btn-save" id="btn-apply-raw">Apply</button>';
  html += '<button class="btn-cancel" id="btn-discard-raw">Discard</button>';
  html += '<button class="btn-cancel" id="btn-stay-raw">Stay</button>';
  html += "</div>";
  html += "</div>";
  if (secretCount > 0) {
    html += `<div class="raw-secret-hint">This document contains ${secretCount} opaque secret reference(s). Moving or copying them will fail on save. Deleting a ref removes the secret (requires confirmation).</div>`;
  }
  html += `<textarea id="raw-textarea" rows="20" autocomplete="off" spellcheck="false">${esc(rawText)}</textarea>`;
  html += `<div id="raw-error" class="field-error" role="alert">${rawError ? esc(rawError) : ""}</div>`;
  html += "</div>";
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
  document.getElementById("btn-stay-raw")?.addEventListener("click", () => handlers.onStay());
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
  let html = '<div class="preview">';
  html += "<h3>Change Preview</h3>";
  html += '<div class="preview-summary">';
  if (summary.added.length > 0) {
    html += `<div class="preview-change preview-added">+ Added: ${summary.added.map((k) => esc(k)).join(", ")}</div>`;
  }
  if (summary.removed.length > 0) {
    html += `<div class="preview-change preview-removed">- Removed: ${summary.removed.map((k) => esc(k)).join(", ")}</div>`;
  }
  if (summary.changed.length > 0) {
    html += `<div class="preview-change preview-changed">~ Changed: ${summary.changed.map((k) => esc(k)).join(", ")}</div>`;
  }
  if (summary.added.length === 0 && summary.removed.length === 0 && summary.changed.length === 0) {
    html += '<div class="preview-change preview-none">No changes detected</div>';
  }
  html += "</div>";
  const sanitizedBaseline = sanitizeForPreview(state.baseline);
  const sanitizedDraft = sanitizeForPreview(state.draft);
  html += '<div class="preview-columns">';
  html += '<div class="preview-col">';
  html += "<h4>Before</h4>";
  html += `<pre>${esc(JSON.stringify(sanitizedBaseline, null, 2))}</pre>`;
  html += "</div>";
  html += '<div class="preview-col">';
  html += "<h4>After</h4>";
  html += `<pre>${esc(JSON.stringify(sanitizedDraft, null, 2))}</pre>`;
  html += "</div>";
  html += "</div>";
  html += "</div>";
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
          fillCandidates: []
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
  const selectedIdx = results.map((r, i) => r.selected ? i : -1).filter((i) => i >= 0);
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
function renderModelSection(state, _fieldDescs, _callbacks) {
  if (!state.selectedProvider) return "";
  const rows = listModelRows(state.draft, state.selectedProvider, state.modelQuery, state.visualSort);
  let html = '<div class="model-section">';
  html += "<h3>Models</h3>";
  html += '<div class="model-toolbar">';
  html += `<input type="search" id="model-search" placeholder="Search models\u2026" value="${escAttr2(state.modelQuery)}" autocomplete="off">`;
  html += '<select id="model-sort" aria-label="Sort models">';
  html += `<option value="document"${state.visualSort === "document" ? " selected" : ""}>Default order</option>`;
  html += `<option value="id"${state.visualSort === "id" ? " selected" : ""}>By ID</option>`;
  html += `<option value="name"${state.visualSort === "name" ? " selected" : ""}>By name</option>`;
  html += "</select>";
  html += '<div class="model-actions">';
  html += '<button class="btn-save" id="btn-add-model">Add model</button>';
  html += '<button class="btn-raw" id="btn-discover">Import /models</button>';
  html += "</div>";
  html += "</div>";
  if (rows.length === 0) {
    html += '<div class="model-empty">';
    if (state.modelQuery) {
      html += `No models matching "${esc(state.modelQuery)}"`;
    } else {
      html += "No models configured. Add a model, search official catalog, or import from /models.";
    }
    html += "</div>";
  } else {
    html += '<table class="model-table" role="table" aria-label="Models">';
    html += "<thead><tr>";
    html += "<th>ID</th><th>Name</th><th>API</th><th>Context</th><th>Actions</th>";
    html += "</tr></thead><tbody>";
    for (const row of rows) {
      const model = row.model;
      const id = row.previousId;
      const name = String(model.name ?? "");
      const api2 = String(model.api ?? "");
      const ctxWin = model.contextWindow ? String(model.contextWindow) : "";
      const handle = {
        providerKey: row.providerKey,
        index: row.index,
        previousId: id
      };
      html += "<tr>";
      html += `<td><code>${esc(id)}</code></td>`;
      html += `<td>${esc(name)}</td>`;
      html += `<td>${esc(api2)}</td>`;
      html += `<td>${esc(ctxWin)}</td>`;
      html += '<td class="model-row-actions">';
      html += `<button class="btn-rename" data-edit="${escAttr2(JSON.stringify(handle))}" aria-label="Edit ${escAttr2(id)}">Edit</button>`;
      html += `<button class="btn-delete" data-delete="${escAttr2(JSON.stringify({ providerKey: state.selectedProvider, modelId: id }))}" aria-label="Delete ${escAttr2(id)}">Delete</button>`;
      html += "</td>";
      html += "</tr>";
    }
    html += "</tbody></table>";
  }
  html += "</div>";
  return html;
}
function renderModelEditor(state, _fieldDescs, _callbacks) {
  if (!state.editor) return "";
  const isNew = !state.editor.handle;
  const title = isNew ? "Add Model" : `Edit Model: ${esc(String(state.editor.value.id ?? ""))}`;
  let html = '<dialog id="model-editor" open><div class="model-editor">';
  html += `<h3>${title}</h3>`;
  const idVal = String(state.editor.value.id ?? "");
  html += '<div class="field editor-fill-row">';
  html += '<label for="editor-id">ID</label>';
  html += '<div class="editor-fill-controls">';
  html += `<input type="text" id="editor-id" value="${escAttr2(idVal)}" autocomplete="off" placeholder="model id">`;
  html += '<button type="button" class="btn-save btn-sm" id="btn-editor-fill">Fill from official</button>';
  html += "</div>";
  const fillStatus = state.editor.fillStatus ?? "";
  const fillErr = state.editor.fillError ? " error-msg" : "";
  html += `<div id="editor-fill-status" class="editor-fill-status${fillErr}" aria-live="polite">${esc(fillStatus)}</div>`;
  html += '<div id="editor-fill-results" class="editor-fill-results">';
  const candidates = state.editor.fillCandidates ?? [];
  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];
    const name = String(e.model?.name ?? e.modelId);
    html += `<div class="catalog-entry">`;
    html += `<span class="catalog-id"><code>${esc(e.modelId)}</code></span>`;
    html += `<span class="catalog-name">${esc(name)}</span>`;
    html += `<span class="catalog-provider">${esc(e.provider)}</span>`;
    html += `<button type="button" class="btn-save btn-sm" data-fill-pick="${i}">Select</button>`;
    html += "</div>";
  }
  html += "</div>";
  html += "</div>";
  const nameVal = String(state.editor.value.name ?? "");
  html += '<div class="field">';
  html += '<label for="editor-name">Name</label>';
  html += `<input type="text" id="editor-name" value="${escAttr2(nameVal)}" autocomplete="off">`;
  html += "</div>";
  const apiVal = String(state.editor.value.api ?? "");
  html += '<div class="field">';
  html += '<label for="editor-api">API</label>';
  html += `<input type="text" id="editor-api" value="${escAttr2(apiVal)}" list="api-formats" autocomplete="off">`;
  html += '<datalist id="api-formats">';
  for (const fmt of ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]) {
    html += `<option value="${escAttr2(fmt)}">`;
  }
  html += "</datalist>";
  html += "</div>";
  const reasoning = state.editor.value.reasoning === true;
  html += '<div class="field">';
  html += '<label class="checkbox-label">';
  html += `<input type="checkbox" id="editor-reasoning"${reasoning ? " checked" : ""}> Reasoning`;
  html += "</label>";
  html += "</div>";
  const ctxWin = state.editor.value.contextWindow ? String(state.editor.value.contextWindow) : "";
  html += '<div class="field">';
  html += '<label for="editor-contextWindow">Context window</label>';
  html += `<input type="text" id="editor-contextWindow" value="${escAttr2(ctxWin)}" autocomplete="off">`;
  html += "</div>";
  const maxToks = state.editor.value.maxTokens ? String(state.editor.value.maxTokens) : "";
  html += '<div class="field">';
  html += '<label for="editor-maxTokens">Max tokens</label>';
  html += `<input type="text" id="editor-maxTokens" value="${escAttr2(maxToks)}" autocomplete="off">`;
  html += "</div>";
  const headersVal = state.editor.value.headers ? JSON.stringify(state.editor.value.headers, null, 2) : "";
  html += '<div class="field">';
  html += '<label for="editor-headers">Headers (JSON)</label>';
  html += `<textarea id="editor-headers" rows="3" autocomplete="off">${esc(headersVal)}</textarea>`;
  html += "</div>";
  if (state.editor.issues.length > 0) {
    html += '<div class="errors">';
    for (const iss of state.editor.issues) {
      html += `<div class="error-msg">${esc(iss.message)}</div>`;
    }
    html += "</div>";
  }
  html += '<div class="dialog-actions">';
  html += '<button class="btn-cancel" id="btn-editor-cancel">Cancel</button>';
  html += `<button class="btn-save" id="btn-editor-save">${isNew ? "Add" : "Save"}</button>`;
  html += "</div>";
  html += "</div></dialog>";
  return html;
}
function renderCatalogSearch(state) {
  if (!state.catalogAvailable) return "";
  let html = '<div class="catalog-section">';
  html += "<h4>Official Catalog</h4>";
  html += '<div class="catalog-search">';
  html += '<input type="search" id="catalog-query" placeholder="Search official models\u2026" autocomplete="off">';
  html += '<button class="btn-save" id="btn-catalog-search">Search</button>';
  html += "</div>";
  html += '<div id="catalog-results" class="catalog-results"></div>';
  html += "</div>";
  return html;
}
function renderImportTray(state) {
  if (state.importRows.length === 0) return "";
  const selected = state.importRows.filter((r) => r.selected);
  const ready = selected.filter((r) => r.state === "ready");
  let html = '<div class="import-tray">';
  html += "<h4>Import /models</h4>";
  html += `<div class="import-status" aria-live="polite">${selected.length} selected, ${ready.length} ready (max 100)</div>`;
  html += '<div class="import-table-wrapper">';
  html += '<table class="import-table">';
  html += "<thead><tr><th></th><th>ID</th><th>Status</th><th>Info</th></tr></thead>";
  html += "<tbody>";
  for (const row of state.importRows) {
    const checked = row.selected ? " checked" : "";
    html += "<tr>";
    html += `<td><input type="checkbox" data-import-toggle="${escAttr2(row.id)}"${checked} aria-label="Select ${escAttr2(row.id)}"></td>`;
    html += `<td><code>${esc(row.id)}</code></td>`;
    html += `<td class="import-state-${row.state}">${esc(row.state)}</td>`;
    html += "<td>";
    if (row.error) html += `<span class="error-msg">${esc(row.error)}</span>`;
    if (row.model?.name) html += esc(String(row.model.name));
    if (row.choice?.provider) html += ` (${esc(row.choice.provider)})`;
    if (row.state === "ambiguous" && row.candidates?.length) {
      html += '<div class="import-candidates">';
      for (let i = 0; i < row.candidates.length; i++) {
        const c = row.candidates[i];
        html += `<button class="btn-raw btn-sm" data-import-candidate="${escAttr2(JSON.stringify({ id: row.id, index: i }))}">${esc(c.provider)}/${esc(c.modelId)}</button>`;
      }
      html += "</div>";
    }
    if (row.state === "default-warning") {
      html += `<button class="btn-save btn-sm" data-import-confirm-default="${escAttr2(row.id)}">Confirm default</button>`;
    }
    html += "</td>";
    html += "</tr>";
  }
  html += "</tbody></table>";
  html += "</div>";
  html += '<div class="import-actions">';
  html += '<button class="btn-save" id="btn-import-apply-skip">Apply (skip existing)</button>';
  html += '<button class="btn-raw" id="btn-import-apply-replace">Apply (replace existing)</button>';
  html += '<button class="btn-cancel" id="btn-import-cancel">Cancel</button>';
  html += "</div>";
  html += "</div>";
  return html;
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
    const bindEditorField = (id, field) => {
      const el = $id2(id);
      if (!el) return;
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        el.addEventListener("change", () => callbacks.onUpdateEditor(field, el.checked));
      } else if (el instanceof HTMLTextAreaElement) {
        el.addEventListener("input", () => {
          const val = el.value.trim();
          if (!val) callbacks.onUpdateEditor(field, void 0);
          else {
            try {
              callbacks.onUpdateEditor(field, JSON.parse(val));
            } catch {
            }
          }
        });
      } else {
        el.addEventListener("input", () => {
          const val = el.value;
          callbacks.onUpdateEditor(field, val || void 0);
        });
      }
    };
    bindEditorField("editor-id", "id");
    bindEditorField("editor-name", "name");
    bindEditorField("editor-api", "api");
    bindEditorField("editor-reasoning", "reasoning");
    bindEditorField("editor-contextWindow", "contextWindow");
    bindEditorField("editor-maxTokens", "maxTokens");
    bindEditorField("editor-headers", "headers");
    listen2("btn-editor-save", "click", () => {
      if (state.editor?.handle) {
        callbacks.onReplace(state.editor.handle.providerKey, state.editor.handle.previousId, "reject");
      } else {
        callbacks.onAdd(state.selectedProvider ?? "");
      }
    });
    listen2("btn-editor-cancel", "click", () => callbacks.onCloseEditor());
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
        void (async () => {
          const idInput = $id2("editor-id");
          const query = (idInput?.value ?? String(state.editor?.value.id ?? "")).trim();
          if (!query) {
            callbacks.onSetFillStatus("Enter a model id first", { error: true, candidates: [] });
            return;
          }
          callbacks.onSetFillStatus("Searching official catalog\u2026", { candidates: [] });
          try {
            const entries = await modelApi2.fetchCatalog(query, 25);
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
            callbacks.onSetFillStatus("No catalog hits \u2014 enriching\u2026", { candidates: [] });
            const result = await modelApi2.fetchEnrich(query);
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
            const msg = err instanceof Error ? err.message : "Catalog/enrich failed";
            callbacks.onSetFillStatus(msg, { error: true, candidates: [] });
          }
        })();
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
      resultsDiv.innerHTML = '<div class="status-loading">Searching\u2026</div>';
      try {
        const entries = await modelApi2.fetchCatalog(query, 50);
        let html = "";
        for (const entry of entries) {
          const name = String(entry.model?.name ?? entry.modelId);
          html += `<div class="catalog-entry" data-catalog="${escAttr2(JSON.stringify(entry))}">`;
          html += `<span class="catalog-id"><code>${esc(entry.modelId)}</code></span>`;
          html += `<span class="catalog-name">${esc(name)}</span>`;
          html += `<span class="catalog-provider">${esc(entry.provider)}</span>`;
          html += '<button class="btn-save btn-sm">Select</button>';
          html += "</div>";
        }
        if (entries.length === 0) html = '<div class="catalog-empty">No results</div>';
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
        resultsDiv.innerHTML = '<div class="error-msg">Catalog unavailable</div>';
      }
    });
  }
  listen2("btn-discover", "click", async () => {
    if (!state.selectedProvider || !modelApi2) return;
    const discoverBtn = $id2("btn-discover");
    if (discoverBtn) discoverBtn.textContent = "Discovering\u2026";
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
        const errDiv = document.createElement("div");
        errDiv.className = "error-msg";
        errDiv.textContent = msg;
        importArea.appendChild(errDiv);
      }
    } finally {
      if (discoverBtn) discoverBtn.textContent = "Import /models";
    }
  });
  listen2("btn-import-apply-skip", "click", () => {
    callbacks.onImportApply(state.selectedProvider ?? "", "skip-existing");
  });
  listen2("btn-import-apply-replace", "click", async () => {
    const pk = state.selectedProvider ?? "";
    const { modelCount, secretCount } = countImportReplaceTargets(
      state.draft,
      pk,
      state.importRows,
      state.secretSlots
    );
    const msg = secretCount > 0 ? `Replace ${modelCount} existing model(s)? Removes ${secretCount} known secret(s) under those targets.` : `Replace ${modelCount} existing model(s) with imported versions?`;
    const confirmed = await showConfirmDialog("Replace Models", msg, "Replace");
    if (confirmed) callbacks.onImportApply(pk, "replace-selected");
  });
  listen2("btn-import-cancel", "click", () => {
    callbacks.onImportClear();
  });
  document.querySelectorAll("[data-import-toggle]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.getAttribute("data-import-toggle");
      callbacks.onImportToggle(id);
    });
  });
  document.querySelectorAll("[data-import-candidate]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const data = JSON.parse(btn.getAttribute("data-import-candidate"));
      const row = state.importRows.find((r) => r.id === data.id);
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
var enrichAbort = null;
function abortEnrich() {
  enrichAbort?.abort();
  enrichAbort = null;
}
async function enrichImportIfNeeded() {
  if (!modelApi) return;
  const rows = appState.importRows ?? [];
  const needs = rows.some((r) => r.selected && r.state === "selected-unenriched");
  if (!needs) return;
  abortEnrich();
  const ac = new AbortController();
  enrichAbort = ac;
  try {
    const updated = await enrichSelectedRows(rows, modelApi, ac.signal, (row) => {
      if (enrichAbort !== ac) return;
      dispatchModel({ type: "import-update-row", id: row.id, update: row }, { silent: true });
    });
    if (enrichAbort !== ac) return;
    dispatchModel({ type: "import-set-rows", rows: updated });
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
        backBtn.className = "btn-cancel";
        backBtn.textContent = "Back";
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
      const detail = root.querySelector(".detail");
      if (detail) {
        const modelHtml = renderModelSection(appState, fieldDescs, {});
        detail.insertAdjacentHTML("beforeend", modelHtml);
      }
      const modelSection = root.querySelector(".model-section");
      if (modelSection) {
        const catalogHtml = renderCatalogSearch(appState);
        modelSection.insertAdjacentHTML("beforeend", catalogHtml);
      }
      const modelSection2 = root.querySelector(".model-section");
      if (modelSection2) {
        const importHtml = renderImportTray(appState);
        modelSection2.insertAdjacentHTML("beforeend", importHtml);
      }
      const editorHtml = renderModelEditor(appState, fieldDescs, {});
      if (editorHtml) {
        document.body.insertAdjacentHTML("beforeend", editorHtml);
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
        },
        onImportApply: (pk, conflict) => dispatchModel({ type: "import-apply", providerKey: pk, conflict }),
        onImportSetRows: (rows) => {
          dispatchModel({ type: "import-set-rows", rows });
        },
        onImportToggle: (id) => {
          if (!dispatchModel({ type: "import-toggle", id })) return;
          void enrichImportIfNeeded();
        },
        onImportClear: () => {
          abortEnrich();
          dispatchModel({ type: "import-set-rows", rows: [] });
        },
        onImportChooseCandidate: (id, choice) => dispatchModel({ type: "import-choose-candidate", id, choice }),
        onImportConfirmDefault: (id) => dispatchModel({ type: "import-confirm-default", id })
      };
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
