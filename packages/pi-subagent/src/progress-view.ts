import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { renderProgressCard, type SubagentTaskRecord } from "./index.js";

const REFRESH_MS = 500;
/** Card is ~14 lines per run (header, summary, 8 tools, error, history); fixed height avoids ghosting. */
const VIEWPORT_LINES = 16;

/**
 * Live progress view for one task (issue 088). Re-renders from the manager record
 * on a timer while the task runs; the card keeps its familiar compact shape and ends
 * with the full session log path.
 */
export async function showProgressView(ctx: ExtensionCommandContext, task: SubagentTaskRecord): Promise<void> {
  const rawUI = ctx.ui as unknown as Record<string, Function>;
  if (typeof rawUI?.custom !== "function") {
    const text = task.progress ? renderProgressCard(task.progress, 120).join("\n") : "(no progress yet)";
    ctx.ui.notify(text.slice(0, 500), "info");
    return;
  }

  await rawUI.custom(
    (tui: { requestRender: () => void; terminal: { rows: number } }, theme: { fg: (c: string, s: string) => string; bold: (s: string) => string }, _kb: unknown, done: (v: undefined) => void) => {
      let offset = 0;
      let timer: ReturnType<typeof setInterval> | undefined = setInterval(() => {
        if (task.status !== "running" && timer) {
          clearInterval(timer);
          timer = undefined;
        }
        tui.requestRender();
      }, REFRESH_MS);

      const finish = () => {
        if (timer) clearInterval(timer);
        timer = undefined;
        done(undefined);
      };

      return {
        render(width: number): string[] {
          const body = task.progress ? renderProgressCard(task.progress, width) : ["(no progress yet)"];
          const viewport = Math.max(3, Math.min(VIEWPORT_LINES, tui.terminal.rows - 6));
          const maxOffset = Math.max(0, body.length - viewport);
          if (offset > maxOffset) offset = maxOffset;
          const shown = body.slice(offset, offset + viewport);
          const pos = body.length > viewport ? ` · ${offset + 1}-${offset + shown.length}/${body.length}` : "";
          // Constant height: a component that grows between renders leaves the previous
          // frame behind in the scrollback (ghosting), so pad to the viewport every time.
          while (shown.length < viewport) shown.push("");
          const live = task.status === "running" ? theme.fg("accent", " · live") : "";
          return [
            theme.bold(`Subagent ${task.id} [${task.status}]`) + live + theme.fg("dim", pos),
            ...shown,
            theme.fg("dim", "  ↑↓ / PgUp PgDn scroll · Esc back"),
          ];
        },
        invalidate() {},
        handleInput(data: string) {
          const page = Math.max(1, Math.min(VIEWPORT_LINES, tui.terminal.rows - 6));
          if (matchesKey(data, Key.up)) offset = Math.max(0, offset - 1);
          else if (matchesKey(data, Key.down)) offset += 1;
          else if (matchesKey(data, Key.pageUp)) offset = Math.max(0, offset - page);
          else if (matchesKey(data, Key.pageDown)) offset += page;
          else if (matchesKey(data, Key.home)) offset = 0;
          else if (matchesKey(data, Key.end)) offset = Number.MAX_SAFE_INTEGER;
          else if (matchesKey(data, Key.escape) || data === "q" || matchesKey(data, Key.ctrl("c"))) {
            finish();
            return;
          }
          tui.requestRender();
        },
      };
    },
  );
}
