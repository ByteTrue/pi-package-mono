import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ModelsJson } from "./models-json.js";
import type { QuickUI } from "./tui/quick-adapter.js";
import { type AddModelResult } from "./tui/quick-add-model.js";
/** Select the target provider, then add one model to it. */
export declare function selectProviderAndAddModel(ui: QuickUI, models: ModelsJson): Promise<AddModelResult>;
export declare function registerVendorCommand(pi: ExtensionAPI): void;
