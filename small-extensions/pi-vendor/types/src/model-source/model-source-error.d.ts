export type ModelSourceErrorCode = "invalid_request" | "catalog_unavailable" | "credential_unresolved" | "upstream_timeout" | "upstream_too_large" | "upstream_failed" | "aborted";
export declare class ModelSourceError extends Error {
    readonly code: ModelSourceErrorCode;
    readonly status?: number;
    constructor(code: ModelSourceErrorCode, message: string, status?: number);
}
