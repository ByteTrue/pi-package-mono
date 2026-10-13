import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import askUserExtension, { askUserExecute, type AskUserParams } from "./pi-ask-user.js";

interface UICall {
  method: "select" | "input" | "editor";
  args: unknown[];
}

/**
 * Dialog-capable ctx fake: records every ctx.ui call and answers them from
 * `replies` in order. select replies come back as the row the "user" picked.
 */
function ctxWithRecorder(
  replies: { select?: string; input?: string; editor?: string },
  overrides: Partial<ExtensionContext> = {},
): { ctx: ExtensionContext; calls: UICall[] } {
  const calls: UICall[] = [];
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      async select(title: string, options: string[]) {
        calls.push({ method: "select", args: [title, options] });
        return replies.select;
      },
      async input(title: string, placeholder?: string) {
        calls.push({ method: "input", args: [title, placeholder] });
        return replies.input;
      },
      async editor(title: string) {
        calls.push({ method: "editor", args: [title] });
        return replies.editor;
      },
    },
    ...overrides,
  } as unknown as ExtensionContext;
  return { ctx, calls };
}

function harness() {
  let tool: (ToolDefinition & { execute: (id: string, params: unknown, s: AbortSignal, u: unknown, ctx: ExtensionContext) => Promise<unknown> }) | undefined;
  const pi = {
    registerTool(t: unknown) {
      tool = t as never;
    },
  } as unknown as ExtensionAPI;
  askUserExtension(pi);
  if (!tool) throw new Error("ask_user tool was not registered");
  return tool;
}

describe("registration", () => {
  it("registers ask_user with a plain JSON schema (no runtime TypeBox symbols)", () => {
    const tool = harness();
    expect(tool.name).toBe("ask_user");
    expect(tool.promptSnippet).toBeTruthy();
    expect((tool.promptGuidelines ?? []).length).toBeGreaterThan(0);
    const parameters = tool.parameters as Record<string, unknown> & { required?: string[] };
    expect(Object.getOwnPropertySymbols(parameters)).toHaveLength(0);
    expect(parameters.required).toEqual(["question"]);
  });

  it("leads with the trigger condition and keeps the do-not-ask rules", () => {
    const tool = harness();
    // Under codemode-only the tool's own text is all the model sees, so the
    // first sentence must say *when* to reach for it, not just what it does.
    expect(tool.description.startsWith("When the next step depends on a decision only the user can make")).toBe(true);
    expect(tool.description).toContain("instead of ending your turn with a prose question");
    expect(tool.promptGuidelines).toContain(
      "Prefer ask_user over a prose question whenever your turn would otherwise end with a question only the user can answer",
    );
    expect(tool.promptGuidelines?.some((g) => g.includes("Never ask what the context"))).toBe(true);
  });
});

describe("askUserExecute — option questions", () => {
  const params: AskUserParams = {
    question: "Which test runner?",
    options: [
      { label: "vitest", description: "repo default" },
      { label: "jest" },
    ],
  };

  it("composes label — description rows plus the Other row, maps back to the bare label", async () => {
    const { ctx, calls } = ctxWithRecorder({ select: "jest" });
    const result = (await askUserExecute(params, ctx)) as { content: { text: string }[] };
    expect(calls).toHaveLength(1);
    const [title, options] = calls[0]!.args as [string, string[]];
    expect(title).toBe("Which test runner?");
    expect(options).toEqual(["vitest — repo default", "jest", "Other (type your answer)"]);
    expect(result.content[0]!.text).toBe("User selected: jest");
  });

  it("routes the Other row to the freeform path", async () => {
    const { ctx, calls } = ctxWithRecorder({ select: "Other (type your answer)", editor: "mocha" });
    const result = (await askUserExecute(params, ctx)) as { content: { text: string }[] };
    expect(calls.map((c) => c.method)).toEqual(["select", "editor"]);
    expect(result.content[0]!.text).toBe("User answered: mocha");
  });

  it("returns the fixed dismiss text when the dialog is cancelled", async () => {
    const { ctx } = ctxWithRecorder({ select: undefined });
    const result = (await askUserExecute(params, ctx)) as { content: { text: string }[]; isError?: boolean };
    expect(result.content[0]!.text).toContain("dismissed");
    expect(result.isError).toBeUndefined();
  });
});

describe("askUserExecute — open questions", () => {
  it("uses the multiline editor in TUI mode", async () => {
    const { ctx, calls } = ctxWithRecorder({ editor: "  do both, see notes  " });
    const result = (await askUserExecute({ question: "Anything to add?" }, ctx)) as { content: { text: string }[] };
    expect(calls.map((c) => c.method)).toEqual(["editor"]);
    expect(result.content[0]!.text).toBe("User answered: do both, see notes");
  });

  it("uses the input dialog in RPC mode", async () => {
    const { ctx, calls } = ctxWithRecorder({ input: "rpc answer" }, { mode: "rpc" });
    const result = (await askUserExecute({ question: "Q?" }, ctx)) as { content: { text: string }[] };
    expect(calls.map((c) => c.method)).toEqual(["input"]);
    expect(result.content[0]!.text).toBe("User answered: rpc answer");
  });

  it("treats an empty freeform answer as dismissed", async () => {
    const { ctx } = ctxWithRecorder({ editor: "   " });
    const result = (await askUserExecute({ question: "Q?" }, ctx)) as { content: { text: string }[] };
    expect(result.content[0]!.text).toContain("dismissed");
  });
});

describe("askUserExecute — guard rails", () => {
  it("fails explicitly when no dialog-capable UI exists", async () => {
    const { ctx } = ctxWithRecorder({}, { hasUI: false });
    const result = (await askUserExecute({ question: "Q?" }, ctx)) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("No interactive UI");
  });

  it("fails on an empty question", async () => {
    const { ctx } = ctxWithRecorder({});
    const result = (await askUserExecute({ question: "  " }, ctx)) as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("falls back to freeform when every option label is blank", async () => {
    const { ctx, calls } = ctxWithRecorder({ editor: "freeform" });
    const result = (await askUserExecute(
      { question: "Q?", options: [{ label: "  " }, { label: "" }] },
      ctx,
    ) as { content: { text: string }[] });
    expect(calls.map((c) => c.method)).toEqual(["editor"]);
    expect(result.content[0]!.text).toBe("User answered: freeform");
  });
});
