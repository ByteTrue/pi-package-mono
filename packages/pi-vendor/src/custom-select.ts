import { Input, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type CustomInputOptions = {
	title: string;
	placeholder?: string;
	defaultValue?: string;
};

export type CustomInputResult = string | null;

const MIN_WIDTH = 42;

type Frame = {
	top: () => string;
	row: (content?: string) => string;
	empty: () => string;
	divider: () => string;
	bottom: () => string;
};

function padAnsi(text: string, width: number): string {
	const truncated = truncateToWidth(text, width, "…");
	return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function createFrame(width: number): Frame {
	const innerWidth = Math.max(MIN_WIDTH, width - 2);
	const rowWidth = innerWidth - 2;

	return {
		top: () => `┌${"─".repeat(innerWidth)}┐`,
		row: (content = "") => `│ ${padAnsi(content, rowWidth)} │`,
		empty: () => `│${" ".repeat(innerWidth)}│`,
		divider: () => `├${"─".repeat(innerWidth)}┤`,
		bottom: () => `└${"─".repeat(innerWidth)}┘`,
	};
}

/**
 * Custom input component with border.
 */
export function createCustomInput(
	options: CustomInputOptions,
): (tui: any, theme: any, keybindings: any, done: (result: CustomInputResult) => void) => any {
	return (tui, theme, keybindings, done) => {
		const input = new Input();
		if (options.defaultValue) {
			input.setValue(options.defaultValue);
		}

		input.onSubmit = (value) => {
			done(value.trim());
		};

		input.onEscape = () => {
			done(null);
		};

		const component = {
			render(width: number): string[] {
				const frame = createFrame(width);
				const inputLines = input.render(Math.max(8, width - 8));
				const inputText = inputLines[0] || "";
				const displayText = inputText.trim() ? inputText : "";

				return [
					frame.top(),
					frame.row(theme.fg("accent", theme.bold(options.title))),
					frame.row(theme.fg("muted", options.placeholder || "Type a value, then press Enter.")),
					frame.divider(),
					frame.empty(),
					frame.row(`› ${displayText}`),
					frame.empty(),
					frame.divider(),
					frame.row(theme.fg("muted", "Enter submits, Esc goes back.")),
					frame.bottom(),
				];
			},

			handleInput(keyData: string): void {
				input.handleInput(keyData);
			},

			focus(): void {
				input.focused = true;
			},

			blur(): void {
				input.focused = false;
			},
		};

		return component;
	};
}

export type CustomSelectOptions = {
	title: string;
	items: string[];
	defaultValue?: string;
	maxVisible?: number;
	escapeLabel?: string;
};

export type CustomSelectResult<T extends string> = {
	type: "select";
	value: T;
};

/**
 * Custom select component with wrap-around navigation and pagination.
 * - Up/down arrows: navigate within current page (with wrap-around)
 * - Left/right arrows: change page
 * - Enter: select current item
 * - Escape: go back
 */
export function createCustomSelect<T extends string>(
	options: CustomSelectOptions,
): (tui: any, theme: any, keybindings: any, done: (result: CustomSelectResult<T> | null) => void) => any {
	return (tui, theme, keybindings, done) => {
		const items = options.items;
		const totalItems = items.length;
		const pageSize = options.maxVisible ?? 10;
		const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

		let currentPage = 0;
		let selectedIndex = 0;

		// Set default value if provided
		if (options.defaultValue) {
			const defaultIndex = items.indexOf(options.defaultValue);
			if (defaultIndex >= 0) {
				currentPage = Math.floor(defaultIndex / pageSize);
				selectedIndex = defaultIndex % pageSize;
			}
		}

		const component = {
			render(width: number): string[] {
				const frame = createFrame(width);
				const startIndex = currentPage * pageSize;
				const endIndex = Math.min(startIndex + pageSize, totalItems);
				const pageItems = items.slice(startIndex, endIndex);
				const pageInfo = totalPages > 1
					? `${totalItems} options · Page ${currentPage + 1}/${totalPages}`
					: `${totalItems} option${totalItems === 1 ? "" : "s"}`;
				const escapeText = options.escapeLabel ?? "goes back";
				const helpText = totalPages > 1
					? `↑↓ navigate, ←→ page, Enter selects, Esc ${escapeText}.`
					: `↑↓ navigate, Enter selects, Esc ${escapeText}.`;
				const lines = [
					frame.top(),
					frame.row(theme.fg("accent", theme.bold(options.title))),
					frame.row(theme.fg("muted", pageInfo)),
					frame.divider(),
				];

				for (let i = 0; i < pageItems.length; i++) {
					const isSelected = i === selectedIndex;
					const itemText = pageItems[i] ?? "";
					const rendered = isSelected
						? theme.fg("accent", "› ") + theme.fg("accent", theme.bold(itemText))
						: `  ${theme.fg("text", itemText)}`;
					lines.push(frame.row(rendered));
				}

				for (let i = pageItems.length; i < pageSize; i++) {
					lines.push(frame.empty());
				}

				lines.push(frame.divider());
				lines.push(frame.row(theme.fg("muted", helpText)));
				lines.push(frame.bottom());
				return lines;
			},

			handleInput(keyData: string): void {
				const kb = keybindings;
				const pageStart = currentPage * pageSize;
				const pageEnd = Math.min(pageStart + pageSize, totalItems);
				const pageLength = pageEnd - pageStart;

				// Up arrow - wrap within page
				if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
					selectedIndex = selectedIndex === 0 ? pageLength - 1 : selectedIndex - 1;
				}
				// Down arrow - wrap within page
				else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
					selectedIndex = selectedIndex === pageLength - 1 ? 0 : selectedIndex + 1;
				}
				// Left arrow - previous page
				else if (kb.matches(keyData, "tui.editor.cursorLeft") || keyData === "h") {
					if (currentPage > 0) {
						currentPage--;
						selectedIndex = 0;
					} else {
						// Wrap to last page
						currentPage = totalPages - 1;
						const lastPageLength = totalItems - (currentPage * pageSize);
						selectedIndex = lastPageLength - 1;
					}
				}
				// Right arrow - next page
				else if (kb.matches(keyData, "tui.editor.cursorRight") || keyData === "l") {
					if (currentPage < totalPages - 1) {
						currentPage++;
						selectedIndex = 0;
					} else {
						// Wrap to first page
						currentPage = 0;
						selectedIndex = 0;
					}
				}
				// Enter - select
				else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
					const globalIndex = pageStart + selectedIndex;
					const selected = items[globalIndex];
					if (selected) {
						done({ type: "select", value: selected as T });
					}
				}
				// Escape - go back
				else if (kb.matches(keyData, "tui.select.cancel")) {
					done(null);
				}
			},
		};

		return component;
	};
}
