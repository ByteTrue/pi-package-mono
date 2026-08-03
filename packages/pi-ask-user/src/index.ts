import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type Component,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

const QuestionOptionSchema = Type.Object({
  label: Type.String({ description: "Display text (1-5 words, concise)" }),
  description: Type.String({ description: "Explanation of choice" }),
});

const QuestionSchema = Type.Object({
  question: Type.String({ description: "Complete question" }),
  header: Type.String({ description: "Very short label (max 30 chars)" }),
  options: Type.Array(QuestionOptionSchema, { description: "Available choices" }),
  multiple: Type.Optional(Type.Boolean({ description: "Allow selecting multiple choices" })),
});

export const QuestionParameters = Type.Object({
  questions: Type.Array(QuestionSchema, { description: "Questions to ask" }),
});

export type QuestionParams = Static<typeof QuestionParameters>;
export type QuestionPrompt = QuestionParams["questions"][number];
export type QuestionAnswer = string[];
export interface QuestionDetails {
  answers: QuestionAnswer[];
}

export const QUESTION_DESCRIPTION = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- When \`custom\` is enabled (default), a "Type your own answer" option is added automatically; don't include "Other" or catch-all options
- Answers are returned as arrays of labels; set \`multiple: true\` to allow selecting more than one
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`;

export function formatQuestionOutput(questions: readonly QuestionPrompt[], answers: readonly QuestionAnswer[]): string {
  const formatted = questions
    .map(
      (question, index) =>
        `"${question.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`,
    )
    .join(", ");

  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`;
}

function questionCountLabel(count: number): string {
  return `${count} question${count > 1 ? "s" : ""}`;
}

interface QuestionTUI {
  requestRender(): void;
}

export function createQuestionPrompt(
  questions: readonly QuestionPrompt[],
  tui: QuestionTUI,
  theme: Theme,
  done: (result: QuestionAnswer[] | null) => void,
): Component {
  const single = questions.length === 1 && questions[0]?.multiple !== true;
  const tabCount = single ? 1 : questions.length + 1;
  let tab = 0;
  let selected = 0;
  let editing = false;
  let answers: QuestionAnswer[] = [];
  let custom: string[] = [];
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;

  const editorTheme: EditorTheme = {
    borderColor: (text) => theme.fg("accent", text),
    selectList: {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    },
  };
  const editor = new Editor(tui as ConstructorParameters<typeof Editor>[0], editorTheme);

  function currentQuestion(): QuestionPrompt | undefined {
    return questions[tab];
  }

  function options(): QuestionPrompt["options"] {
    return currentQuestion()?.options ?? [];
  }

  function multiple(): boolean {
    return currentQuestion()?.multiple === true;
  }

  function input(): string {
    return custom[tab] ?? "";
  }

  function customPicked(): boolean {
    const value = input();
    return Boolean(value && (answers[tab] ?? []).includes(value));
  }

  function confirmTab(): boolean {
    return !single && tab === questions.length;
  }

  function refresh(): void {
    cachedWidth = undefined;
    cachedLines = undefined;
    tui.requestRender();
  }

  function finish(): void {
    done(questions.map((_, index) => [...(answers[index] ?? [])]));
  }

  function pick(answer: string, isCustom = false): void {
    const nextAnswers = [...answers];
    nextAnswers[tab] = [answer];
    answers = nextAnswers;

    if (isCustom) {
      const nextCustom = [...custom];
      nextCustom[tab] = answer;
      custom = nextCustom;
    }

    if (single) {
      finish();
      return;
    }

    tab += 1;
    selected = 0;
    refresh();
  }

  function toggle(answer: string): void {
    const next = [...(answers[tab] ?? [])];
    const index = next.indexOf(answer);
    if (index === -1) next.push(answer);
    else next.splice(index, 1);

    const nextAnswers = [...answers];
    nextAnswers[tab] = next;
    answers = nextAnswers;
    refresh();
  }

  function selectTab(nextTab: number): void {
    tab = (nextTab + tabCount) % tabCount;
    selected = 0;
    refresh();
  }

  function submitCustomAnswer(submitted: string): void {
    const value = submitted.trim();
    const previous = custom[tab] ?? "";

    if (!value) {
      if (previous) {
        const nextCustom = [...custom];
        nextCustom[tab] = "";
        custom = nextCustom;

        const nextAnswers = [...answers];
        nextAnswers[tab] = (nextAnswers[tab] ?? []).filter((answer) => answer !== previous);
        answers = nextAnswers;
      }
      editor.setText("");
      editing = false;
      refresh();
      return;
    }

    if (multiple()) {
      const nextCustom = [...custom];
      nextCustom[tab] = value;
      custom = nextCustom;

      const nextAnswers = [...(answers[tab] ?? [])].filter((answer) => answer !== previous);
      if (!nextAnswers.includes(value)) nextAnswers.push(value);
      const allAnswers = [...answers];
      allAnswers[tab] = nextAnswers;
      answers = allAnswers;
      editing = false;
      refresh();
      return;
    }

    pick(value, true);
    editing = false;
  }

  editor.onSubmit = submitCustomAnswer;

  function selectOption(): void {
    const optionList = options();
    if (selected === optionList.length) {
      if (multiple()) {
        const value = input();
        if (value && customPicked()) {
          toggle(value);
          return;
        }
      }
      editing = true;
      editor.setText(input());
      refresh();
      return;
    }

    const option = optionList[selected];
    if (!option) return;
    if (multiple()) {
      toggle(option.label);
      return;
    }
    pick(option.label);
  }

  function render(width: number): string[] {
    if (cachedLines && cachedWidth === width) return cachedLines;

    const lines: string[] = [];
    const renderWidth = Math.max(1, width);

    function addWrapped(text: string): void {
      lines.push(...wrapTextWithAnsi(text, renderWidth));
    }

    function addWrappedWithPrefix(prefix: string, text: string): void {
      const prefixWidth = visibleWidth(prefix);
      if (prefixWidth >= renderWidth) {
        addWrapped(prefix + text);
        return;
      }
      const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
      const continuation = " ".repeat(prefixWidth);
      for (let index = 0; index < wrapped.length; index++) {
        lines.push(`${index === 0 ? prefix : continuation}${wrapped[index]}`);
      }
    }

    lines.push(theme.fg("accent", "─".repeat(renderWidth)));

    if (!single) {
      const tabs = questions.map((question, index) => {
        const answered = (answers[index]?.length ?? 0) > 0;
        const label = `${answered ? "■" : "□"} ${question.header}`;
        return index === tab
          ? theme.bg("selectedBg", theme.fg("text", ` ${label} `))
          : theme.fg(answered ? "success" : "muted", ` ${label} `);
      });
      const confirmLabel = tab === questions.length ? " ✓ Confirm " : " Confirm ";
      tabs.push(
        tab === questions.length
          ? theme.bg("selectedBg", theme.fg("text", confirmLabel))
          : theme.fg("muted", confirmLabel),
      );
      addWrappedWithPrefix(" ", tabs.join(" "));
      lines.push("");
    }

    if (confirmTab()) {
      addWrappedWithPrefix(" ", theme.fg("accent", theme.bold("Review")));
      lines.push("");
      for (let index = 0; index < questions.length; index++) {
        const question = questions[index];
        if (!question) continue;
        const answer = answers[index];
        const value = answer?.length ? answer.join(", ") : "(not answered)";
        addWrappedWithPrefix(
          " ",
          `${theme.fg("muted", `${question.header}: `)}${theme.fg(answer?.length ? "text" : "error", value)}`,
        );
      }
    } else {
      const question = currentQuestion();
      const optionList = options();
      if (question) {
        addWrappedWithPrefix(
          " ",
          theme.fg("text", `${question.question}${multiple() ? " (select all that apply)" : ""}`),
        );
        lines.push("");

        for (let index = 0; index < optionList.length; index++) {
          const option = optionList[index];
          if (!option) continue;
          const active = index === selected;
          const picked = answers[tab]?.includes(option.label) ?? false;
          const prefix = active ? theme.fg("accent", "> ") : "  ";
          const value = multiple() ? `[${picked ? "✓" : " "}] ${option.label}` : option.label;
          const color = active ? "accent" : picked ? "success" : "text";
          addWrappedWithPrefix(prefix, theme.fg(color, `${index + 1}. ${value}`));
          addWrappedWithPrefix("     ", theme.fg("muted", option.description));
        }

        const active = selected === optionList.length;
        const picked = customPicked();
        const prefix = active ? theme.fg("accent", "> ") : "  ";
        const value = multiple() ? `[${picked ? "✓" : " "}] Type your own answer` : "Type your own answer";
        const color = active ? "accent" : picked ? "success" : "text";
        addWrappedWithPrefix(prefix, theme.fg(color, `${optionList.length + 1}. ${value}`));
        if (editing) {
          lines.push("");
          addWrappedWithPrefix(" ", theme.fg("muted", "Your answer:"));
          for (const line of editor.render(Math.max(1, renderWidth - 2))) lines.push(` ${line}`);
        } else if (input()) {
          addWrappedWithPrefix("     ", theme.fg("muted", input()));
        }
      }
    }

    lines.push("");
    if (editing) {
      addWrappedWithPrefix(" ", theme.fg("dim", "Enter to submit • Esc to go back"));
    } else if (confirmTab()) {
      addWrappedWithPrefix(" ", theme.fg("dim", "Enter to submit • Esc to dismiss"));
    } else {
      const help = !single
        ? "Tab/←→ navigate • ↑↓ select • Enter confirm • Esc dismiss"
        : "↑↓ select • Enter submit • Esc dismiss";
      addWrappedWithPrefix(" ", theme.fg("dim", help));
    }
    lines.push(theme.fg("accent", "─".repeat(renderWidth)));

    cachedWidth = width;
    cachedLines = lines;
    return lines;
  }

  function handleInput(data: string): void {
    if (editing) {
      if (matchesKey(data, Key.escape)) {
        editing = false;
        editor.setText(input());
        refresh();
        return;
      }
      editor.handleInput(data);
      refresh();
      return;
    }

    if (matchesKey(data, Key.escape)) {
      done(null);
      return;
    }

    if (!single) {
      if (matchesKey(data, Key.tab) || matchesKey(data, Key.right) || matchesKey(data, "l")) {
        selectTab(tab + 1);
        return;
      }
      if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left) || matchesKey(data, "h")) {
        selectTab(tab - 1);
        return;
      }
    }

    if (confirmTab()) {
      if (matchesKey(data, Key.enter)) finish();
      return;
    }

    const optionCount = options().length + 1;
    const digit = /^[1-9]$/.test(data) ? Number(data) : 0;
    if (digit > 0 && digit <= Math.min(optionCount, 9)) {
      selected = digit - 1;
      selectOption();
      return;
    }

    if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
      selected = (selected - 1 + optionCount) % optionCount;
      refresh();
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
      selected = (selected + 1) % optionCount;
      refresh();
      return;
    }
    if (matchesKey(data, Key.enter)) selectOption();
  }

  return {
    render,
    invalidate: () => {
      cachedWidth = undefined;
      cachedLines = undefined;
      editor.invalidate();
    },
    handleInput,
  };
}

export default function registerAskUser(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "question",
    label: "Question",
    description: QUESTION_DESCRIPTION,
    parameters: QuestionParameters,
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui") {
        throw new Error("The question tool requires interactive mode");
      }
      if (signal?.aborted) {
        throw new Error("The question was aborted");
      }

      let aborted = false;
      let cleanup = () => {};
      let settlePrompt: ((value: QuestionAnswer[] | null) => void) | undefined;
      try {
        let abortPromise: Promise<{ type: "abort" }> | undefined;
        if (signal) {
          abortPromise = new Promise<{ type: "abort" }>((resolve) => {
            const onAbort = () => {
              aborted = true;
              settlePrompt?.(null);
              resolve({ type: "abort" });
            };
            cleanup = () => signal.removeEventListener("abort", onAbort);
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
          });
        }
        const uiPromise = ctx.ui.custom<QuestionAnswer[] | null>((tui, theme, _keybindings, done) => {
          let settled = false;
          const settle = (value: QuestionAnswer[] | null) => {
            if (settled) return;
            settled = true;
            settlePrompt = undefined;
            done(value);
          };
          settlePrompt = settle;
          if (aborted || signal?.aborted) {
            settle(null);
          }
          return createQuestionPrompt(params.questions, tui, theme, settle);
        });
        const outcome = abortPromise
          ? await Promise.race([uiPromise.then((value) => ({ type: "ui" as const, value })), abortPromise])
          : { type: "ui" as const, value: await uiPromise };
        if (outcome.type === "abort") {
          throw new Error("The question was aborted");
        }
        const answers = outcome.value;
        if (!answers) {
          throw new Error("The user dismissed this question");
        }
        return {
          content: [{ type: "text", text: formatQuestionOutput(params.questions, answers) }],
          details: { answers },
        };
      } finally {
        cleanup();
      }
    },

    renderCall(args, theme) {
      const questions = Array.isArray(args.questions) ? args.questions : [];
      return new Text(
        theme.fg("toolTitle", theme.bold("question ")) + theme.fg("muted", questionCountLabel(questions.length)),
        0,
        0,
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as QuestionDetails | undefined;
      if (!details) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }

      return new Text(
        theme.fg("success", "✓ ") + theme.fg("accent", `Asked ${questionCountLabel(details.answers.length)}`),
        0,
        0,
      );
    },
  });
}
