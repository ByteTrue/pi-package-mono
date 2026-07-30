import { Container, Key, matchesKey, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";

// Scripted UI adapter for TUI quick workflows.
// Provides a mockable interface for unit-testing TUI state machines.

export interface QuickUI {
	// Show a selection menu. Returns the selected value or null on cancel.
	select<T extends string>(options: {
		message: string;
		choices: readonly { value: T; label: string }[];
		default?: T;
	}): Promise<T | null>;

	// Show a text input. Returns the input value or null on cancel.
	input(options: { message: string; placeholder?: string }): Promise<string | null>;

	// Show a confirmation. Returns true/false.
	confirm(message: string, detail?: string): Promise<boolean>;

	// Show a notification.
	notify(message: string, level?: "info" | "warning" | "error"): void;
}

// Production adapter using Pi ctx.ui
const PAGE_SIZE = 10;

async function pagedSelect<T extends string>(
	raw: Record<string, Function>,
	opts: { message: string; choices: readonly { value: T; label: string }[]; default?: T },
): Promise<T | null> {
	const items: SelectItem[] = opts.choices.map((choice) => ({ ...choice }));
	return raw.custom?.((tui: any, theme: any, _keybindings: any, done: (value: T | null) => void) => {
		const container = new Container();
		container.addChild(new Text(theme.fg("accent", theme.bold(opts.message)), 1, 0));

		const list = new SelectList(items, PAGE_SIZE, {
			selectedPrefix: (text: string) => theme.fg("accent", text),
			selectedText: (text: string) => theme.fg("accent", text),
			description: (text: string) => theme.fg("muted", text),
			scrollInfo: (text: string) => theme.fg("dim", text),
			noMatch: (text: string) => theme.fg("warning", text),
		});
		let selectedIndex = Math.max(0, opts.choices.findIndex((choice) => choice.value === opts.default));
		list.setSelectedIndex(selectedIndex);
		list.onSelectionChange = (item) => {
			selectedIndex = items.indexOf(item);
		};
		list.onSelect = (item) => done(item.value as T);
		list.onCancel = () => done(null);
		container.addChild(list);
		container.addChild(new Text(theme.fg("dim", "↑↓ move • ←→ page • enter select • esc cancel"), 1, 0));

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput(data: string) {
				if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
					const direction = matchesKey(data, Key.left) ? -1 : 1;
					selectedIndex = Math.max(0, Math.min(items.length - 1, selectedIndex + direction * PAGE_SIZE));
					list.setSelectedIndex(selectedIndex);
				} else {
					list.handleInput(data);
				}
				tui.requestRender();
			},
		};
	}) ?? null;
}

// Production adapter using Pi ctx.ui
// ponytail: Pi UI API has compatible runtime signatures; use untyped wrapper
export function createProductionQuickUI(raw: Record<string, Function>): QuickUI {
	return {
		async select(opts) {
			if (opts.choices.length > PAGE_SIZE && raw.custom) return pagedSelect(raw, opts);
			const result = await raw.select?.(opts.message, opts.choices.map((c: any) => c.label), { default: opts.default ? opts.choices.find((c: any) => c.value === opts.default)?.label : undefined });
			if (!result) return null;
			const index = opts.choices.map((c: any) => c.label).indexOf(result);
			if (index < 0) return null;
			return opts.choices[index]!.value;
		},
		async input(opts) {
			// Pi signature is input(title, placeholder?, opts?) — passing the whole
			// options object here renders "[object Object]" as the placeholder.
			const result = await raw.input?.(opts.message, opts.placeholder);
			return result ?? null;
		},
		confirm: (msg: string, detail?: string) => raw.confirm?.(msg, detail) ?? false,
		notify: (msg: string, level?: string) => raw.notify?.(msg, level),
	};
}

// Scripted (test) adapter — records calls and returns pre-programmed responses
export function createScriptedQuickUI(responses: {
	select?: (message: string) => string | null;
	input?: (message: string) => string | null;
	confirm?: (message: string) => boolean;
}): QuickUI & { calls: { kind: string; message: string; choices?: string[] }[]; notifies: { message: string; level: string }[] } {
	const calls: { kind: string; message: string; choices?: string[] }[] = [];
	const notifies: { message: string; level: string }[] = [];

	return {
		calls,
		notifies,
		async select(opts) {
			calls.push({ kind: "select", message: opts.message, choices: opts.choices.map((c) => c.value) });
			if (responses.select) {
				const val = responses.select(opts.message);
				if (val === null) return null;
				// Verify the returned value is one of the choices
				if (opts.choices.some((c) => c.value === val)) return val as any;
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
		},
	};
}
