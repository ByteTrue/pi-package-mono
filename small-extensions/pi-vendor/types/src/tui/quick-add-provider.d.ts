import type { ModelsJson } from "../models-json.js";
import { type AcquireOptions } from "./model-pick.js";
import type { QuickUI } from "./quick-adapter.js";
export type AddProviderResult = {
    kind: "saved";
    models: ModelsJson;
} | {
    kind: "cancelled";
};
/**
 * Create one provider with exactly one model. Esc at any step cancels with
 * zero writes; to add more models, run the flow again or ask the agent.
 */
export declare function runAddProviderFlow(ui: QuickUI, models: ModelsJson, options?: AcquireOptions): Promise<AddProviderResult>;
