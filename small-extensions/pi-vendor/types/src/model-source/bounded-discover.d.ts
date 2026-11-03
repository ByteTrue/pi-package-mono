export type BoundedFetchResponse = {
    ok: boolean;
    status: number;
    headers: Headers;
    body: ReadableStream<Uint8Array> | null;
};
export type BoundedFetch = (input: string, init: {
    method: "GET";
    headers: Record<string, string>;
    redirect: "error";
    signal: AbortSignal;
}) => Promise<BoundedFetchResponse>;
export type DiscoverOptions = {
    initialProvider?: {
        apiKey?: string;
        headers?: Record<string, string>;
    };
    providerEnv?: Record<string, string | undefined>;
    signal?: AbortSignal;
    fetchImpl?: BoundedFetch;
    runCommand?: (body: string, opts: {
        signal: AbortSignal;
        timeoutMs: number;
        maxStdoutBytes: number;
    }) => Promise<string>;
};
export declare function discoverModelIds(provider: {
    baseUrl: string;
    api?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    authHeader?: boolean;
}, options?: DiscoverOptions): Promise<string[]>;
