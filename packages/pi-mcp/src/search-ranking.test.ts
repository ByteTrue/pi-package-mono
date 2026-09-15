import { describe, it, expect } from "vitest";
import { rankToolMatches, paginate, rankSuggestions, normalizeSearchText, tokenize } from "./search-ranking.js";
import type { SearchState } from "./failure-backoff.js";
import type { ToolMetadata, ServerEntry, McpConfig } from "./types.js";

function makeState(
  servers: Record<string, { tools: ToolMetadata[]; entry?: ServerEntry }>,
  options: { connected?: string[]; failed?: Record<string, number> } = {},
): SearchState {
  const toolMetadata = new Map<string, ToolMetadata[]>();
  const mcpServers: Record<string, ServerEntry> = {};
  for (const [name, s] of Object.entries(servers)) {
    toolMetadata.set(name, s.tools);
    mcpServers[name] = s.entry ?? { command: "x" };
  }
  return {
    toolMetadata,
    config: { mcpServers, settings: undefined },
    failureTracker: new Map(Object.entries(options.failed ?? {})),
    connectedServers: new Set(options.connected ?? []),
  };
}

const tools: ToolMetadata[] = [
  { name: "github_search_code", originalName: "search_code", description: "Search code in repositories" },
  { name: "github_search_issues", originalName: "search_issues", description: "Search issues and PRs" },
  { name: "github_get_file_contents", originalName: "get_file_contents", description: "Get file contents from a repo" },
  { name: "github_resolve-library-id", originalName: "resolve-library-id", description: "Resolve a library identifier" },
];

describe("normalizeSearchText / tokenize (upstream parity)", () => {
  it("splits camelCase, separators, and lowercases", () => {
    expect(normalizeSearchText("getFileContents")).toBe("get file contents");
    expect(normalizeSearchText("search_code.v2")).toBe("search code v2");
    expect(tokenize("Search-Issues!")).toEqual(["search", "issues"]);
  });
});

describe("rankToolMatches", () => {
  it("matches every word, ranks name hits above description hits", () => {
    const state = makeState({ github: { tools } });
    expect(rankToolMatches(state, "search code")[0]?.tool.name).toBe("github_search_code");
    expect(rankToolMatches(state, "search issues")[0]?.tool.name).toBe("github_search_issues");
  });

  it("fuzzy-matches across hyphens and underscores", () => {
    const state = makeState({ github: { tools } });
    const hits = rankToolMatches(state, "resolve library id");
    expect(hits[0]?.tool.name).toBe("github_resolve-library-id");
  });

  it("uses configured searchKeywords vocabulary", () => {
    const state = makeState({
      github: {
        tools,
        entry: { command: "x", searchKeywords: { search_code: ["grep"], "*": ["gh"] } },
      },
    });
    expect(rankToolMatches(state, "grep")[0]?.tool.name).toBe("github_search_code");
    expect(rankToolMatches(state, "gh").map((h) => h.tool.name)).toContain("github_search_issues");
  });

  it("excludes servers in active failure backoff", () => {
    const state = makeState({ github: { tools } }, { failed: { github: Date.now() } });
    expect(rankToolMatches(state, "search code")).toEqual([]);
  });

  it("includes connected servers that failed long ago (backoff expired)", () => {
    const state = makeState(
      { github: { tools } },
      { failed: { github: Date.now() - 120_000 }, connected: ["github"] },
    );
    // connected servers are never in backoff
    expect(rankToolMatches(state, "search code").length).toBeGreaterThan(0);
  });

  it("respects a server filter", () => {
    const other = [{ name: "other_search_code", originalName: "search_code", description: "Another" }];
    const state = makeState({ github: { tools }, other: { tools: other } });
    const hits = rankToolMatches(state, "search code", "other");
    expect(hits.every((h) => h.server === "other")).toBe(true);
  });
});

describe("paginate", () => {
  it("slices with total and nextOffset", () => {
    const items = [1, 2, 3, 4, 5];
    expect(paginate(items, 0, 2)).toEqual({ items: [1, 2], total: 5, hasMore: true, nextOffset: 2 });
    expect(paginate(items, 4, 2)).toEqual({ items: [5], total: 5, hasMore: false, nextOffset: null });
    expect(paginate(items, 10, 2)).toEqual({ items: [], total: 5, hasMore: false, nextOffset: null });
  });
});

describe("rankSuggestions", () => {
  it("strips a known server prefix before ranking (misses stay empty)", () => {
    const state = makeState({ github: { tools } });
    // A typo'd stem ("serch") matches nothing under word-level matching —
    // upstream ranks on tokens, not edit distance.
    expect(rankSuggestions(state, "github_serch_code", 5)).toEqual([]);
    // A prefix-stripped query ranks the right tool.
    expect(rankSuggestions(state, "github_search_code", 5)).toEqual(["github_search_code"]);
  });

  it("ranks on the raw name when no prefix matches", () => {
    const state = makeState({ github: { tools } });
    const suggestions = rankSuggestions(state, "search issue", 5);
    expect(suggestions[0]).toBe("github_search_issues");
  });
});
