/**
 * Fuzzy matching utilities for model ID search.
 * Matches if all query characters appear in order (not necessarily consecutive).
 * Lower score = better match.
 */
export type FuzzyMatch = {
    matches: boolean;
    score: number;
};
export declare function fuzzyMatch(query: string, text: string): FuzzyMatch;
export type FuzzyResult<T> = {
    item: T;
    score: number;
};
export declare function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[];
