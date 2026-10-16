import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import askUserExtension, { askUserExecute, type AskUserParams } from "./pi-ask-user.js";

interface UICall {
  method: "select" | "input" | "editor";
  args: unknown[];
}

type ReplyOrQueue<T> = T | T[];

function shiftReply<T>(source: ReplyOrQueue<T> | undefined): T | undefined {
  if (Array.isArray(source)) {
    return source.shift();
  }
  return source;
}

/**
 * Dialog-capable ctx fake: records every ctx.ui call and answers them from
 * `replies` (either a single value or a FIFO queue per method).
 */
function ctxWithRecorder(
  replies: {
    select?: ReplyOrQueue<string | undefined>;
    input?: ReplyOrQueue<string | undefined>;
    editor?: ReplyOrQueue<string | undefined>;
  },
  overrides: Partial<ExtensionContext> = {},
): { ctx: ExtensionContext; calls: UICall[] } {
  const calls: UICall[] = [];
  const selectQueue = Array.isArray(replies.select) ? [...replies.select] : replies.select;
  const inputQueue = Array.isArray(replies.input) ? [...replies.input] : replies.input;
  const editorQueue = Array.isArray(replies.editor) ? [...replies.editor] : replies.editor;

  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      async select(title: string, options: string[]) {
        calls.push({ method: "select", args: [title, options] });
        return shiftReply(selectQueue);
      },
      async input(title: string, placeholder?: string) {
        calls.push({ method: "input", args: [title, placeholder] });
        return shiftReply(inputQueue);
      },
      async editor(title: string, prefill?: string) {
        calls.push({
          method: "editor",
          args: prefill !== undefined ? [title, prefill] : [title],
        });
        return shiftReply(editorQueue);
      },
    },
    ...overrides,
  } as unknown as ExtensionContext;
  return { ctx, calls };
}

function harness() {
  let tool:
    | (ToolDefinition & {
        execute: (
          id: string,
          params: unknown,
          s: AbortSignal,
          u: unknown,
          ctx: ExtensionContext,
        ) => Promise<unknown>;
      })
    | undefined;
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
  it("registers ask_user with a plain JSON schema for questions[] (no runtime TypeBox symbols)", () => {
    const tool = harness();
    expect(tool.name).toBe("ask_user");
    expect(tool.promptSnippet).toBeTruthy();
    expect((tool.promptGuidelines ?? []).length).toBeGreaterThan(0);
    const parameters = tool.parameters as {
      required?: string[];
      properties?: {
        questions?: {
          items?: { properties?: Record<string, unknown>; required?: string[] };
        };
      };
    };
    expect(Object.getOwnPropertySymbols(parameters)).toHaveLength(0);
    expect(parameters.required).toEqual(["questions"]);
    const itemProps = parameters.properties?.questions?.items?.properties ?? {};
    expect(Object.keys(itemProps)).toEqual(["question", "options", "multiple"]);
    expect(parameters.properties?.questions?.items?.required).toEqual(["question"]);
  });

  it("leads with the trigger condition and includes batching + multi-select + do-not-ask rules", () => {
    const tool = harness();
    expect(
      tool.description.startsWith("When the next step depends on a decision only the user can make"),
    ).toBe(true);
    expect(tool.description).toContain("instead of ending your turn with a prose question");
    expect(tool.description).toContain("multiple: true");
    expect(tool.promptGuidelines).toContain(
      "Prefer ask_user over a prose question whenever your turn would otherwise end with a question only the user can answer",
    );
    expect(tool.promptGuidelines?.some((g) => g.includes("Batch 2-4 independent questions"))).toBe(
      true,
    );
    expect(tool.promptGuidelines?.some((g) => g.includes("multiple: true"))).toBe(true);
    expect(tool.promptGuidelines?.some((g) => g.includes("Never ask what the context"))).toBe(true);
  });
});

describe("askUserExecute — single-select option questions", () => {
  const params: AskUserParams = {
    questions: [
      {
        question: "Which test runner?",
        options: [
          { label: "vitest", description: "repo default" },
          { label: "jest" },
        ],
      },
    ],
  };

  it("composes label — description rows plus the Other row, maps back to the bare label", async () => {
    const { ctx, calls } = ctxWithRecorder({ select: "vitest — repo default" });
    const result = (await askUserExecute(params, ctx)) as { content: { text: string }[] };
    expect(calls).toHaveLength(1);
    const [title, options] = calls[0]!.args as [string, string[]];
    expect(title).toBe("Which test runner?");
    expect(options).toEqual(["vitest — repo default", "jest", "Other (type your answer)"]);
    expect(result.content[0]!.text).toBe("User selected: vitest");
  });

  it("accepts legacy top-level { question, options } parameters", async () => {
    const { ctx } = ctxWithRecorder({ select: "jest" });
    const result = (await askUserExecute(
      {
        question: "Which test runner?",
        options: [{ label: "vitest" }, { label: "jest" }],
      },
      ctx,
    )) as { content: { text: string }[] };
    expect(result.content[0]!.text).toBe("User selected: jest");
  });

  it("routes the Other row to the freeform path", async () => {
    const { ctx, calls } = ctxWithRecorder({
      select: "Other (type your answer)",
      editor: "mocha",
    });
    const result = (await askUserExecute(params, ctx)) as { content: { text: string }[] };
    expect(calls.map((c) => c.method)).toEqual(["select", "editor"]);
    expect(result.content[0]!.text).toBe("User answered: mocha");
  });

  it("returns the fixed dismiss text when the dialog is cancelled", async () => {
    const { ctx } = ctxWithRecorder({ select: undefined });
    const result = (await askUserExecute(params, ctx)) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.content[0]!.text).toContain("dismissed");
    expect(result.isError).toBeUndefined();
  });
});

describe("askUserExecute — multi-select questions (multiple: true)", () => {
  const multiParams: AskUserParams = {
    questions: [
      {
        question: "Which targets?",
        multiple: true,
        options: [
          { label: "ESM", description: "modern Node" },
          { label: "CJS", description: "legacy Node" },
          { label: "Browser" },
        ],
      },
    ],
  };

  it("toggles multiple options, shows Done only after selection, and returns ordered labels", async () => {
    const { ctx, calls } = ctxWithRecorder({
      select: [
        "[ ] Browser",
        "[ ] ESM — modern Node",
        "[✓] Browser", // uncheck Browser
        "[ ] CJS — legacy Node",
        "✓ Done (2 selected)",
      ],
    });
    const result = (await askUserExecute(multiParams, ctx)) as { content: { text: string }[] };
    expect(calls).toHaveLength(5);

    // Initial render has no Done row because 0 items are selected
    const [firstTitle, firstRows] = calls[0]!.args as [string, string[]];
    expect(firstTitle).toBe("Which targets? (select all that apply)");
    expect(firstRows).toEqual([
      "[ ] ESM — modern Node",
      "[ ] CJS — legacy Node",
      "[ ] Browser",
      "[ ] Other (type your answer)",
    ]);

    // After selecting Browser, Done (1 selected) appears
    const [, secondRows] = calls[1]!.args as [string, string[]];
    expect(secondRows).toEqual([
      "[ ] ESM — modern Node",
      "[ ] CJS — legacy Node",
      "[✓] Browser",
      "[ ] Other (type your answer)",
      "✓ Done (1 selected)",
    ]);

    // Preserves option definition order (ESM, CJS)
    expect(result.content[0]!.text).toBe("User selected: ESM, CJS");
  });

  it("merges custom Other text into the multi-select checklist and allows unchecking it", async () => {
    const { ctx, calls } = ctxWithRecorder({
      select: [
        "[ ] ESM — modern Node",
        "[ ] Other (type your answer)",
        "[✓] Other: Deno", // uncheck custom answer
        "[ ] Other (type your answer)", // re-open Other and enter Bun
        "✓ Done (2 selected)",
      ],
      editor: ["Deno", "Bun"],
    });
    const result = (await askUserExecute(multiParams, ctx)) as { content: { text: string }[] };
    expect(result.content[0]!.text).toBe("User selected: ESM, Bun");
    // Second editor call receives "Deno" as prefill
    const editorCalls = calls.filter((c) => c.method === "editor");
    expect(editorCalls[0]!.args).toEqual(["Which targets? (select all that apply)"]);
    expect(editorCalls[1]!.args).toEqual(["Which targets? (select all that apply)", "Deno"]);
  });
});

describe("askUserExecute — batch questions and back-navigation", () => {
  const batchParams: AskUserParams = {
    questions: [
      {
        question: "Which runtime?",
        options: [{ label: "Node" }, { label: "Bun" }],
      },
      {
        question: "Which formats?",
        multiple: true,
        options: [{ label: "ESM" }, { label: "CJS" }],
      },
      {
        question: "Publish to npm?",
        options: [{ label: "Yes" }, { label: "No" }],
      },
    ],
  };

  it("lets the user go back from Q2 to revise Q1, and from Q3 to revise multi-select Q2", async () => {
    const { ctx, calls } = ctxWithRecorder({
      select: [
        // Q1: initially pick Bun
        "Bun",
        // Q2: realize Q1 was wrong -> go back to Q1
        "← Back to previous question",
        // Q1 revisit: change to Node
        "Node",
        // Q2: select ESM and confirm
        "[ ] ESM",
        "✓ Done (1 selected)",
        // Q3: go back to Q2 to add CJS
        "← Back to previous question",
        // Q2 revisit: ESM is still checked; add CJS and confirm
        "[ ] CJS",
        "✓ Done (2 selected)",
        // Q3: select Yes
        "Yes",
      ],
    });

    const result = (await askUserExecute(batchParams, ctx)) as { content: { text: string }[] };

    // Q1 initial has no Back row
    expect(calls[0]!.args).toEqual([
      "[1/3] Which runtime?",
      ["Node", "Bun", "Other (type your answer)"],
    ]);
    // Q2 has Back row
    expect((calls[1]!.args as [string, string[]])[1]).toContain("← Back to previous question");
    // Q1 revisit shows current answer in title
    expect((calls[2]!.args as [string, string[]])[0]).toBe(
      "[1/3] Which runtime? (current: Bun)",
    );
    // Q2 revisit after Q3 still has ESM checked
    expect((calls[6]!.args as [string, string[]])[1]).toEqual([
      "[✓] ESM",
      "[ ] CJS",
      "[ ] Other (type your answer)",
      "✓ Done (1 selected)",
      "← Back to previous question",
    ]);

    expect(result.content[0]!.text).toBe(
      [
        "User answered 3 questions:",
        "1. Which runtime? → Node",
        "2. Which formats? → ESM, CJS",
        "3. Publish to npm? → Yes",
      ].join("\n"),
    );
  });

  it("supports going back from an open Q2 to Q1", async () => {
    const { ctx } = ctxWithRecorder({
      select: [
        "Node", // Q1
        "← Back to previous question", // Q2 -> back to Q1
        "Bun", // Q1 revised
        "Other (type your answer)", // Q2 -> open editor
      ],
      editor: "custom-pkg",
    });

    const result = (await askUserExecute(
      {
        questions: [
          { question: "Runtime?", options: [{ label: "Node" }, { label: "Bun" }] },
          { question: "Package name?" },
        ],
      },
      ctx,
    )) as { content: { text: string }[] };

    expect(result.content[0]!.text).toBe(
      ["User answered 2 questions:", "1. Runtime? → Bun", "2. Package name? → custom-pkg"].join(
        "\n",
      ),
    );
  });
});

describe("askUserExecute — open questions", () => {
  it("uses the multiline editor in TUI mode", async () => {
    const { ctx, calls } = ctxWithRecorder({ editor: "  do both, see notes  " });
    const result = (await askUserExecute(
      { questions: [{ question: "Anything to add?" }] },
      ctx,
    )) as { content: { text: string }[] };
    expect(calls.map((c) => c.method)).toEqual(["editor"]);
    expect(result.content[0]!.text).toBe("User answered: do both, see notes");
  });

  it("uses the input dialog in RPC mode", async () => {
    const { ctx, calls } = ctxWithRecorder({ input: "rpc answer" }, { mode: "rpc" });
    const result = (await askUserExecute({ questions: [{ question: "Q?" }] }, ctx)) as {
      content: { text: string }[];
    };
    expect(calls.map((c) => c.method)).toEqual(["input"]);
    expect(result.content[0]!.text).toBe("User answered: rpc answer");
  });

  it("treats an empty freeform answer as dismissed", async () => {
    const { ctx } = ctxWithRecorder({ editor: "   " });
    const result = (await askUserExecute({ questions: [{ question: "Q?" }] }, ctx)) as {
      content: { text: string }[];
    };
    expect(result.content[0]!.text).toContain("dismissed");
  });
});

describe("askUserExecute — guard rails", () => {
  it("fails explicitly when no dialog-capable UI exists", async () => {
    const { ctx } = ctxWithRecorder({}, { hasUI: false });
    const result = (await askUserExecute({ questions: [{ question: "Q?" }] }, ctx)) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("No interactive UI");
  });

  it("fails on an empty questions array or blank question", async () => {
    const { ctx } = ctxWithRecorder({});
    const emptyArr = (await askUserExecute({ questions: [] }, ctx)) as { isError?: boolean };
    expect(emptyArr.isError).toBe(true);

    const blankQ = (await askUserExecute({ questions: [{ question: "  " }] }, ctx)) as {
      isError?: boolean;
    };
    expect(blankQ.isError).toBe(true);
  });

  it("falls back to freeform when every option label is blank", async () => {
    const { ctx, calls } = ctxWithRecorder({ editor: "freeform" });
    const result = (await askUserExecute(
      { questions: [{ question: "Q?", options: [{ label: "  " }, { label: "" }] }] },
      ctx,
    )) as { content: { text: string }[] };
    expect(calls.map((c) => c.method)).toEqual(["editor"]);
    expect(result.content[0]!.text).toBe("User answered: freeform");
  });
});
