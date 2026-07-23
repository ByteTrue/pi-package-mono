import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPtySpawnTool } from "./tools/pty-spawn.js";
import { registerPtyListTool } from "./tools/pty-list.js";
import { registerPtyReadTool } from "./tools/pty-read.js";
import { registerPtyWriteTool } from "./tools/pty-write.js";
import { registerPtyKillTool } from "./tools/pty-kill.js";

export function registerTools(pi: ExtensionAPI): void {
  registerPtySpawnTool(pi);
  registerPtyListTool(pi);
  registerPtyReadTool(pi);
  registerPtyWriteTool(pi);
  registerPtyKillTool(pi);
}
