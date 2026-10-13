/**
 * pi-context-guard — slash command /context to configure model contextWindow
 * surgically in models.json, restore original parameters, and session-file
 * pointer in system prompt.
 *
 * A small-extension: shipped as this single file (no npm package, no build
 * step), installed by scripts/install-small-extension.sh / .ps1 into
 * ~/.pi/agent/extensions/. Zero runtime imports — jiti loads TypeScript
 * directly; type-only imports disappear at load time.
 *
 * Why this exists:
 * 1. Models with large context windows (e.g. 1M tokens) take huge memory and cost
 *    before Pi's native compaction triggers near the window limit. Changing
 *    contextWindow in models.json lets Pi's built-in compaction activate at a
 *    user-selected threshold without brittle external agent_settled hooks.
 * 2. Surgical text updates: user models in models.json are modified strictly
 *    in-place (preserving all unselected models, formatting, indentation, comments,
 *    and field orders) to prevent destructive reformatting.
 * 3. Restoration of original parameters: captures original contextWindow before
 *    first modification and can restore them exactly (including removing the
 *    field if it was originally absent).
 * 4. The system prompt continues to name the session file so details dropped by
 *    compaction summaries remain reachable via JSONL search.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export type DiscoveredModel = {
	provider: string;
	modelId: string;
	kind: "model" | "override";
	contextWindow?: number;
};

export type ModelObjectRange = {
	providerKey: string;
	modelId: string;
	kind: "model" | "override";
	start: number;
	end: number;
};

export type ContextWindowUpdate = {
	providerKey: string;
	modelId: string;
	kind: "model" | "override";
	threshold: number;
};

export type OriginalModelRecord = {
	provider: string;
	modelId: string;
	kind: "model" | "override";
	contextWindow: number | null; // null means originally unset
	savedAt: string;
};

export type OriginalsStore = Record<string, OriginalModelRecord>;

/** Get the path to models.json respecting PI_CODING_AGENT_DIR. */
export function getModelsJsonPath(): string {
	const baseDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
	return join(baseDir, "models.json");
}

/** Get the path to private originals backup file respecting PI_CODING_AGENT_DIR. */
export function getOriginalsFilePath(): string {
	const baseDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
	return join(baseDir, "pi-pkg-cfg", "pi-context-guard", "originals.json");
}

/** Read recorded original parameters from disk. */
export function readOriginalsStore(path = getOriginalsFilePath()): OriginalsStore {
	try {
		const raw = readFileSync(path, "utf8");
		return JSON.parse(raw) as OriginalsStore;
	} catch {
		return {};
	}
}

/** Write recorded original parameters to disk. */
export function writeOriginalsStore(store: OriginalsStore, path = getOriginalsFilePath()): void {
	atomicWriteFileSync(path, JSON.stringify(store, null, 2) + "\n");
}

/** Strip JSON comments without damaging URL slashes inside strings. */
export function stripJsonComments(jsonStr: string): string {
	let inString = false;
	let escaped = false;
	let inLineComment = false;
	let inBlockComment = false;
	let result = "";

	for (let i = 0; i < jsonStr.length; i++) {
		const ch = jsonStr[i];
		const next = jsonStr[i + 1];

		if (inLineComment) {
			if (ch === "\n") {
				inLineComment = false;
				result += ch;
			}
			continue;
		}

		if (inBlockComment) {
			if (ch === "*" && next === "/") {
				inBlockComment = false;
				i++;
			}
			continue;
		}

		if (inString) {
			result += ch;
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}

		if (ch === '"') {
			inString = true;
			result += ch;
		} else if (ch === "/" && next === "/") {
			inLineComment = true;
			i++;
		} else if (ch === "/" && next === "*") {
			inBlockComment = true;
			i++;
		} else {
			result += ch;
		}
	}

	return result;
}

/** Parse a user-provided threshold string (e.g. '300k', '1.5m', '400000'). */
export function parseThreshold(input: unknown): number | null {
	if (typeof input !== "string" && typeof input !== "number") return null;
	const trimmed = String(input).trim().toLowerCase();
	if (!trimmed) return null;
	const match = /^([0-9]+(?:\.[0-9]+)?)\s*([km])?$/i.exec(trimmed);
	if (!match || !match[1]) return null;
	const num = parseFloat(match[1]);
	if (!Number.isFinite(num) || num <= 0) return null;
	const unit = match[2]?.toLowerCase();
	let multiplier = 1;
	if (unit === "k") multiplier = 1_000;
	else if (unit === "m") multiplier = 1_000_000;
	const val = Math.round(num * multiplier);
	return val > 0 ? val : null;
}

/** Discover all user-configured models and overrides from raw models.json text. */
export function discoverModels(rawJsonText: string): DiscoveredModel[] {
	let doc: Record<string, unknown>;
	try {
		// Strip comments so users can safely use comments in models.json
		doc = JSON.parse(stripJsonComments(rawJsonText)) as Record<string, unknown>;
	} catch {
		return [];
	}
	const providers = doc.providers;
	if (!providers || typeof providers !== "object" || Array.isArray(providers)) return [];
	const results: DiscoveredModel[] = [];
	for (const [providerKey, providerVal] of Object.entries(providers as Record<string, unknown>)) {
		if (!providerVal || typeof providerVal !== "object") continue;
		const p = providerVal as Record<string, unknown>;
		if (Array.isArray(p.models)) {
			for (const m of p.models) {
				if (m && typeof m === "object" && typeof (m as { id?: unknown }).id === "string") {
					const mObj = m as { id: string; contextWindow?: unknown };
					results.push({
						provider: providerKey,
						modelId: mObj.id,
						kind: "model",
						contextWindow: typeof mObj.contextWindow === "number" ? mObj.contextWindow : undefined,
					});
				}
			}
		}
		if (p.modelOverrides && typeof p.modelOverrides === "object" && !Array.isArray(p.modelOverrides)) {
			for (const [overrideId, oVal] of Object.entries(p.modelOverrides as Record<string, unknown>)) {
				if (oVal && typeof oVal === "object") {
					const oObj = oVal as { contextWindow?: unknown };
					results.push({
						provider: providerKey,
						modelId: overrideId,
						kind: "override",
						contextWindow: typeof oObj.contextWindow === "number" ? oObj.contextWindow : undefined,
					});
				}
			}
		}
	}
	return results;
}

export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find index of matching closing brace for an object starting at startIndex. */
export function findBraceEnd(textStr: string, startIndex: number): number {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = startIndex; i < textStr.length; i++) {
		const ch = textStr[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
		} else {
			if (ch === '"') inString = true;
			else if (ch === "{") depth++;
			else if (ch === "}") {
				depth--;
				if (depth === 0) return i;
			}
		}
	}
	return -1;
}

/** Find the innermost object { ... } containing targetIndex. */
export function findEnclosingObject(
	text: string,
	minIndex: number,
	maxIndex: number,
	targetIndex: number,
): { start: number; end: number } | null {
	let best: { start: number; end: number } | null = null;
	let inString = false;
	let escaped = false;
	const stack: number[] = [];

	for (let i = minIndex; i <= maxIndex; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
		} else {
			if (ch === '"') inString = true;
			else if (ch === "{") stack.push(i);
			else if (ch === "}") {
				const start = stack.pop();
				if (start !== undefined && start <= targetIndex && i >= targetIndex) {
					if (!best || i - start < best.end - best.start) {
						best = { start, end: i };
					}
				}
			}
		}
	}
	return best;
}

/** Locate the exact character slice [start, end] of a model definition in raw text. */
export function findModelObjectRange(
	rawText: string,
	providerKey: string,
	modelId: string,
	kind: "model" | "override",
): ModelObjectRange | null {
	const providerPattern = new RegExp(`"${escapeRegex(providerKey)}"\\s*:\\s*\\{`, "g");
	let pMatch: RegExpExecArray | null;
	while ((pMatch = providerPattern.exec(rawText)) !== null) {
		const braceStart = pMatch.index + pMatch[0].length - 1;
		const braceEnd = findBraceEnd(rawText, braceStart);
		if (braceEnd === -1) continue;
		const providerContent = rawText.slice(braceStart, braceEnd + 1);

		if (kind === "override") {
			// Search strictly within the modelOverrides object to avoid false-positive key matches
			const ovPattern = /"modelOverrides"\s*:\s*\{/g;
			let ovMatch: RegExpExecArray | null;
			while ((ovMatch = ovPattern.exec(providerContent)) !== null) {
				const ovBraceStart = braceStart + ovMatch.index + ovMatch[0].length - 1;
				const ovBraceEnd = findBraceEnd(rawText, ovBraceStart);
				if (ovBraceEnd === -1) continue;
				const ovContent = rawText.slice(ovBraceStart, ovBraceEnd + 1);

				const overridePattern = new RegExp(`"${escapeRegex(modelId)}"\\s*:\\s*\\{`, "g");
				let oMatch: RegExpExecArray | null;
				while ((oMatch = overridePattern.exec(ovContent)) !== null) {
					const objStart = ovBraceStart + oMatch.index + oMatch[0].length - 1;
					const objEnd = findBraceEnd(rawText, objStart);
					if (objEnd !== -1) {
						return { providerKey, modelId, kind, start: objStart, end: objEnd };
					}
				}
			}
		} else {
			const idPattern = new RegExp(`"id"\\s*:\\s*"${escapeRegex(modelId)}"`, "g");
			let idMatch: RegExpExecArray | null;
			while ((idMatch = idPattern.exec(providerContent)) !== null) {
				const absIndex = braceStart + idMatch.index;
				const objRange = findEnclosingObject(rawText, braceStart, braceEnd, absIndex);
				if (objRange) {
					return { providerKey, modelId, kind, start: objRange.start, end: objRange.end };
				}
			}
		}
	}
	return null;
}

/** Surgically replace or insert "contextWindow": threshold inside a single object snippet. */
export function updateModelObjectContextWindow(objText: string, threshold: number): string {
	const cwRegex = /("contextWindow"\s*:\s*)(\d+)/;
	if (cwRegex.test(objText)) {
		return objText.replace(cwRegex, `$1${threshold}`);
	}
	// Only match horizontal space so newline is not consumed
	const idRegex = /("id"\s*:\s*"[^"]*")([ \t]*,?)/;
	const idMatch = idRegex.exec(objText);
	if (idMatch && idMatch[1]) {
		const idPos = idMatch.index;
		const lineStart = objText.lastIndexOf("\n", idPos);
		const indent = lineStart >= 0 ? objText.slice(lineStart + 1, idPos) : "\t";
		const beforeId = objText.slice(0, idPos);
		const afterId = objText.slice(idPos + idMatch[0].length);
		const hadTrailingComma = (idMatch[2] ?? "").includes(",") || afterId.trimStart().startsWith(",");
		const rest = afterId.replace(/^[ \t]*,?/, "");
		const cwTrailingComma = hadTrailingComma ? "," : "";
		return `${beforeId}${idMatch[1]},\n${indent}"contextWindow": ${threshold}${cwTrailingComma}${rest}`;
	}
	const bracePos = objText.indexOf("{");
	const nextLine = objText.indexOf("\n", bracePos);
	if (nextLine >= 0) {
		const nextLineEnd = objText.indexOf("\n", nextLine + 1);
		const sampleLine = nextLineEnd >= 0 ? objText.slice(nextLine + 1, nextLineEnd) : "";
		const indentMatch = /^\s+/.exec(sampleLine);
		const indent = indentMatch ? indentMatch[0] : "  ";
		const restOfObj = objText.slice(nextLine + 1);
		const hasMoreProperties = restOfObj.trim() !== "}";
		const trailingComma = hasMoreProperties ? "," : "";
		return objText.slice(0, nextLine + 1) + `${indent}"contextWindow": ${threshold}${trailingComma}\n` + restOfObj;
	}
	const rest = objText.slice(bracePos + 1).trim();
	const hasMoreProperties = rest !== "" && rest !== "}";
	const trailingComma = hasMoreProperties ? "," : "";
	return rest === "}" || rest === ""
		? `{\n  "contextWindow": ${threshold}\n}`
		: `{\n  "contextWindow": ${threshold}${trailingComma}\n  ${rest}`;
}

/** Surgically remove "contextWindow" line from an object snippet. */
export function removeModelObjectContextWindow(objText: string): string {
	const cwRegex = /([ \t]*)"contextWindow"\s*:\s*\d+\s*,?(\r?\n)?/;
	const match = cwRegex.exec(objText);
	if (!match) return objText;
	const matchPos = match.index;
	const before = objText.slice(0, matchPos);
	const after = objText.slice(matchPos + match[0].length);

	let cleanBefore = before;
	// Allow single-line comments between comma and newline
	if (!match[0].includes(",") && /,[ \t]*(?:\/\/.*)?(\r?\n)?$/.test(cleanBefore)) {
		cleanBefore = cleanBefore.replace(/,([ \t]*(?:\/\/.*)?(\r?\n)?)$/, "$1");
	}
	return cleanBefore + after;
}

/** Restore contextWindow or remove it if originally unset. */
export function restoreModelObjectContextWindow(objText: string, originalValue: number | null): string {
	if (originalValue === null) {
		return removeModelObjectContextWindow(objText);
	}
	return updateModelObjectContextWindow(objText, originalValue);
}

/** Apply contextWindow updates surgically across raw models.json text. */
export function applyContextWindowUpdates(rawText: string, updates: ContextWindowUpdate[]): string {
	const targets: (ModelObjectRange & { threshold: number })[] = [];
	for (const u of updates) {
		const range = findModelObjectRange(rawText, u.providerKey, u.modelId, u.kind);
		if (range) {
			targets.push({ ...range, threshold: u.threshold });
		}
	}
	// Sort descending by character offset to keep earlier offsets stable
	targets.sort((a, b) => b.start - a.start);

	let result = rawText;
	for (const t of targets) {
		const objText = result.slice(t.start, t.end + 1);
		const newObjText = updateModelObjectContextWindow(objText, t.threshold);
		result = result.slice(0, t.start) + newObjText + result.slice(t.end + 1);
	}
	// Safety oracle: verify valid JSON
	JSON.parse(stripJsonComments(result));
	return result;
}

/** Apply restorations surgically across raw models.json text. */
export function applyContextWindowRestorations(
	rawText: string,
	restorations: Array<{
		providerKey: string;
		modelId: string;
		kind: "model" | "override";
		originalValue: number | null;
	}>,
): string {
	const targets: (ModelObjectRange & { originalValue: number | null })[] = [];
	for (const r of restorations) {
		const range = findModelObjectRange(rawText, r.providerKey, r.modelId, r.kind);
		if (range) {
			targets.push({ ...range, originalValue: r.originalValue });
		}
	}
	targets.sort((a, b) => b.start - a.start);

	let result = rawText;
	for (const t of targets) {
		const objText = result.slice(t.start, t.end + 1);
		const newObjText = restoreModelObjectContextWindow(objText, t.originalValue);
		result = result.slice(0, t.start) + newObjText + result.slice(t.end + 1);
	}
	JSON.parse(stripJsonComments(result));
	return result;
}

/** Atomically write file to avoid corruption. */
export function atomicWriteFileSync(filePath: string, content: string): void {
	const dir = dirname(filePath);
	mkdirSync(dir, { recursive: true });
	const temp = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
	try {
		writeFileSync(temp, content, { encoding: "utf8", mode: 0o600 });
		renameSync(temp, filePath);
	} finally {
		try {
			unlinkSync(temp);
		} catch {
			// Temp file already renamed or unlinked
		}
	}
}

/** System prompt section naming the session file. */
export function sessionFileSection(sessionFile: string): string {
	return (
		"This session's full history, including parts a compaction summary replaced, is kept " +
		"as JSONL at " + sessionFile + ". Search it when a summary lost a detail you need."
	);
}

/** Check whether a model capacity is eligible to be clamped down to threshold. */
export function isEligibleForThreshold(
	capacity: number | null | undefined,
	threshold: number,
): boolean {
	if (typeof capacity !== "number" || capacity <= 0) return false;
	return capacity > threshold;
}

export const makeKey = (provider: string, modelId: string, kind: "model" | "override") =>
	`${provider}::${kind}::${modelId}`;

/** Run the flow to set contextWindow thresholds. */
async function runSetThresholdFlow(
	initialArg: string | undefined,
	ctx: ExtensionCommandContext,
	pi: ExtensionAPI,
): Promise<void> {
	let threshold = parseThreshold(initialArg);
	if (threshold === null) {
		const inputStr = await ctx.ui.input(
			"Set contextWindow threshold (e.g. 300k, 400000):",
			"300k",
		);
		if (!inputStr) {
			ctx.ui.notify("Context threshold setup cancelled.", "info");
			return;
		}
		threshold = parseThreshold(inputStr);
		if (threshold === null) {
			ctx.ui.notify(`Invalid threshold: "${inputStr}". Expected a positive number or unit (e.g. 300k, 1m).`, "error");
			return;
		}
	}

	const configPath = getModelsJsonPath();
	let rawText: string;
	try {
		rawText = readFileSync(configPath, "utf8");
	} catch (err: unknown) {
		const code = (err as { code?: string })?.code;
		if (code === "ENOENT") {
			ctx.ui.notify(`No models.json found at ${configPath}.`, "warning");
			return;
		}
		ctx.ui.notify(`Failed to read models.json: ${err instanceof Error ? err.message : String(err)}`, "error");
		return;
	}

	const models = discoverModels(rawText);
	if (models.length === 0) {
		ctx.ui.notify("No custom models or overrides found in models.json.", "warning");
		return;
	}

	const store = readOriginalsStore();

	// Only models whose real capacity is larger than the threshold can be clamped
	const eligibleModels: DiscoveredModel[] = [];
	let skippedCount = 0;

	for (const m of models) {
		const key = makeKey(m.provider, m.modelId, m.kind);
		const registryWindow = (ctx as { modelRegistry?: { find: (p: string, id: string) => { contextWindow?: number } | undefined } })
			.modelRegistry?.find(m.provider, m.modelId)?.contextWindow;
		const capacity = store[key]?.contextWindow ?? m.contextWindow ?? registryWindow;

		if (isEligibleForThreshold(capacity, threshold)) {
			eligibleModels.push(m);
		} else {
			skippedCount++;
		}
	}

	if (eligibleModels.length === 0) {
		ctx.ui.notify(
			`No models found with contextWindow larger than ${threshold.toLocaleString()} tokens (${skippedCount} model(s) are already <= ${threshold.toLocaleString()}).`,
			"info",
		);
		return;
	}

	const selected = new Set<string>();

	while (true) {
		const allSelected = selected.size === eligibleModels.length;
		const toggleAllLabel = allSelected ? "[x] Clear all selection" : "[ ] Select all eligible models";
		const confirmLabel = `[✔ Confirm and save (${selected.size}/${eligibleModels.length})]`;
		const cancelLabel = "[Cancel]";

		const modelOptions = eligibleModels.map((m) => {
			const checked = selected.has(makeKey(m.provider, m.modelId, m.kind)) ? "[✔]" : "[ ]";
			const cwStr = m.contextWindow !== undefined ? `cur: ${m.contextWindow.toLocaleString()}` : "cur: unset";
			const kindTag = m.kind === "override" ? " override" : "";
			return `${checked} ${m.modelId} (${m.provider}${kindTag}) [${cwStr}]`;
		});

		const choices = [
			confirmLabel,
			toggleAllLabel,
			...modelOptions,
			cancelLabel,
		];

		const skippedNote = skippedCount > 0 ? `, ${skippedCount} skipped <= ${threshold.toLocaleString()}` : "";
		const pick = await ctx.ui.select(
			`Select models to clamp contextWindow to ${threshold.toLocaleString()} tokens (${eligibleModels.length} eligible > ${threshold.toLocaleString()}${skippedNote}):`,
			choices,
		);

		if (!pick || pick === cancelLabel) {
			ctx.ui.notify("Context configuration unchanged.", "info");
			return;
		}

		if (pick === confirmLabel) {
			if (selected.size === 0) {
				ctx.ui.notify("No models selected. Please select at least one model or cancel.", "warning");
				continue;
			}
			break;
		}

		if (pick === toggleAllLabel) {
			if (allSelected) {
				selected.clear();
			} else {
				for (const m of eligibleModels) {
					selected.add(makeKey(m.provider, m.modelId, m.kind));
				}
			}
			continue;
		}

		const modelIndex = choices.indexOf(pick) - 2;
		if (modelIndex >= 0 && modelIndex < eligibleModels.length) {
			const targetModel = eligibleModels[modelIndex];
			if (targetModel) {
				const key = makeKey(targetModel.provider, targetModel.modelId, targetModel.kind);
				if (selected.has(key)) selected.delete(key);
				else selected.add(key);
			}
		}
	}

	const selectedModels = eligibleModels.filter((m) => selected.has(makeKey(m.provider, m.modelId, m.kind)));

	// Preserve original values in originals backup before overwriting
	let storeUpdated = false;
	for (const m of selectedModels) {
		const key = makeKey(m.provider, m.modelId, m.kind);
		if (!store[key]) {
			store[key] = {
				provider: m.provider,
				modelId: m.modelId,
				kind: m.kind,
				contextWindow: m.contextWindow ?? null,
				savedAt: new Date().toISOString(),
			};
			storeUpdated = true;
		}
	}
	if (storeUpdated) {
		writeOriginalsStore(store);
	}

	const updates: ContextWindowUpdate[] = selectedModels.map((m) => ({
		providerKey: m.provider,
		modelId: m.modelId,
		kind: m.kind,
		threshold: threshold!,
	}));

	try {
		const updatedText = applyContextWindowUpdates(rawText, updates);
		atomicWriteFileSync(configPath, updatedText);

		// Hot-refresh model registry so Pi picks up models.json immediately without restart
		await ctx.modelRegistry?.refresh?.();

		// If current active session model was updated, re-apply it to update TUI footer immediately
		if (ctx.model) {
			const activeKey = makeKey(ctx.model.provider, ctx.model.id, "model");
			const activeOverrideKey = makeKey(ctx.model.provider, ctx.model.id, "override");
			if (selected.has(activeKey) || selected.has(activeOverrideKey)) {
				const refreshed = ctx.modelRegistry?.find?.(ctx.model.provider, ctx.model.id);
				if (refreshed) {
					await pi.setModel?.(refreshed);
				}
			}
		}

		ctx.ui.notify(
			`Updated contextWindow to ${threshold.toLocaleString()} for ${selectedModels.length} model(s). Applied immediately.`,
			"info",
		);
	} catch (err: unknown) {
		ctx.ui.notify(`Failed to save models.json: ${err instanceof Error ? err.message : String(err)}`, "error");
	}
}

/** Run the flow to restore original model parameters. */
async function runRestoreOriginalsFlow(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
	const store = readOriginalsStore();
	const records = Object.values(store);
	if (records.length === 0) {
		ctx.ui.notify("No original model parameters recorded yet.", "info");
		return;
	}

	const configPath = getModelsJsonPath();
	let rawText: string;
	try {
		rawText = readFileSync(configPath, "utf8");
	} catch (err: unknown) {
		ctx.ui.notify(`Failed to read models.json: ${err instanceof Error ? err.message : String(err)}`, "error");
		return;
	}

	const selected = new Set<string>();

	while (true) {
		const allSelected = selected.size === records.length;
		const toggleAllLabel = allSelected ? "[x] Clear all selection" : "[ ] Select all models";
		const confirmLabel = `[✔ Restore selected (${selected.size}/${records.length})]`;
		const cancelLabel = "[Cancel]";

		const recordOptions = records.map((r) => {
			const checked = selected.has(makeKey(r.provider, r.modelId, r.kind)) ? "[✔]" : "[ ]";
			const origStr = r.contextWindow !== null ? `original: ${r.contextWindow.toLocaleString()}` : "original: unset";
			const kindTag = r.kind === "override" ? " override" : "";
			return `${checked} ${r.modelId} (${r.provider}${kindTag}) [${origStr}]`;
		});

		const choices = [
			confirmLabel,
			toggleAllLabel,
			...recordOptions,
			cancelLabel,
		];

		const pick = await ctx.ui.select(
			"Select models to restore original contextWindow parameters:",
			choices,
		);

		if (!pick || pick === cancelLabel) {
			ctx.ui.notify("Restore cancelled.", "info");
			return;
		}

		if (pick === confirmLabel) {
			if (selected.size === 0) {
				ctx.ui.notify("No models selected to restore. Please select at least one or cancel.", "warning");
				continue;
			}
			break;
		}

		if (pick === toggleAllLabel) {
			if (allSelected) {
				selected.clear();
			} else {
				for (const r of records) {
					selected.add(makeKey(r.provider, r.modelId, r.kind));
				}
			}
			continue;
		}

		const recordIndex = choices.indexOf(pick) - 2;
		if (recordIndex >= 0 && recordIndex < records.length) {
			const targetRecord = records[recordIndex];
			if (targetRecord) {
				const key = makeKey(targetRecord.provider, targetRecord.modelId, targetRecord.kind);
				if (selected.has(key)) selected.delete(key);
				else selected.add(key);
			}
		}
	}

	const selectedRecords = records.filter((r) => selected.has(makeKey(r.provider, r.modelId, r.kind)));
	const restorations = selectedRecords.map((r) => ({
		providerKey: r.provider,
		modelId: r.modelId,
		kind: r.kind,
		originalValue: r.contextWindow,
	}));

	try {
		const updatedText = applyContextWindowRestorations(rawText, restorations);
		atomicWriteFileSync(configPath, updatedText);

		// Remove restored records from originals store
		for (const r of selectedRecords) {
			delete store[makeKey(r.provider, r.modelId, r.kind)];
		}
		writeOriginalsStore(store);

		// Hot-refresh model registry so Pi picks up models.json immediately without restart
		await ctx.modelRegistry?.refresh?.();

		// If current active session model was restored, re-apply it to update TUI footer immediately
		if (ctx.model) {
			const activeKey = makeKey(ctx.model.provider, ctx.model.id, "model");
			const activeOverrideKey = makeKey(ctx.model.provider, ctx.model.id, "override");
			if (selected.has(activeKey) || selected.has(activeOverrideKey)) {
				const refreshed = ctx.modelRegistry?.find?.(ctx.model.provider, ctx.model.id);
				if (refreshed) {
					await pi.setModel?.(refreshed);
				}
			}
		}

		ctx.ui.notify(
			`Restored original parameters for ${selectedRecords.length} model(s). Applied immediately.`,
			"info",
		);
	} catch (err: unknown) {
		ctx.ui.notify(`Failed to restore models.json: ${err instanceof Error ? err.message : String(err)}`, "error");
	}
}

export function registerContextGuard(pi: ExtensionAPI): void {
	pi.registerCommand("context", {
		description: "Set model contextWindow threshold or restore original parameters in models.json",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/context requires an interactive UI session.", "error");
				return;
			}

			const trimmedArg = typeof args === "string" ? args.trim() : "";
			const lowerArg = trimmedArg.toLowerCase();

			if (lowerArg === "restore" || lowerArg === "reset") {
				await runRestoreOriginalsFlow(ctx, pi);
				return;
			}

			if (parseThreshold(trimmedArg) !== null) {
				await runSetThresholdFlow(trimmedArg, ctx, pi);
				return;
			}

			if (trimmedArg !== "") {
				ctx.ui.notify(`Unrecognized argument: "${trimmedArg}". Use a threshold (e.g. 300k) or 'restore'.`, "error");
				return;
			}

			// Interactive root menu
			const action = await ctx.ui.select("Context Window Manager:", [
				"1. Set contextWindow threshold",
				"2. Restore original parameters",
				"Cancel",
			]);

			if (!action || action === "Cancel") {
				return;
			}

			if (action.startsWith("1")) {
				await runSetThresholdFlow(undefined, ctx, pi);
			} else if (action.startsWith("2")) {
				await runRestoreOriginalsFlow(ctx, pi);
			}
		},
	});

	pi.on("before_agent_start", (event, ctx) => {
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (!sessionFile) return;
		event.systemPromptOptions.sections.session_file = sessionFileSection(sessionFile);
	});
}

export default function (pi: ExtensionAPI): void {
	registerContextGuard(pi);
}
