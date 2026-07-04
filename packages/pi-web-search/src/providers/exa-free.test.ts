import { afterEach, describe, expect, it, vi } from "vitest";
import { ExaMcpFreeProvider } from "./exa-free.js";

const exaText = `Title: CLI – Codex | OpenAI Developers
URL: https://developers.openai.com/codex/cli
Published: N/A
Author: N/A
Highlights:
Codex CLI is OpenAI's coding agent that you can run locally from your terminal.

---

Title: Command line options – Codex CLI | OpenAI Developers
URL: https://developers.openai.com/codex/cli/reference
Published: N/A
Author: N/A
Highlights:
How to read this reference. This page catalogs every documented Codex CLI command and flag.`;

function sse(data: unknown, headers: Record<string, string> = {}): Response {
	return new Response(`event: message\ndata: ${JSON.stringify(data)}\n\n`, {
		status: 200,
		headers: { "Content-Type": "text/event-stream", ...headers },
	});
}

describe("ExaMcpFreeProvider", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("parses Exa MCP Title/URL/Highlights blocks", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				sse(
					{ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26" } },
					{ "Mcp-Session-Id": "session-1" },
				),
			)
			.mockResolvedValueOnce(new Response(null, { status: 202 }))
			.mockResolvedValueOnce(
				sse({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: exaText }] } }),
			);
		vi.stubGlobal("fetch", fetch);

		const { results } = await new ExaMcpFreeProvider().search("codex cli", 2);

		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({
			title: "CLI – Codex | OpenAI Developers",
			url: "https://developers.openai.com/codex/cli",
			snippet: "Codex CLI is OpenAI's coding agent that you can run locally from your terminal.",
		});
		expect(fetch.mock.calls[1]![1]!.headers.Accept).toBe("application/json, text/event-stream");
	});
});
