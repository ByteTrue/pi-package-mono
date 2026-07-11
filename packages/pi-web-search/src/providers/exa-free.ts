/**
 * Exa MCP Free — keyless web search via Exa's hosted MCP endpoint.
 *
 * Exa exposes `https://mcp.exa.ai/mcp` as a Streamable HTTP MCP server with a
 * generous free tier (rate-limited, no API key). We speak the minimal MCP
 * protocol needed: initialize → notifications/initialized → tools/call.
 *
 * The `web_search_exa` tool returns markdown-formatted text. We parse titles,
 * URLs, and snippets from it. Fragile if Exa changes their output format, but
 * the quality is far better than HTML scraping and it costs nothing.
 *
 * ponytail: session-per-search (3 round trips). Fine for agent use where
 * searches are infrequent. Could cache sessions if throughput ever matters.
 */

import { fetchWithProxy as fetch } from "../proxy.js";
import type { SearchProvider, SearchResponse, SearchResult } from "./types.js";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const PROTOCOL_VERSION = "2025-03-26";
const CLIENT_NAME = "pi-web-search";
const CLIENT_VERSION = "1.0.0";

const RATE_LIMIT_HINT =
	"Exa MCP free tier rate-limited the request. " +
	"Wait a moment and retry, or run /web to configure a key-backed provider (Tavily, Exa, Brave) for higher reliability.";

// ---------------------------------------------------------------------------
// Minimal MCP Streamable HTTP client
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: number;
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id?: number;
	result?: {
		content?: Array<{ type: string; text?: string }>;
		[key: string]: unknown;
	};
	error?: { code: number; message: string; data?: unknown };
}

let nextId = 1;

async function mcpPost(
	body: JsonRpcRequest,
	sessionId: string | undefined,
	signal?: AbortSignal,
): Promise<{ json: JsonRpcResponse; sessionId: string | undefined }> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
	};
	if (sessionId) headers["Mcp-Session-Id"] = sessionId;

	const res = await fetch(EXA_MCP_URL, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal,
	});

	if (res.status === 429) throw new Error(RATE_LIMIT_HINT);
	if (!res.ok) throw new Error(`Exa MCP HTTP error (${res.status}): ${await res.text()}`);

	const newSessionId = res.headers.get("Mcp-Session-Id") ?? sessionId ?? undefined;
	const contentType = res.headers.get("Content-Type") ?? "";

	// SSE response: extract the last JSON-RPC message from data: lines.
	if (contentType.includes("text/event-stream")) {
		const raw = await res.text();
		const dataLines = raw.split("\n").filter((l) => l.startsWith("data: "));
		const lastData = dataLines[dataLines.length - 1]?.slice(6);
		if (!lastData) throw new Error("Exa MCP: empty SSE response");
		const parsed = JSON.parse(lastData) as JsonRpcResponse;
		if (parsed.error) throw new Error(`Exa MCP: ${parsed.error.message}`);
		return { json: parsed, sessionId: newSessionId };
	}

	const parsed = (await res.json()) as JsonRpcResponse;
	if (parsed.error) throw new Error(`Exa MCP: ${parsed.error.message}`);
	return { json: parsed, sessionId: newSessionId };
}

async function mcpNotify(
	method: string,
	params: unknown,
	sessionId: string,
	signal?: AbortSignal,
): Promise<void> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"Mcp-Session-Id": sessionId,
		Accept: "application/json, text/event-stream",
	};
	const res = await fetch(EXA_MCP_URL, {
		method: "POST",
		headers,
		body: JSON.stringify({ jsonrpc: "2.0", method, params } as JsonRpcRequest),
		signal,
	});
	// Notifications don't require a response body. Swallow errors.
	if (!res.ok) {
		// Non-fatal: some servers still process the notification.
		await res.text().catch(() => {});
	}
}

// ---------------------------------------------------------------------------
// Result parsing — Exa returns markdown with [Title](URL) patterns + content.
// ---------------------------------------------------------------------------

function parseSearchText(text: string): SearchResult[] {
	const results: SearchResult[] = [];
	// Current Exa MCP output uses blocks like:
	// Title: ...
	// URL: ...
	// Highlights: ...
	for (const block of text.split(/\n---+\n/)) {
		const title = block.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
		const url = block.match(/^URL:\s*(https?:\/\/\S+)$/m)?.[1]?.trim();
		if (!title || !url) continue;
		const highlightsAt = block.search(/^Highlights:\s*/m);
		const snippet =
			highlightsAt >= 0 ? block.slice(highlightsAt).replace(/^Highlights:\s*/m, "").replace(/\s+/g, " ").trim() : "";
		results.push({ title, url, snippet: snippet.slice(0, 300) });
	}
	if (results.length > 0) return results.slice(0, 10);
	results.length = 0;
	// Strategy 1: markdown links [Title](URL) with following content.
	const linkRe = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
	const matches: Array<{ title: string; url: string; index: number; end: number }> = [];
	let m: RegExpExecArray | null;
	while ((m = linkRe.exec(text)) !== null) {
		matches.push({ title: m[1]!.trim(), url: m[2]!.trim(), index: m.index, end: linkRe.lastIndex });
	}

	if (matches.length === 0) {
		// Strategy 2: bare URLs on their own lines.
		const urlRe = /^(https?:\/\/\S+)/gm;
		while ((m = urlRe.exec(text)) !== null) {
			results.push({ title: m[1]!, url: m[1]!, snippet: "" });
		}
		return results.slice(0, 10);
	}

	for (let i = 0; i < matches.length; i++) {
		const cur = matches[i]!;
		const snippetStart = cur.end;
		const snippetEnd = i + 1 < matches.length ? matches[i + 1]!.index : text.length;
		const rawSnippet = text.slice(snippetStart, snippetEnd).replace(/^[\s:|\-–—]+/, "").trim();
		// Collapse whitespace, cap at 300 chars.
		const snippet = rawSnippet.replace(/\s+/g, " ").slice(0, 300);
		results.push({ title: cur.title, url: cur.url, snippet });
	}

	return results;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ExaMcpFreeProvider implements SearchProvider {
	readonly name = "exa-free";
	readonly label = "Exa (free, no key)";

	async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
		// 1. Initialize MCP session.
		const init = await mcpPost(
			{
				jsonrpc: "2.0",
				id: nextId++,
				method: "initialize",
				params: {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
				},
			},
			undefined,
			signal,
		);

		const sessionId = init.sessionId;
		if (!sessionId) throw new Error("Exa MCP: no session ID returned from initialize");

		// 2. Acknowledge initialization (fire-and-forget notification).
		await mcpNotify("notifications/initialized", {}, sessionId, signal);

		// 3. Call web_search_exa.
		const callResult = await mcpPost(
			{
				jsonrpc: "2.0",
				id: nextId++,
				method: "tools/call",
				params: {
					name: "web_search_exa",
					arguments: { query, numResults: maxResults },
				},
			},
			sessionId,
			signal,
		);

		const textContent = callResult.json.result?.content?.find((c) => c.type === "text")?.text ?? "";
		if (!textContent) {
			return { query, results: [] };
		}

		const results = parseSearchText(textContent).slice(0, maxResults);
		return { query, results };
	}
}
