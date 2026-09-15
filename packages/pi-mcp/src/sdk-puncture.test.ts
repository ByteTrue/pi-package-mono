import { describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Server } from "@modelcontextprotocol/server";

/**
 * Puncture #1: prove that the registry-published client@2.0.0 + core@2.0.0
 * (the versions pi-mcp-adapter used before its pkg.pr.new pin) support the
 * full chain this package needs: stdio-agnostic transport, listTools,
 * callTool, listPrompts, getPrompt.
 */

describe("client 2.0.0 formal release capability (puncture #1)", () => {
  async function makePair() {
    const server = new Server(
      { name: "probe-server", version: "0.0.1" },
      { capabilities: { tools: {}, prompts: {} } },
    );

    server.setRequestHandler("tools/list", async () => ({
      tools: [
        {
          name: "echo",
          description: "Echo back the input text",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          } as never,
        },
        {
          name: "big_output",
          description: "Return a huge text blob",
          inputSchema: { type: "object", properties: {} } as never,
        },
      ],
    }));

    server.setRequestHandler("tools/call", async (req) => {
      if (req.params.name === "echo") {
        const text = String((req.params.arguments as Record<string, unknown>)?.text ?? "");
        return { content: [{ type: "text", text: `echo: ${text}` }] };
      }
      if (req.params.name === "big_output") {
        return { content: [{ type: "text", text: "x".repeat(600 * 1024) }] };
      }
      throw new Error(`unknown tool: ${req.params.name}`);
    });

    server.setRequestHandler("prompts/list", async () => ({
      prompts: [
        {
          name: "review",
          description: "Ask for a code review",
          arguments: [{ name: "topic", description: "What to review", required: true }],
        },
      ],
    }));

    server.setRequestHandler("prompts/get", async (req) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `Please review: ${req.params.arguments?.topic ?? ""}` },
        },
      ],
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "probe-client", version: "0.0.1" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return { client, server };
  }

  it("connects, lists tools, and calls a tool end-to-end", async () => {
    const { client } = await makePair();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(["echo", "big_output"]);

    const result = await client.callTool({ name: "echo", arguments: { text: "hello" } });
    const first = result.content?.[0];
    expect(first && first.type === "text" ? first.text : "").toBe("echo: hello");

    await client.close();
  });

  it("returns large outputs intact (guard applies downstream, not in SDK)", async () => {
    const { client } = await makePair();
    const result = await client.callTool({ name: "big_output", arguments: {} });
    const first = result.content?.[0];
    expect(first && first.type === "text" ? first.text.length : 0).toBe(600 * 1024);
    await client.close();
  });

  it("lists and gets prompts (for /mcp__server__prompt commands)", async () => {
    const { client } = await makePair();
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toEqual(["review"]);

    const got = await client.getPrompt({ name: "review", arguments: { topic: "retry logic" } });
    const first = got.messages[0]!;
    expect(first.role).toBe("user");
    expect(
      first.content.type === "text" ? first.content.text.includes("retry logic") : false,
    ).toBe(true);
    await client.close();
  });

  it("surfaces tool-call errors without throwing malformed envelopes", async () => {
    const { client } = await makePair();
    await expect(
      client.callTool({ name: "nope", arguments: {} }),
    ).rejects.toThrow(/unknown tool|nope/i);
    await client.close();
  });
});
