import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PTY_OPEN_BACKGROUND_SPY_COMMAND, PTY_SHOW_SERVER_URL_COMMAND } from "./constants.js";
import { openBrowser } from "./browser.js";
import { ensureMonitorServer } from "./web/server/monitor.js";

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand(PTY_OPEN_BACKGROUND_SPY_COMMAND, {
    description: "Open the PTY Sessions web interface in your default browser",
    handler: async (_args, ctx) => {
      const server = await ensureMonitorServer({
        parentSessionId: ctx.sessionManager.getSessionId(),
        defaultWorkdir: ctx.cwd,
      });
      const opened = await openBrowser(server.url);
      if (ctx.hasUI) {
        ctx.ui.notify(
          opened
            ? "Opened PTY Sessions web interface."
            : `PTY Sessions web interface: ${server.url}`,
          "info",
        );
      }
    },
  });

  pi.registerCommand(PTY_SHOW_SERVER_URL_COMMAND, {
    description: "Show the PTY Sessions web interface URL",
    handler: async (_args, ctx) => {
      const server = await ensureMonitorServer({
        parentSessionId: ctx.sessionManager.getSessionId(),
        defaultWorkdir: ctx.cwd,
      });
      if (ctx.hasUI) ctx.ui.notify(`PTY Sessions web interface: ${server.url}`, "info");
    },
  });
}
