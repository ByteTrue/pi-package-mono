import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerVendorCommand } from "./command.js";
import { registerVendorTools } from "./tools.js";

export default function registerVendor(pi: ExtensionAPI): void {
	registerVendorCommand(pi);
	registerVendorTools(pi);
}
