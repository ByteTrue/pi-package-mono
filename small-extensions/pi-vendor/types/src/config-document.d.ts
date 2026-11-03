/**
 * Pure provider/model document mutations used by the /vendor quick flows.
 */
import type { ModelsJson, ProviderConfig, ProviderModelConfig } from "./models-json.js";
export type ConflictPolicy = "reject" | "overwrite-confirmed";
export type MutationErrorCode = "invalid_provider_key" | "invalid_model_id" | "provider_not_found" | "model_not_found" | "provider_exists" | "model_exists";
export type MutationError = {
    code: MutationErrorCode;
    path: string;
    message: string;
};
export type MutationResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: MutationError;
};
export declare function createProvider(models: ModelsJson, key: string, config: ProviderConfig): MutationResult<ModelsJson>;
export declare function addModel(models: ModelsJson, provider: string, model: ProviderModelConfig): MutationResult<ModelsJson>;
export declare function replaceModel(models: ModelsJson, provider: string, previousId: string, model: ProviderModelConfig, options?: {
    conflict?: ConflictPolicy;
}): MutationResult<ModelsJson>;
