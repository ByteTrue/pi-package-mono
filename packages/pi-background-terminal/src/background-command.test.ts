import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { manager } from "./background/manager.js";
import { runBackgroundCommand } from "./background-command.js";

const SESSION_ID = "background-command-test-session";

function makeContext(
  select: (title: string, options: string[]) => string | undefined,
  confirm = true,
) {
  const ui = {
    select: vi.fn(async (title: string, options: string[]) => select(title, options)),
    confirm: vi.fn(async () => confirm),
    editor: vi.fn(async () => undefined),
    notify: vi.fn(),
  };
  const ctx = {
    hasUI: true,
    sessionManager: { getSessionId: () => SESSION_ID },
    ui,
  } as unknown as ExtensionCommandContext;
  return { ctx, ui };
}

describe("/background command", () => {
  afterEach(async () => {
    await manager.clearSession(SESSION_ID);
  });

  it("lists a command, opens its output, then returns through the menus", async () => {
    manager.init(() => {});
    const started = manager.start('node -e "console.log(\'menu output\')"', process.cwd(), SESSION_ID, 30);
    await vi.waitFor(() => expect(manager.get(started.id, SESSION_ID)?.status).toBe("exited"), { timeout: 8000 });

    let selectCount = 0;
    const { ctx, ui } = makeContext((_title, options) => {
      selectCount += 1;
      if (selectCount === 1) return options[0];
      if (selectCount === 2) {
        expect(options).toEqual(["View output", "Back"]);
        return "View output";
      }
      return options.at(-1);
    });

    await runBackgroundCommand(ctx);

    expect(ui.editor).toHaveBeenCalledWith(expect.stringContaining("Output"), expect.stringContaining("menu output"));
    expect(ui.confirm).not.toHaveBeenCalled();
  });

  it("kills the selected running command without asking the user for an id", async () => {
    manager.init(() => {});
    const started = manager.start('node -e "setInterval(() => {}, 1000)"', process.cwd(), SESSION_ID);

    let selectCount = 0;
    const { ctx, ui } = makeContext((_title, options) => {
      selectCount += 1;
      if (selectCount === 1) return options[0];
      if (selectCount === 2) return "Kill";
      return options.at(-1);
    });

    await runBackgroundCommand(ctx);

    await vi.waitFor(() => expect(manager.get(started.id, SESSION_ID)?.status).toBe("killed"), { timeout: 8000 });
    expect(ui.confirm).toHaveBeenCalledOnce();
    expect(ui.notify).toHaveBeenCalledWith("Background command stopped.", "info");
  });

  it("returns to the menu when stopping a command is canceled", async () => {
    manager.init(() => {});
    const started = manager.start('node -e "setInterval(() => {}, 1000)"', process.cwd(), SESSION_ID);

    let selectCount = 0;
    const { ctx, ui } = makeContext(
      (_title, options) => {
        selectCount += 1;
        if (selectCount === 1) return options[0];
        if (selectCount === 2) return "Kill";
        return options.at(-1);
      },
      false,
    );

    await runBackgroundCommand(ctx);

    expect(manager.get(started.id, SESSION_ID)?.status).toBe("running");
    expect(ui.confirm).toHaveBeenCalledOnce();
    expect(ui.notify).not.toHaveBeenCalled();
  });
  it("reports an empty list without opening a command menu", async () => {
    const { ctx, ui } = makeContext(() => undefined);

    await runBackgroundCommand(ctx);

    expect(ui.notify).toHaveBeenCalledWith("No background commands.", "info");
  });
});
