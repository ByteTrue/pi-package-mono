import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands.js";
import { manager } from "./pty/manager.js";
import { registerMessageRenderers } from "./renderers.js";
import { registerTools } from "./register-tools.js";
import { stopMonitorServer } from "./web/server/monitor.js";

export default function registerBackgroundTerminal(pi: ExtensionAPI): void {
  manager.init(pi);
  registerTools(pi);
  registerCommands(pi);
  registerMessageRenderers(pi);

  pi.on("session_start", async (_event, ctx) => {
    manager.setCurrentSessionId(ctx.sessionManager.getSessionId());
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    manager.clearAllSessions(sessionId);
    manager.setCurrentSessionId(null);
    await stopMonitorServer();
  });
}
