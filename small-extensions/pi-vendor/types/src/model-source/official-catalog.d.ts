import type { ProviderModelConfig } from "../models-json.js";
export type OfficialModelConfig = Record<string, unknown> & {
    id: string;
    name?: string;
    api?: string;
    provider?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    apiKey?: string;
    authHeader?: boolean;
    contextWindow?: number;
    maxTokens?: number;
};
export type OfficialModelsCatalog = Record<string, Record<string, OfficialModelConfig>>;
export type OfficialModelCandidate = {
    provider: string;
    model: OfficialModelConfig;
};
export declare function resolveCandidateRoots(): string[];
export declare function findOfficialCatalogPath(roots?: readonly string[]): string | null;
export declare function loadOfficialCatalog(): Promise<OfficialModelsCatalog | null>;
export declare function collectOfficialCandidates(catalog: OfficialModelsCatalog | null | undefined, modelId: string): OfficialModelCandidate[];
export declare function stripOfficialRoutingFields(model: OfficialModelConfig): ProviderModelConfig;
export declare function formatOfficialCandidate(candidate: OfficialModelCandidate): string;
