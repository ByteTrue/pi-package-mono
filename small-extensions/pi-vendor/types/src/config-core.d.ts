import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { ModelsJson } from "./models-json.js";
export type ConfigRevision = "missing" | `sha256:${string}`;
export type ModelsSnapshot = {
    models: ModelsJson;
    revision: ConfigRevision;
};
/** Pi's published models.json schema; also the value written as `$schema`. */
export declare const MODELS_JSON_SCHEMA_URL = "https://pi.dev/schemas/models.schema.json";
export type ConfigIssueCode = "invalid_structure" | "duplicate_model_id" | "invalid_cost";
export type ConfigIssue = {
    path: string;
    code: ConfigIssueCode;
    message: string;
};
export type ConfigErrorCode = "invalid_config" | "invalid_revision" | "config_changed" | "read_failed" | "write_failed";
export declare class ConfigCoreError extends Error {
    readonly code: ConfigErrorCode;
    readonly path?: string;
    readonly issues?: ConfigIssue[];
    constructor(code: ConfigErrorCode, message: string, options?: {
        path?: string;
        issues?: ConfigIssue[];
    });
}
type ConfigCoreDependencies = {
    readFile: typeof readFileSync;
    writeFile: typeof writeFileSync;
    rename: typeof renameSync;
    unlink: typeof unlinkSync;
    mkdir: typeof mkdirSync;
};
export declare function validateModelsJson(models: unknown): ConfigIssue[];
/**
 * Add `$schema` to a brand-new document so editors validate and complete the
 * file. Existing files are left byte-identical: the user may have pointed
 * `$schema` somewhere else, or omitted it on purpose.
 */
export declare function withSchemaHint(models: ModelsJson): ModelsJson;
export declare function readModelsSnapshot(path?: string): ModelsSnapshot;
export declare function commitModelsSnapshot(input: {
    models: ModelsJson;
    expectedRevision: ConfigRevision;
}, path?: string): ModelsSnapshot;
export declare function createConfigCoreForTesting(dependencies?: Partial<ConfigCoreDependencies>): {
    readModelsSnapshot: (path: string) => ModelsSnapshot;
    commitModelsSnapshot: (input: {
        models: ModelsJson;
        expectedRevision: ConfigRevision;
    }, path: string) => ModelsSnapshot;
};
export {};
