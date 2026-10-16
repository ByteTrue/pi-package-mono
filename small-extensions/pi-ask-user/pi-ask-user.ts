/**
 * pi-ask-user — an ask_user tool for single or batched decision questions,
 * supporting single-select, multi-select, freeform answers, and back-navigation
 * across questions using Pi's built-in dialogs only.
 *
 * A small-extension: shipped as this single file (no npm package, no build
 * step), installed by scripts/install-small-extension.mjs into
 * ~/.pi/agent/extensions/. Zero runtime imports — jiti loads TypeScript
 * directly; type-only imports disappear at load time.
 *
 * Why it exists: without it the model's questions arrive as free-form prose in
 * a different shape every session, and the user answers by typing
 * "第一个…第二个…" by hand. One tool with a fixed schema plus promptGuidelines
 * makes the question format stable, and the built-in ctx.ui.select/input/
 * editor dialogs turn each answer into arrow keys + Enter across both TUI and
 * RPC (BySpace) modes.
 *
 * Surface: one ask_user tool taking `questions` (1–4 items, each with
 * `question`, optional `options [{label, description?}]`, and optional
 * `multiple: boolean`). Built-in dialogs only:
 * - Single-select question: `ctx.ui.select` with an always-appended
 *   "Other (type your answer)" row.
 * - Multi-select question (`multiple: true`): `ctx.ui.select` loop toggling
 *   `[✓]` / `[ ]` per option, merging custom `Other` text into the checklist,
 *   and confirming with `✓ Done (N selected)`.
 * - Multi-question flow (`questions.length > 1`): step 2..N includes a
 *   "← Back to previous question" row so the user can return and revise
 *   earlier answers before finishing.
 * - Open question (no options): `ctx.ui.editor` in TUI mode (multiline) and
 *   `ctx.ui.input` elsewhere.
 * - Dismiss (Esc): returns a fixed non-error text so the model falls back to
 *   plain prose; no UI (print/JSON mode) is an explicit error.
 */

import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

const OTHER_LABEL = "Other (type your answer)";
const BACK_LABEL = "← Back to previous question";

export interface AskUserOption {
  label: string;
  description?: string;
}

export interface AskUserQuestion {
  question: string;
  options?: AskUserOption[];
  multiple?: boolean;
}

export interface AskUserParams {
  questions?: AskUserQuestion[];
  /** Legacy single-question fallback accepted at runtime. */
  question?: string;
  options?: AskUserOption[];
  multiple?: boolean;
}

export interface AskUserToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

interface NormalizedQuestion {
  question: string;
  options: AskUserOption[];
  multiple: boolean;
}

interface QuestionState {
  answers: string[];
  wasFreeform: boolean;
  pickedLabels: Set<string>;
  customText?: string;
  customChecked: boolean;
}

// Hand-written plain JSON Schema (no TypeBox Kind symbols): the artifact must
// stay zero-runtime-import, and Pi's validator has a dedicated plain-schema
// path. Same pattern as packages/pi-subagent's tool parameters.
const askUserParameters = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      description:
        "1-4 decision or clarification questions. Pass 1 item for a single question, or 2-4 items to batch independent decisions in one call.",
      items: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question text shown to the user.",
          },
          options: {
            type: "array",
            description:
              "2-4 concrete answer choices, each {label, description?}. Omit for an open question (the user types a free-form answer).",
            items: {
              type: "object",
              properties: {
                label: {
                  type: "string",
                  description: "Short answer text, e.g. 'Use vitest (Recommended)'",
                },
                description: {
                  type: "string",
                  description: "One-line consequence or detail of this option",
                },
              },
              required: ["label"],
            },
          },
          multiple: {
            type: "boolean",
            description:
              "Set true when the user can select more than one option for this question (multi-select).",
          },
        },
        required: ["question"],
      },
    },
  },
  required: ["questions"],
} as const;

function errorResult(text: string): AskUserToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Fixed dismiss text: the model should fall back to prose, not re-ask. */
const DISMISSED =
  "User dismissed the question without answering. Do not immediately re-ask; continue in plain prose or drop the question.";

function dismissedResult(): AskUserToolResult {
  return { content: [{ type: "text", text: DISMISSED }] };
}

function answered(prefix: string, text: string): AskUserToolResult {
  return { content: [{ type: "text", text: `${prefix}${text}` }] };
}

function normalizeOptions(raw?: AskUserOption[]): AskUserOption[] {
  return (raw ?? [])
    .map((option) => ({
      label: (option?.label ?? "").trim(),
      description: option?.description?.trim() || undefined,
    }))
    .filter((option) => option.label);
}

function normalizeQuestions(
  params: AskUserParams,
): { questions: NormalizedQuestion[] } | { error: string } {
  if (Array.isArray(params?.questions)) {
    if (params.questions.length === 0) {
      return { error: "ask_user requires a non-empty 'questions' array." };
    }
    const normalized: NormalizedQuestion[] = [];
    for (const item of params.questions) {
      const question = (item?.question ?? "").trim();
      if (!question) {
        return { error: "ask_user requires a non-empty 'question' for every item." };
      }
      const options = normalizeOptions(item?.options);
      normalized.push({
        question,
        options,
        multiple: Boolean(item?.multiple) && options.length > 0,
      });
    }
    return { questions: normalized };
  }

  if (typeof params?.question === "string") {
    const question = params.question.trim();
    if (!question) {
      return { error: "ask_user requires a non-empty 'question'." };
    }
    const options = normalizeOptions(params.options);
    return {
      questions: [
        {
          question,
          options,
          multiple: Boolean(params.multiple) && options.length > 0,
        },
      ],
    };
  }

  return { error: "ask_user requires a non-empty 'questions' array." };
}

/** Collect a freeform answer: multiline editor in TUI, input dialog elsewhere. */
async function collectFreeform(
  question: string,
  ctx: ExtensionContext,
  prefill?: string,
): Promise<string | undefined> {
  const text =
    ctx.mode === "tui"
      ? prefill !== undefined
        ? await ctx.ui.editor(question, prefill)
        : await ctx.ui.editor(question)
      : await ctx.ui.input(question, "Type your answer");
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}

function formatQuestionTitle(
  q: NormalizedQuestion,
  index: number,
  total: number,
  state: QuestionState,
): string {
  const base = total > 1 ? `[${index + 1}/${total}] ${q.question}` : q.question;
  if (q.multiple) {
    return `${base} (select all that apply)`;
  }
  if (total > 1 && state.answers.length > 0) {
    return `${base} (current: ${state.answers.join(", ")})`;
  }
  return base;
}

/**
 * Core execution, exported for tests. Assumes dialog-capable ctx fakes.
 */
export async function askUserExecute(
  params: AskUserParams,
  ctx: ExtensionContext,
): Promise<AskUserToolResult> {
  const normalized = normalizeQuestions(params);
  if ("error" in normalized) {
    return errorResult(normalized.error);
  }
  if (!ctx.hasUI) {
    return errorResult(
      "No interactive UI is available in this mode. Ask the question directly in your reply text instead of calling ask_user.",
    );
  }

  const { questions } = normalized;
  const states: QuestionState[] = questions.map(() => ({
    answers: [],
    wasFreeform: false,
    pickedLabels: new Set<string>(),
    customText: undefined,
    customChecked: false,
  }));

  let index = 0;
  while (index < questions.length) {
    const q = questions[index]!;
    const state = states[index]!;
    const title = formatQuestionTitle(q, index, questions.length, state);

    // 1. Open question (no options)
    if (q.options.length === 0) {
      if (index === 0) {
        const text = await collectFreeform(title, ctx, state.customText);
        if (!text) return dismissedResult();
        state.customText = text;
        state.answers = [text];
        state.wasFreeform = true;
        index += 1;
        continue;
      }

      const keepRow = state.customText ? `✓ Keep answer: ${state.customText}` : undefined;
      const openRows = [
        ...(keepRow ? [keepRow] : []),
        OTHER_LABEL,
        BACK_LABEL,
      ];
      const selected = await ctx.ui.select(title, openRows);
      if (selected === undefined) return dismissedResult();
      if (selected === BACK_LABEL) {
        index -= 1;
        continue;
      }
      if (keepRow && selected === keepRow && state.customText) {
        state.answers = [state.customText];
        state.wasFreeform = true;
        index += 1;
        continue;
      }
      const text = await collectFreeform(title, ctx, state.customText);
      if (!text) return dismissedResult();
      state.customText = text;
      state.answers = [text];
      state.wasFreeform = true;
      index += 1;
      continue;
    }

    // 2. Multi-select question
    if (q.multiple) {
      let stepped = false;
      while (!stepped) {
        const rawOptionRows = q.options.map((option) =>
          option.description ? `${option.label} — ${option.description}` : option.label,
        );
        const optionRows = q.options.map((option, optIdx) => {
          const checked = state.pickedLabels.has(option.label);
          return `${checked ? "[✓]" : "[ ]"} ${rawOptionRows[optIdx]}`;
        });
        const hasActiveCustom = Boolean(state.customChecked && state.customText);
        const otherRow = hasActiveCustom
          ? `[✓] Other: ${state.customText}`
          : `[ ] ${OTHER_LABEL}`;
        const selectedCount = state.pickedLabels.size + (hasActiveCustom ? 1 : 0);
        const doneRow =
          selectedCount > 0 ? `✓ Done (${selectedCount} selected)` : undefined;

        const rows = [
          ...optionRows,
          otherRow,
          ...(doneRow ? [doneRow] : []),
          ...(index > 0 ? [BACK_LABEL] : []),
        ];

        const selected = await ctx.ui.select(title, rows);
        if (selected === undefined) {
          return dismissedResult();
        }
        if (index > 0 && selected === BACK_LABEL) {
          index -= 1;
          stepped = true;
          break;
        }
        if (doneRow && (selected === doneRow || selected === "✓ Done")) {
          const ordered = q.options
            .filter((option) => state.pickedLabels.has(option.label))
            .map((option) => option.label);
          if (state.customChecked && state.customText) {
            ordered.push(state.customText);
          }
          state.answers = ordered;
          state.wasFreeform = false;
          index += 1;
          stepped = true;
          break;
        }
        if (
          selected === otherRow ||
          selected === OTHER_LABEL ||
          selected === `[ ] ${OTHER_LABEL}`
        ) {
          if (hasActiveCustom) {
            state.customChecked = false;
          } else {
            const text = await collectFreeform(title, ctx, state.customText);
            if (text) {
              state.customText = text;
              state.customChecked = true;
            }
          }
          continue;
        }

        const optIndex = optionRows.findIndex(
          (row, idx) =>
            row === selected ||
            rawOptionRows[idx] === selected ||
            q.options[idx]?.label === selected,
        );
        const matchedLabel = optIndex >= 0 ? q.options[optIndex]?.label : undefined;
        if (!matchedLabel) {
          return dismissedResult();
        }
        if (state.pickedLabels.has(matchedLabel)) {
          state.pickedLabels.delete(matchedLabel);
        } else {
          state.pickedLabels.add(matchedLabel);
        }
      }
      continue;
    }

    // 3. Single-select question
    const optionRows = q.options.map((option) =>
      option.description ? `${option.label} — ${option.description}` : option.label,
    );
    const rows = [
      ...optionRows,
      OTHER_LABEL,
      ...(index > 0 ? [BACK_LABEL] : []),
    ];

    const selected = await ctx.ui.select(title, rows);
    if (selected === undefined) {
      return dismissedResult();
    }
    if (index > 0 && selected === BACK_LABEL) {
      index -= 1;
      continue;
    }
    if (selected === OTHER_LABEL) {
      const text = await collectFreeform(title, ctx, state.customText);
      if (!text) return dismissedResult();
      state.customText = text;
      state.answers = [text];
      state.wasFreeform = true;
      index += 1;
      continue;
    }

    const optIndex = optionRows.findIndex(
      (row, idx) => row === selected || q.options[idx]?.label === selected,
    );
    const label = (optIndex >= 0 ? q.options[optIndex]?.label : undefined) ?? selected;
    state.answers = [label];
    state.wasFreeform = false;
    index += 1;
  }

  if (questions.length === 1) {
    const first = states[0]!;
    if (first.wasFreeform) {
      return answered("User answered: ", first.answers[0] ?? "");
    }
    return answered("User selected: ", first.answers.join(", "));
  }

  const lines = questions.map(
    (q, idx) => `${idx + 1}. ${q.question} → ${(states[idx]?.answers ?? []).join(", ")}`,
  );
  return {
    content: [
      {
        type: "text",
        text: `User answered ${questions.length} questions:\n${lines.join("\n")}`,
      },
    ],
  };
}

export default function askUserExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ask_user",
    label: "Ask user",
    description:
      "When the next step depends on a decision only the user can make, ask it here instead of ending your turn with a prose question — the user answers by picking options and can go back to revise earlier answers in a multi-question flow. Pass 1-4 items in questions: batch independent decisions into one call, and ask a single question first only when later questions depend on its answer. For each question, pass 2-4 options when choices can be enumerated, set multiple: true when several options can be chosen together, or omit options for a genuinely open question. An 'Other (type your answer)' row is always appended; a dismissed dialog means no answer — fall back to plain prose once and do not re-ask.",
    promptSnippet:
      "Ask the user 1-4 single- or multi-select decision questions — they pick options instead of typing.",
    promptGuidelines: [
      "Prefer ask_user over a prose question whenever your turn would otherwise end with a question only the user can answer",
      "Batch 2-4 independent questions into one ask_user call; ask a single question first only when the next question depends on its answer",
      "Set multiple: true when the user can pick more than one option; put your recommended option first and append '(Recommended)' to its label",
      "Never ask what the context, the repo, or this session already answered — ask in prose only when you have no options to offer",
    ],
    parameters: askUserParameters as unknown as TSchema,
    async execute(
      _toolCallId: string,
      params: unknown,
      _signal: AbortSignal,
      _onUpdate: (update: unknown) => void,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<unknown>> {
      const result = await askUserExecute(params as AskUserParams, ctx);
      // AgentToolResult requires a details field; this tool has none.
      return { ...result, details: undefined };
    },
  });
}
