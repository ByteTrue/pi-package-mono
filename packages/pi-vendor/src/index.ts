import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerVendorCommand } from "./command.js";

export default function registerVendor(pi: ExtensionAPI): void {
	registerVendorCommand(pi);
}
