import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBashDefaultTimeout } from "./bash-default-timeout.js";

/**
 * Optional 300s default-and-cap for Pi's built-in bash/powershell tools.
 *
 * Split out of @bytetrue/pi-background-terminal (BYTE-10) so the installed
 * background-terminal package physically contains no hook source (GitHub #3):
 * a setup whose architecture checks statically scan installed source can leave
 * this package out entirely, and the cap is simply not there. Installing both
 * packages restores the exact pre-0.12 combined behavior.
 *
 * This package registers nothing — no tools, no commands, no settings. Two
 * event hooks are its whole surface.
 */
export default function registerBashTimeout(pi: ExtensionAPI): void {
  registerBashDefaultTimeout(pi);
}
