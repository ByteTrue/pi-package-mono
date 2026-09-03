import {
  Container,
  Input,
  Key,
  Text,
  fuzzyFilter,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface PickerItem {
  value: string;
  label: string;
  description?: string;
}

const PAGE_SIZE = 10;

/**
 * Interactive fuzzy search selection list with keyboard navigation and wrap-around.
 * - Up at index 0 wraps to the last item.
 * - Down at the last item wraps to index 0.
 * - Typing filters items in real time via fuzzy matching.
 * - Esc cancels and returns undefined (for back navigation).
 */
export async function promptFuzzySelect(
  ctx: ExtensionCommandContext,
  title: string,
  items: PickerItem[],
  placeholder = "Type to search...",
): Promise<string | undefined> {
  const rawUI = ctx.ui as unknown as Record<string, Function>;

  if (typeof rawUI?.custom === "function") {
    return (
      (await rawUI.custom(
        (tui: any, theme: any, _keybindings: any, done: (val: string | undefined) => void) => {
          let query = "";
          let filtered: PickerItem[] = [...items];
          let selectedIndex = 0;

          const container = new Container();

          // Title
          container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));

          // Search input box
          const input = new Input();
          input.focused = true;
          container.addChild(input);

          // List container
          const listContainer = new Container();
          container.addChild(listContainer);

          // Help hint line
          const hint = new Text(
            theme.fg("dim", "  ↑↓ move (wrap-around) • Enter select • Esc back"),
            1,
            0,
          );
          container.addChild(hint);

          const updateList = () => {
            listContainer.clear();

            if (filtered.length === 0) {
              listContainer.addChild(
                new Text(theme.fg("warning", `  No matching options for "${query}"`), 0, 0),
              );
              return;
            }

            const maxVisible = PAGE_SIZE;
            const startIndex = Math.max(
              0,
              Math.min(
                selectedIndex - Math.floor(maxVisible / 2),
                filtered.length - maxVisible,
              ),
            );
            const endIndex = Math.min(startIndex + maxVisible, filtered.length);

            for (let i = startIndex; i < endIndex; i++) {
              const item = filtered[i];
              if (!item) continue;
              const isSelected = i === selectedIndex;
              const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
              const labelText = isSelected
                ? theme.fg("accent", theme.bold(item.label))
                : item.label;
              const descText = item.description
                ? theme.fg("muted", ` (${item.description})`)
                : "";

              listContainer.addChild(new Text(`${prefix}${labelText}${descText}`, 0, 0));
            }

            // Scroll indicator if needed
            if (filtered.length > maxVisible) {
              const scrollText = theme.fg(
                "dim",
                `  (${selectedIndex + 1}/${filtered.length})`,
              );
              listContainer.addChild(new Text(scrollText, 0, 0));
            }
          };

          const filterItems = (q: string) => {
            query = q.trim();
            if (!query) {
              filtered = [...items];
            } else {
              filtered = fuzzyFilter(items, query, (it) => `${it.label} ${it.value}`);
            }
            selectedIndex = 0;
            updateList();
          };

          // Initial render
          updateList();

          return {
            render: (width: number) => container.render(width),
            invalidate: () => container.invalidate(),
            handleInput(data: string) {
              // Up arrow - wrap to bottom when at top
              if (matchesKey(data, Key.up)) {
                if (filtered.length > 0) {
                  selectedIndex =
                    selectedIndex === 0 ? filtered.length - 1 : selectedIndex - 1;
                  updateList();
                  tui.requestRender();
                }
                return;
              }

              // Down arrow - wrap to top when at bottom
              if (matchesKey(data, Key.down)) {
                if (filtered.length > 0) {
                  selectedIndex =
                    selectedIndex === filtered.length - 1 ? 0 : selectedIndex + 1;
                  updateList();
                  tui.requestRender();
                }
                return;
              }

              // Enter key
              if (matchesKey(data, Key.enter)) {
                const choice = filtered[selectedIndex];
                if (choice) {
                  done(choice.value);
                }
                return;
              }

              // Escape key or Ctrl+C -> cancel (back)
              if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
                done(undefined);
                return;
              }

              // Normal text input into search box
              input.handleInput(data);
              filterItems(input.getValue());
              tui.requestRender();
            },
          };
        },
      )) ?? undefined
    );
  }

  // Fallback for non-custom UI environments
  const selectedLabel = await ctx.ui.select(
    title,
    items.map((i) => (i.description ? `${i.label} (${i.description})` : i.label)),
  );
  if (!selectedLabel) return undefined;

  const found = items.find(
    (i) =>
      i.label === selectedLabel ||
      `${i.label} (${i.description})` === selectedLabel,
  );
  return found?.value;
}
