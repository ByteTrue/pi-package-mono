/**
 * Provider view — semantic DOM rendering for the provider manager.
 * Pure rendering: takes state + callbacks, returns void after DOM manipulation.
 */

import type { ProviderManagerState, ProviderFieldKey, FieldDescriptor, SecretSlot, UiIssue } from "./state.js";
import { countSecretsForProvider } from "./state.js";

// ── Helpers ────────────────────────────────────────────────────────

export function esc(text: string): string {
	const el = document.createElement("span");
	el.textContent = text;
	return el.innerHTML;
}

function escAttr(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function $id(id: string): HTMLElement | null {
	return document.getElementById(id);
}

function listen(id: string, event: string, fn: (e: Event) => void): void {
	$id(id)?.addEventListener(event, fn);
}

// ── Types for callbacks ────────────────────────────────────────────

export type ProviderViewCallbacks = {
	onSelect(key: string): void;
	onCreate(key: string): void;
	onRename(from: string, to: string, conflict: "reject" | "overwrite-confirmed"): void;
	onDelete(key: string): void;
	onSetField(key: string, field: ProviderFieldKey, value: unknown): void;
	onRemoveField(key: string, field: ProviderFieldKey): void;
	onAddSetting(key: string, field: ProviderFieldKey): void;
	onReplaceSecret(key: string, field: ProviderFieldKey, value: string): void;
	onRemoveSecret(key: string, field: ProviderFieldKey): void;
	onToggleRaw(): void;
	onPreview(): void;
	onSave(): void;
	onCancel(): void;
	onDiscardDirty(): void;
};

// ── Constants ──────────────────────────────────────────────────────

const SECRET_PREFIX = "pi-vendor-secret:";

function isSecretRef(value: unknown): value is string {
	return typeof value === "string" && value.startsWith(SECRET_PREFIX);
}

const API_FORMATS = [
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
	"google-generative-ai",
];

// Track last focused control across re-renders (avoid focus-steal on each keystroke).
let lastFocusedFieldId: string | null = null;

// ── Render helpers ─────────────────────────────────────────────────

function renderProviderSidebar(state: ProviderManagerState): string {
	const providers = (state.draft as Record<string, unknown>).providers as Record<string, Record<string, unknown>> | undefined ?? {};
	const keys = Object.keys(providers).sort();

	let html = '<aside class="sidebar" aria-label="Provider navigation">';
	html += '<div class="sidebar-header">';
	html += `<div><h2>Providers</h2><p>${keys.length} configured</p></div>`;
	html += '<button class="btn-add" id="btn-add-provider" type="button">Add provider</button>';
	html += '</div>';

	if (keys.length === 0) {
		html += '<div class="sidebar-empty"><strong>No providers yet</strong><span>Add a provider to start configuring models.</span></div>';
	} else {
		html += '<ul class="provider-list" role="listbox" aria-label="Providers">';
		for (const key of keys) {
			const sel = key === state.selectedProvider ? ' aria-selected="true" class="selected"' : "";
			const modelCount = Array.isArray(providers[key]?.models) ? providers[key]!.models.length : 0;
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

function fieldError(state: ProviderManagerState, field: string): string | undefined {
	return state.errors.find((e) => e.field === field || e.path?.endsWith(`/${field}`))?.message;
}

function renderProviderDetail(
	state: ProviderManagerState,
	fieldDescs: FieldDescriptor[],
	slots: SecretSlot[],
): string {
	if (!state.selectedProvider) {
		return '<main class="detail detail-empty" id="main-content"><div class="empty-state"><h1>Select a provider</h1><p>Choose one to edit it, or add a provider to start.</p></div></main>';
	}

	const providers = (state.draft as Record<string, unknown>).providers as Record<string, Record<string, unknown>>;
	const config = providers?.[state.selectedProvider];
	if (!config) return '<main class="detail detail-empty" id="main-content"><div class="empty-state"><h1>Provider unavailable</h1><p>Close this manager and reopen it to load the latest configuration.</p></div></main>';

	const modelCount = Array.isArray(config.models) ? config.models.length : 0;
	let html = '<main class="detail" id="main-content">';
	html += '<div class="workspace-header">';
	html += '<div><p class="workspace-kicker">Provider</p>';
	html += `<h1 class="provider-key">${esc(state.selectedProvider)}</h1>`;
	html += `<p class="workspace-subtitle">${modelCount} model${modelCount !== 1 ? "s" : ""} configured</p></div>`;
	html += '<div class="detail-actions">';
	html += '<button class="btn-secondary" id="btn-rename" type="button">Rename</button>';
	html += '<button class="btn-danger" id="btn-delete" type="button">Delete provider</button>';
	html += '</div></div>';

	if (state.errors.length > 0) {
		html += '<div class="errors" role="alert">';
		for (const err of state.errors) {
			const loc = err.field ? ` (${err.field})` : "";
			html += `<div class="error-msg"><strong>Needs attention</strong><span>${esc(err.message)}${esc(loc)}</span></div>`;
		}
		html += '</div>';
	}

	const commonFields = fieldDescs.filter((f) => f.common);
	const optionalFields = fieldDescs.filter((f) => !f.common && !f.required);
	const hasKeys = Object.hasOwn as (obj: unknown, key: string) => boolean;

	html += '<section class="settings-section" aria-labelledby="connection-heading">';
	html += '<div class="section-heading"><div><h2 id="connection-heading">Connection</h2><p>Where Pi sends requests for this provider.</p></div></div>';
	html += '<div class="form-grid">';
	for (const fd of commonFields) html += renderField(fd, config, state.selectedProvider, slots, fieldError(state, fd.key));
	html += '</div></section>';

	html += '<section class="settings-section" aria-labelledby="settings-heading">';
	html += '<div class="section-heading"><div><h2 id="settings-heading">Optional settings</h2><p>Add only the options this provider needs.</p></div></div>';
	const existingOptional = optionalFields.filter((f) => hasKeys(config, f.key));
	if (existingOptional.length > 0) {
		html += '<div class="form-grid">';
		for (const fd of existingOptional) html += renderField(fd, config, state.selectedProvider, slots, fieldError(state, fd.key));
		html += '</div>';
	}
	const missingOptional = optionalFields.filter((f) => !hasKeys(config, f.key));
	if (missingOptional.length > 0) {
		html += '<div class="add-setting"><label for="add-setting-select">Add optional setting</label><select id="add-setting-select">';
		html += '<option value="">Choose a setting…</option>';
		for (const fd of missingOptional) html += `<option value="${escAttr(fd.key)}">${esc(fd.label)}</option>`;
		html += '</select></div>';
	} else if (existingOptional.length > 0) {
		html += '<p class="settings-complete">All available settings are in use.</p>';
	}
	html += '</section>';

	html += '<div class="workspace-tools" aria-label="Configuration tools"><button class="btn-secondary" id="btn-toggle-raw" type="button">Edit configuration as JSON</button></div>';
	html += '<div id="models-workspace"></div></main>';
	return html;
}

function renderField(
	fd: FieldDescriptor,
	config: Record<string, unknown>,
	_providerKey: string,
	slots: SecretSlot[],
	errorMsg?: string,
): string {
	const fieldId = `field-${fd.key}`;
	const errorId = `${fieldId}-error`;
	const rawValue = config[fd.key];
	const slot = slots.find((s) => s.path.endsWith(`/${fd.key}`));

	let inputHtml = "";

	switch (fd.kind) {
		case "secret-text": {
			if (isSecretRef(rawValue) || slot) {
				inputHtml = `<div class="secret-badge" id="${fieldId}" data-secret-field="${escAttr(fd.key)}">Configured</div>`;
				inputHtml += `<div class="secret-actions">`;
				inputHtml += `<button type="button" class="btn-replace-secret" data-field="${escAttr(fd.key)}">Replace secret</button>`;
				inputHtml += `<button type="button" class="btn-remove-secret" data-field="${escAttr(fd.key)}">Remove secret</button>`;
				inputHtml += `</div>`;
				inputHtml += `<div class="hint">The saved value stays private. Replacing it stores a new value; removing it deletes it when you save.</div>`;
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
			const jsonVal = rawValue !== undefined && rawValue !== null ? JSON.stringify(rawValue, null, 2) : "";
			inputHtml = `<textarea id="${fieldId}" rows="3" autocomplete="off" aria-describedby="${errorId}" data-json-field="${escAttr(fd.key)}">${esc(jsonVal)}</textarea>`;
			inputHtml += `<div class="hint">Configured secrets stay protected. Keep their entries in place; moving or copying one cannot be saved.</div>`;
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

	const removeBtn = fd.common || fd.required
		? ""
		: ` <button class="btn-remove-field" data-field="${escAttr(fd.key)}" title="Remove ${escAttr(fd.label)}">Remove setting</button>`;

	const errHtml = errorMsg
		? `<div id="${errorId}" class="field-error" role="alert">${esc(errorMsg)}</div>`
		: `<div id="${errorId}" class="field-error" role="alert"></div>`;

	return `<div class="field">
		<label for="${fieldId}">${esc(fd.label)}</label>
		${inputHtml}
		${removeBtn}
		${errHtml}
	</div>`;
}

// ── Confirm dialogs ─────────────────────────────────────────────────

export function showConfirmDialog(
	title: string,
	message: string,
	confirmLabel: string,
	cancelLabel = "Keep editing",
): Promise<boolean> {
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
					<button type="submit" class="btn-quiet" value="cancel" autofocus>${esc(cancelLabel)}</button>
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
		(dialog.querySelector('button[value="cancel"]') as HTMLButtonElement | null)?.focus();
	});
}

export function showPromptDialog(
	title: string,
	label: string,
	defaultValue: string,
	confirmLabel = "Continue",
): Promise<string | null> {
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
					<button type="submit" class="btn-quiet" value="cancel">Cancel</button>
					<button type="submit" class="btn-save" value="confirm">${esc(confirmLabel)}</button>
				</div>
			</form>
		`;
		document.body.appendChild(dialog);
		dialog.addEventListener("close", () => {
			const val = dialog.returnValue;
			const input = dialog.querySelector("#prompt-input") as HTMLInputElement | null;
			dialog.remove();
			resolve(val === "confirm" ? (input?.value ?? null) : null);
		});
		dialog.showModal();
		const input = dialog.querySelector("#prompt-input") as HTMLInputElement | null;
		input?.focus();
		input?.select();
	});
}

// ── Main render ────────────────────────────────────────────────────

export function renderApp(
	state: ProviderManagerState,
	fieldDescs: FieldDescriptor[],
	callbacks: ProviderViewCallbacks,
): void {
	const root = $id("app");
	if (!root) return;

	if (state.errors.length > 0 && state.errors[0]?.message?.includes("close and reopen")) {
		root.innerHTML = `<div class="status status-error">${esc(state.errors[0]!.message)}</div>
			<div class="actions"><button class="btn-cancel" id="btn-cancel">Close</button></div>`;
		listen("btn-cancel", "click", () => callbacks.onCancel());
		return;
	}

	const sidebar = renderProviderSidebar(state);
	const detail = renderProviderDetail(state, fieldDescs, state.secretSlots);
	const draftState = state.dirty
		? '<span class="command-status is-dirty" aria-live="polite">Unsaved changes</span>'
		: '<span class="command-status" aria-live="polite">No changes</span>';
	const headerActions = state.dirty
		? '<button class="btn-quiet" id="btn-header-cancel" type="button">Discard &amp; close</button><button class="btn-secondary" id="btn-header-preview" type="button">Review changes</button><button class="btn-save" id="btn-header-save" type="button">Save &amp; close</button>'
		: '<button class="btn-quiet" id="btn-header-cancel" type="button">Close</button>';

	root.innerHTML = `
		<a class="skip-link" href="#main-content">Skip to workspace</a>
		<header class="app-header">
			<div class="brand-lockup"><span class="brand-mark" aria-hidden="true">π</span><div><strong>Pi Vendor</strong><span>Local configuration</span></div></div>
			${draftState}
			<div class="header-actions">
				${headerActions}
			</div>
		</header>
		<div class="layout">${sidebar}${detail}</div>
	`;

	// Bind sidebar events
	listen("btn-add-provider", "click", async () => {
		const name = await showPromptDialog("Add provider", "Provider name", "", "Add provider");
		if (name) callbacks.onCreate(name);
	});

	$id("app")?.querySelectorAll(".provider-list li").forEach((li) => {
		li.addEventListener("click", () => {
			const key = li.getAttribute("data-provider");
			if (key) callbacks.onSelect(key);
		});
		li.addEventListener("keydown", (e) => {
			if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") {
				e.preventDefault();
				const key = li.getAttribute("data-provider");
				if (key) callbacks.onSelect(key);
			}
		});
	});

	// Bind detail events
	listen("btn-rename", "click", async () => {
		const newName = await showPromptDialog("Rename provider", "Provider name", state.selectedProvider ?? "", "Rename provider");
		if (!newName || !state.selectedProvider || newName === state.selectedProvider) return;
		callbacks.onRename(state.selectedProvider, newName, "reject");
	});

	listen("btn-delete", "click", async () => {
		if (!state.selectedProvider) return;
		const providers = (state.draft as Record<string, unknown>).providers as Record<string, Record<string, unknown>> ?? {};
		const config = providers[state.selectedProvider];
		const modelCount = Array.isArray(config?.models) ? config!.models.length : 0;
		const secrets = countSecretsForProvider(state.secretSlots, state.selectedProvider);

		let msg = `Delete provider "${state.selectedProvider}"?`;
		if (modelCount > 0) msg += `\n${modelCount} model(s) will be deleted.`;
		if (secrets.total > 0) {
			const parts: string[] = [];
			if (secrets.apiKey) parts.push(`${secrets.apiKey} apiKey`);
			if (secrets.header) parts.push(`${secrets.header} header`);
			if (secrets.other) parts.push(`${secrets.other} other`);
			msg += `\n${secrets.total} secret(s) will be removed (${parts.join(", ")}).`;
		}

		const confirmed = await showConfirmDialog("Delete provider", msg, "Delete provider", "Keep provider");
		if (confirmed) callbacks.onDelete(state.selectedProvider);
	});

	listen("btn-header-save", "click", () => callbacks.onSave());
	listen("btn-header-cancel", "click", () => callbacks.onCancel());
	listen("btn-toggle-raw", "click", () => callbacks.onToggleRaw());
	listen("btn-header-preview", "click", () => callbacks.onPreview());

	// Bind field inputs — update state without full re-render focus steal
	for (const fd of fieldDescs) {
		const el = $id(`field-${fd.key}`);
		if (!el) continue;

		if (fd.kind === "secret-text" && el.classList.contains("secret-badge")) {
			continue;
		}

		if (fd.kind === "boolean") {
			el.addEventListener("change", () => {
				if (!state.selectedProvider) return;
				callbacks.onSetField(state.selectedProvider, fd.key as ProviderFieldKey, (el as HTMLInputElement).checked);
			});
		} else if (fd.kind === "json") {
			el.addEventListener("input", () => {
				if (!state.selectedProvider) return;
				lastFocusedFieldId = fieldIdOf(fd.key);
				const text = (el as HTMLTextAreaElement).value;
				if (text.trim() === "") {
					callbacks.onRemoveField(state.selectedProvider, fd.key as ProviderFieldKey);
					return;
				}
				try {
					const parsed = JSON.parse(text);
					callbacks.onSetField(state.selectedProvider, fd.key as ProviderFieldKey, parsed);
					const err = $id(`field-${fd.key}-error`);
					if (err) err.textContent = "";
				} catch {
					const err = $id(`field-${fd.key}-error`);
					if (err) err.textContent = "Enter valid JSON before continuing.";
				}
			});
			el.addEventListener("focus", () => {
				lastFocusedFieldId = fieldIdOf(fd.key);
			});
		} else {
			el.addEventListener("input", () => {
				if (!state.selectedProvider) return;
				lastFocusedFieldId = fieldIdOf(fd.key);
				const value = (el as HTMLInputElement).value;
				// Common clear deletes the key (design scenario 3). Optional Add-setting fields keep typed empties until ×.
				if (value === "" && fd.common) {
					callbacks.onRemoveField(state.selectedProvider, fd.key as ProviderFieldKey);
					return;
				}
				callbacks.onSetField(state.selectedProvider, fd.key as ProviderFieldKey, value);
			});
			el.addEventListener("focus", () => {
				lastFocusedFieldId = fieldIdOf(fd.key);
			});
		}
	}

	// Secret replace / remove
	$id("app")?.querySelectorAll(".btn-replace-secret").forEach((btn) => {
		btn.addEventListener("click", async () => {
			if (!state.selectedProvider) return;
			const field = (btn as HTMLElement).getAttribute("data-field") as ProviderFieldKey | null;
			if (!field) return;
			const value = await showPromptDialog(`Replace ${field}`, "New secret value", "", "Replace secret");
			if (value === null) return;
			callbacks.onReplaceSecret(state.selectedProvider, field, value);
		});
	});
	$id("app")?.querySelectorAll(".btn-remove-secret").forEach((btn) => {
		btn.addEventListener("click", async () => {
			if (!state.selectedProvider) return;
			const field = (btn as HTMLElement).getAttribute("data-field") as ProviderFieldKey | null;
			if (!field) return;
			const confirmed = await showConfirmDialog(
				"Remove secret",
				"Remove this configured secret? The saved value cannot be recovered from this page.",
				"Remove secret",
				"Keep secret",
			);
			if (confirmed) callbacks.onRemoveSecret(state.selectedProvider, field);
		});
	});

	// Bind remove-field buttons
	$id("app")?.querySelectorAll(".btn-remove-field").forEach((btn) => {
		btn.addEventListener("click", () => {
			if (!state.selectedProvider) return;
			const field = (btn as HTMLElement).getAttribute("data-field") as ProviderFieldKey | null;
			if (field) callbacks.onRemoveField(state.selectedProvider, field);
		});
	});

	// Bind add-setting
	listen("add-setting-select", "change", () => {
		const sel = $id("add-setting-select") as HTMLSelectElement | null;
		if (!sel || !sel.value || !state.selectedProvider) return;
		callbacks.onAddSetting(state.selectedProvider, sel.value as ProviderFieldKey);
		sel.value = "";
	});

	// Restore focus if we know where the user was typing; otherwise do not steal focus on every keystroke.
	if (lastFocusedFieldId) {
		const restore = $id(lastFocusedFieldId) as HTMLInputElement | HTMLTextAreaElement | null;
		if (restore && "focus" in restore) {
			const pos = typeof restore.selectionStart === "number" ? restore.selectionStart : null;
			restore.focus();
			if (pos !== null && "setSelectionRange" in restore) {
				try {
					restore.setSelectionRange(pos, pos);
				} catch {
					/* password/type may not support */
				}
			}
		}
	}
}

function fieldIdOf(key: string): string {
	return `field-${key}`;
}
