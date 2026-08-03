import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  createQuestionPrompt,
  formatQuestionOutput,
  QuestionParameters,
  type QuestionAnswer,
  type QuestionPrompt,
} from "./index.js";
import registerAskUser from "./index.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

function prompt(overrides: Partial<QuestionPrompt> = {}): QuestionPrompt {
  return {
    question: "Which option?",
    header: "Option",
    options: [
      { label: "First", description: "The first option" },
      { label: "Second", description: "The second option" },
    ],
    ...overrides,
  };
}

function componentFor(questions: readonly QuestionPrompt[]) {
  let result: QuestionAnswer[] | null | undefined;
  const tui = { requestRender: vi.fn(), terminal: { rows: 24, columns: 80 } };
  const component = createQuestionPrompt(questions, tui, theme, (value) => {
    result = value;
  });
  return { component, tui, getResult: () => result };
}

function registeredTool(): any {
  const tools: any[] = [];
  registerAskUser({ registerTool: (tool: any) => tools.push(tool) } as unknown as ExtensionAPI);
  return tools[0];
}

describe("OpenCode question contract", () => {
  it("formats the exact model-facing output and preserves unanswered questions", () => {
    expect(
      formatQuestionOutput(
        [prompt(), prompt({ question: "Where?", header: "Place" })],
        [["First"], []],
      ),
    ).toBe(
      'User has answered your questions: "Which option?"="First", "Where?"="Unanswered". You can now continue with the user\'s answers in mind.',
    );
  });

  it("submits a single predefined answer immediately", () => {
    const { component, getResult } = componentFor([prompt()]);

    component.handleInput?.("2");

    expect(getResult()).toEqual([["Second"]]);
  });

  it("supports a custom answer in a multi-select question and submits on Confirm", () => {
    const { component, getResult } = componentFor([prompt({ multiple: true })]);
    component.handleInput?.("1");
    component.handleInput?.("3");
    component.handleInput?.("m");
    component.handleInput?.("e");
    component.handleInput?.("\r");
    component.handleInput?.("\t");
    component.handleInput?.("\r");

    expect(getResult()).toEqual([["First", "me"]]);
  });

  it("rejects on Escape instead of returning an answer", () => {
    const { component, getResult } = componentFor([prompt()]);

    component.handleInput?.("\x1b");

    expect(getResult()).toBeNull();
  });

  it("registers the exact question tool shape and returns OpenCode-compatible metadata", async () => {
    const tools: any[] = [];
    registerAskUser({ registerTool: (tool: any) => tools.push(tool) } as unknown as ExtensionAPI);
    const tool = tools[0];
    expect(tool.name).toBe("question");
    expect(tool.parameters).toBe(QuestionParameters);
    expect(tool.description).toContain("When `custom` is enabled (default)");

    let answer: QuestionAnswer[] | null | undefined;
    const result = await tool.execute(
      "call-question",
      { questions: [prompt()] },
      undefined,
      undefined,
      {
        mode: "tui",
        ui: {
          custom: async (factory: any) => {
            const component = factory(
              { requestRender: vi.fn(), terminal: { rows: 24, columns: 80 } },
              theme,
              {},
              (value: QuestionAnswer[] | null) => {
                answer = value;
              },
            );
            component.handleInput("1");
            return answer;
          },
        },
      },
    );

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: 'User has answered your questions: "Which option?"="First". You can now continue with the user\'s answers in mind.',
        },
      ],
      details: { answers: [["First"]] },
    });
  });
  it("submits a single custom answer immediately", () => {
    const { component, getResult } = componentFor([prompt()]);
    component.handleInput?.("3");
    component.handleInput?.("o");
    component.handleInput?.("w");
    component.handleInput?.("n");
    component.handleInput?.("\r");
    expect(getResult()).toEqual([["own"]]);
  });

  it("keeps unanswered questions empty on the Confirm page", () => {
    const { component, getResult } = componentFor([prompt(), prompt({ question: "Where?", header: "Place" })]);
    component.handleInput?.("1");
    component.handleInput?.("\t");
    component.handleInput?.("\r");
    expect(getResult()).toEqual([["First"], []]);
  });

  it("fails explicitly for non-TUI, dismissal, and external abort paths", async () => {
    const params = { questions: [prompt()] };
    const tool = registeredTool();

    await expect(tool.execute("call", params, undefined, undefined, { mode: "json" })).rejects.toThrow(
      "The question tool requires interactive mode",
    );
    await expect(
      tool.execute("call", params, undefined, undefined, { mode: "tui", ui: { custom: async () => null } }),
    ).rejects.toThrow("The user dismissed this question");

    const controller = new AbortController();
    await expect(
      tool.execute("call", params, controller.signal, undefined, {
        mode: "tui",
        ui: {
          custom: async (factory: any) => {
            let answer: QuestionAnswer[] | null | undefined;
            factory(
              { requestRender: vi.fn(), terminal: { rows: 24, columns: 80 } },
              theme,
              {},
              (value: QuestionAnswer[] | null) => {
                answer = value;
              },
            );
            controller.abort();
            return answer;
          },
        },
      }),
    ).rejects.toThrow("The question was aborted");
  });
  it("does not wait when abort races before the custom UI mounts", async () => {
    const controller = new AbortController();
    const tool = registeredTool();
    await expect(
      tool.execute("call", { questions: [prompt()] }, controller.signal, undefined, {
        mode: "tui",
        ui: {
          custom: async (factory: any) => {
            controller.abort();
            await Promise.resolve();
            factory(
              { requestRender: vi.fn(), terminal: { rows: 24, columns: 80 } },
              theme,
              {},
              () => {},
            );
            return null;
          },
        },
      }),
    ).rejects.toThrow("The question was aborted");
  });
});
