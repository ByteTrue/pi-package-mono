import { createCustomInput, createCustomSelect } from "./custom-select.js";

export const VENDOR_OVERLAY_OPTIONS = { anchor: "center", width: 92 } as const;

export type SelectResult<T extends string> = { type: "select"; value: T } | null;

/**
 * Custom select with wrap-around navigation and pagination using ctx.ui.custom().
 * - Up/down arrows: navigate within current page (with wrap-around)
 * - Left/right arrows: change page
 * - Enter: select current item
 * - Escape: go back
 */
export async function customSelect<T extends string>(
	ctx: any,
	title: string,
	items: string[],
	defaultValue?: string,
	escapeLabel?: string,
): Promise<SelectResult<T>> {
	if (items.length === 0) return null;
	return ctx.ui.custom(createCustomSelect<T>({ title, items, defaultValue, maxVisible: 10, escapeLabel }), {
		overlay: true,
		overlayOptions: VENDOR_OVERLAY_OPTIONS,
	});
}

/** Helper to extract string value from customSelect result */
export function selectValue(result: SelectResult<string>): string | null {
	if (result && result.type === "select") return result.value;
	return null;
}

/** Custom input using ctx.ui.custom() with border. */
export async function customInput(
	ctx: any,
	title: string,
	placeholder?: string,
	defaultValue?: string,
): Promise<string | null> {
	return ctx.ui.custom(createCustomInput({ title, placeholder, defaultValue }), {
		overlay: true,
		overlayOptions: VENDOR_OVERLAY_OPTIONS,
	});
}

export async function promptInput(ctx: any, title: string, current: string, hint: string): Promise<string | null> {
	const value = await customInput(ctx, title, hint ? `${hint}${current ? ` (current: ${current})` : ""}` : current, current);
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : current;
}

export async function promptJsonObject<T extends object>(
	ctx: any,
	title: string,
	current: T,
): Promise<T | null | undefined> {
	const text = await ctx.ui.editor(title, `${JSON.stringify(current, null, 2)}\n`);
	if (text == null) return null;
	try {
		const parsed = JSON.parse(text);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("expected a JSON object");
		}
		return parsed as T;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Invalid JSON: ${message}`, "error");
		return undefined;
	}
}
