// One generic JSON search provider (BYTE-6 Lean): the seven JSON API providers
// are the same shape — build a request, throw on !ok, read a bounded JSON body,
// map result fields. A provider is fully described by the spec below; each
// former per-provider file is now a thin instantiation for backwards-compatible
// imports (tests, factory) and clearer stack traces.

import { fetchWithProxy as fetch } from "../proxy.js";
import { MAX_SEARCH_RESPONSE_BODY_BYTES, readResponseJson, readResponseText } from "../response-body.js";
import type { SearchProvider, SearchResult } from "./types.js";

export interface JsonProviderSpec {
	/** Registry name (reported in errors and diagnostics). */
	name: string;
	/** Human label used in error messages. */
	label: string;
	/** Missing-key error prefix; when omitted the provider is keyless. */
	envVar?: string;
	/** Request target. A function form receives (query, maxResults, baseUrl). */
	url: string | ((query: string, maxResults: number, baseUrl: string | undefined) => string);
	/** HTTP method; defaults to POST for bodies, GET otherwise. */
	method?: "GET" | "POST";
	/** Static headers; the auth header (below) is injected from the credential. */
	headers?: Record<string, string>;
	/** Which header carries the API key ("authorization" gets a Bearer prefix). */
	authHeaderName?: string;
	/** JSON request body for POSTs. */
	body?: (query: string, maxResults: number) => unknown;
	/** Query params for GETs (values stringified, empty values skipped). */
	queryParams?: (query: string, maxResults: number) => Record<string, string>;
	/** Where the result array lives in the response (dotted path). */
	resultsPath: string;
	/** Field mapping off each result object. */
	fields: { title?: string; url?: string; snippet?: string | string[] };
	/** Cap results to maxResults after mapping. */
	slice?: boolean;
	/** Optional extra hint appended to the HTTP error message. */
	errorHint?: string;
}

function readDottedPath(raw: unknown, path: string): unknown {
	let current: unknown = raw;
	for (const segment of path.split(".")) {
		if (current === null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function firstString(value: unknown): string {
	if (Array.isArray(value)) {
		for (const item of value) {
			if (typeof item === "string" && item) return item;
		}
		return "";
	}
	return typeof value === "string" ? value : "";
}

export class JsonSearchProvider implements SearchProvider {
	readonly name: string;
	readonly label: string;
	private readonly apiKey: string;
	private readonly baseUrl: string | undefined;
	private readonly spec: JsonProviderSpec;

	constructor(spec: JsonProviderSpec, apiKey = "", baseUrl?: string) {
		this.spec = spec;
		this.name = spec.name;
		this.label = spec.label;
		this.apiKey = apiKey;
		this.baseUrl = baseUrl;
	}

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
		if (this.spec.envVar && !this.apiKey) {
			throw new Error(`${this.spec.envVar} is not set. Run /web to configure a key, or export ${this.spec.envVar}.`);
		}
		const target = typeof this.spec.url === "function" ? this.spec.url(query, maxResults, this.baseUrl) : this.spec.url;
		let url = target;
		const headers: Record<string, string> = { ...this.spec.headers };
		if (this.spec.authHeaderName && this.apiKey) {
			headers[this.spec.authHeaderName] = this.spec.authHeaderName.toLowerCase() === "authorization"
				? `Bearer ${this.apiKey}`
				: this.apiKey;
		}
		let init: RequestInit;
		if (this.spec.method === "GET") {
			if (this.spec.queryParams) {
				const params = new URLSearchParams();
				for (const [key, value] of Object.entries(this.spec.queryParams(query, maxResults))) {
					if (value !== "") params.set(key, value);
				}
				url = `${url}?${params.toString()}`;
			}
			init = { method: "GET", headers, signal };
		} else {
			headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
			init = { method: "POST", headers, body: JSON.stringify((this.spec.body ?? ((q, n) => ({ query: q, count: n })))(query, maxResults)), signal };
		}
		const res = await fetch(url, init);
		if (!res.ok) {
			await readResponseText(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
			throw new Error(`${this.label} search error (${res.status})${this.spec.errorHint ?? ""}`);
		}
		const raw = await readResponseJson<unknown>(res, MAX_SEARCH_RESPONSE_BODY_BYTES);
		const list = readDottedPath(raw, this.spec.resultsPath);
		if (!Array.isArray(list)) return [];
		const mapped: SearchResult[] = list.map((item) => {
			const record = (item ?? {}) as Record<string, unknown>;
			return {
				title: firstString(this.spec.fields.title ? record[this.spec.fields.title] : undefined),
				url: firstString(this.spec.fields.url ? record[this.spec.fields.url] : undefined),
				snippet: firstString(
					this.spec.fields.snippet === undefined
						? undefined
						: Array.isArray(this.spec.fields.snippet)
							? this.spec.fields.snippet.map((field) => record[field])
							: record[this.spec.fields.snippet],
				),
			};
		});
		return this.spec.slice === false ? mapped : mapped.slice(0, maxResults);
	}
}
