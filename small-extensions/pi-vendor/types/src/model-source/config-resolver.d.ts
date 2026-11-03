export type CredentialPath = {
    kind: "apiKey";
} | {
    kind: "header";
    name: string;
};
export type CommandRunner = (commandBody: string, options: {
    signal: AbortSignal;
    timeoutMs: number;
    maxStdoutBytes: number;
}) => Promise<string>;
export type ConfigValueResolver = (value: string, context: {
    path: CredentialPath;
    initialValue?: string;
    providerEnv: Record<string, string | undefined>;
    processEnv: Record<string, string | undefined>;
    signal: AbortSignal;
    runCommand: CommandRunner;
}) => Promise<string>;
export type ResolveResult = {
    kind: "resolved";
    value: string;
    source: "literal" | "env" | "command";
} | {
    kind: "unresolved";
    reason: string;
};
export type CommandResolutionKind = "timeout" | "aborted";
export declare class CommandResolutionError extends Error {
    readonly kind: CommandResolutionKind;
    constructor(kind: CommandResolutionKind);
}
/** Encode a literal so Pi will not interpret leading ! or $ references. */
export { encodeConfigLiteral } from "../shared/vendor-shared.js";
export declare function createProductionCommandRunner(): CommandRunner;
export declare function resolveConfigValue(value: string, context: {
    path: CredentialPath;
    initialValue?: string;
    providerEnv: Record<string, string | undefined>;
    processEnv: Record<string, string | undefined>;
    signal: AbortSignal;
    runCommand: CommandRunner;
}): Promise<ResolveResult>;
export type CommandTrustPath = {
    path: CredentialPath;
    rawValue: string;
};
/**
 * Collect all command-bearing paths from a provider config.
 * Fixed surfaces: apiKey + each exact header name.
 */
export declare function collectCommandPaths(provider: {
    apiKey?: string;
    headers?: Record<string, string>;
}): CommandTrustPath[];
/**
 * Verify that all command-bearing paths in the current provider match
 * the initial (trusted) provider snapshot.
 *
 * A path is trusted only if:
 * - It exists in the initial provider with the exact same structured path
 * - The raw value is identical (byte-exact match)
 *
 * Returns the list of trusted paths.
 */
export declare function preflightCommandTrust(currentProvider: {
    apiKey?: string;
    headers?: Record<string, string>;
}, initialProvider: {
    apiKey?: string;
    headers?: Record<string, string>;
}): CommandTrustPath[];
/**
 * Check if all command paths are trusted.
 * If ANY path is not trusted, returns false (fail-closed).
 */
export declare function allCommandsTrusted(currentProvider: {
    apiKey?: string;
    headers?: Record<string, string>;
}, initialProvider: {
    apiKey?: string;
    headers?: Record<string, string>;
}): boolean;
