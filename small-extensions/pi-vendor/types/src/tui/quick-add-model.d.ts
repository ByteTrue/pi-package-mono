import type { ModelsJson } from "../models-json.js";
import { type AcquireOptions } from "./model-pick.js";
import type { QuickUI } from "./quick-adapter.js";
export type AddModelResult = {
    kind: "saved";
    models: ModelsJson;
} | {
    kind: "cancelled";
};
/**
 * Add exactly one model to an existing provider. Esc at any step cancels with
 * zero writes; to add more models, run the flow again or ask the agent.
 *
 * `initialProvider` is the on-disk credential snapshot, required before any
 * `!command` credential of this provider may be executed for discovery.
 */
export declare function runAddModelFlow(ui: QuickUI, providerKey: string, models: ModelsJson, initialProvider?: {
    apiKey?: string;
    headers?: Record<string, string>;
}, options?: AcquireOptions): Promise<AddModelResult>;
