export type OpenAIModelsProviderDraft = {
	baseUrl?: string;
	apiKey?: string;
};

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<{
	ok: boolean;
	status: number;
	statusText: string;
	json(): Promise<unknown>;
}>;

export function buildOpenAIModelsUrl(baseUrl: string): string {
	const url = new URL(baseUrl);
	if (!url.pathname.endsWith("/")) {
		url.pathname += "/";
	}
	return new URL("models", url).toString();
}

export function resolveApiKeyValue(apiKey: string, env: NodeJS.ProcessEnv = process.env): { value: string; source: "literal" | "env" } {
	const trimmed = apiKey.trim();
	if (!trimmed) {
		throw new Error("Missing API key");
	}

	const match = trimmed.match(/^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/);
	if (!match) {
		return { value: trimmed, source: "literal" };
	}

	const name = match[1] ?? match[2];
	if (!name) {
		throw new Error("Missing API key");
	}
	const value = env[name];
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Environment variable ${name} is not set`);
	}
	return { value: value.trim(), source: "env" };
}
export function parseOpenAIModelsResponse(payload: unknown): string[] {
	if (!payload || typeof payload !== "object") return [];
	const data = (payload as { data?: unknown }).data;
	if (!Array.isArray(data)) return [];

	const ids = new Set<string>();
	for (const entry of data) {
		if (!entry || typeof entry !== "object") continue;
		const id = (entry as { id?: unknown }).id;
		if (typeof id === "string" && id.trim()) {
			ids.add(id.trim());
		}
	}
	return [...ids].sort((a, b) => a.localeCompare(b));
}

export async function fetchOpenAIModelIds(
	provider: OpenAIModelsProviderDraft,
	fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<string[]> {
	if (!provider.baseUrl?.trim()) {
		throw new Error("Missing provider base URL");
	}
	if (!provider.apiKey?.trim()) {
		throw new Error("Missing provider API key");
	}

	const { value: apiKey } = resolveApiKeyValue(provider.apiKey);
	const endpoint = buildOpenAIModelsUrl(provider.baseUrl.trim());
	const response = await fetchImpl(endpoint, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch ${endpoint}: ${response.status} ${response.statusText}`.trim());
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to parse ${endpoint} response: ${message}`);
	}

	return parseOpenAIModelsResponse(payload);
}
