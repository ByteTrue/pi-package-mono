import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBrowserCommand } from "./browser-command.js";
import type { ExecFn } from "./env.js";
import { agentBrowserConfigPath } from "./paths.js";
import { notifyLeftoverSessions } from "./sessions.js";

export default function registerPiBrowser(pi: ExtensionAPI): void {
  registerBrowserCommand(pi);

  const exec: ExecFn = (command, args, options) => pi.exec(command, args, options);
  pi.on("session_start", (event, ctx) => {
    // Reload re-fires session_start; do not repeat the same heads-up.
    if (event.reason === "reload" || !ctx.hasUI) return;
    void notifyLeftoverSessions(
      exec,
      agentBrowserConfigPath(),
      (message, level) => ctx.ui.notify(message, level),
    ).catch(() => undefined);
  });
}
