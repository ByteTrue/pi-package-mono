/**
 * pi-ask-user — a single-purpose ask_user tool: the model asks one decision
 * question, the user picks an option instead of typing free text.
 *
 * A small-extension: shipped as this single file (no npm package, no build
 * step), installed by scripts/install-small-extension.sh / .ps1 into
 * ~/.pi/agent/extensions/. Zero runtime imports — jiti loads TypeScript
 * directly; type-only imports disappear at load time.
 *
 * Why it exists: without it the model's questions arrive as free-form prose in
 * a different shape every session, and the user answers by typing
 * "第一个…第二个…" by hand. One tool with a fixed schema plus promptGuidelines
 * makes the question format stable, and the built-in ctx.ui.select/input/
 * editor dialogs turn each answer into arrow keys + Enter.
 *
 * Why it is back: the repo removed a heavier @bytetrue/pi-ask-user package in
 * issue 047 (minimal-tool principle). The user later re-judged the trade-off —
 * the stable question format and pick-to-answer flow are a real daily gain —
 * and asked for this minimal single-file form instead: built-in dialogs only,
 * no custom TUI, no print-mode plumbing, no batch forms.
 *
 * Surface: one ask_user tool. question (required) + options [{label,
 * description?}] (optional). Options go through ctx.ui.select with an
 * always-appended "Other (type your answer)" row; the freeform path uses
 * ctx.ui.editor in TUI mode (multiline) and ctx.ui.input elsewhere. Dismiss
 * returns a fixed non-error text so the model can fall back to plain prose;
 * no UI (print/JSON mode) is an explicit error — the tool never guesses.
 */

import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

const OTHER_LABEL = "Other (type your answer)";

export interface AskUserOption {
  label: string;
  description?: string;
}

export interface AskUserParams {
  question: string;
  options?: AskUserOption[];
}

export interface AskUserToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

// Hand-written plain JSON Schema (no TypeBox Kind symbols): the artifact must
// stay zero-runtime-import, and Pi's validator has a dedicated plain-schema
// path. Same pattern as packages/pi-subagent's tool parameters.
const askUserParameters = {
  type: "object",
  properties: {
    question: {
      type: "string",
      description:
        "The single question to ask. One decision or clarification per call, phrased so a short option list can answer it.",
    },
    options: {
      type: "array",
      description:
        "2-4 concrete answer choices, each {label, description?}. Omit for an open question (the user types an answer).",
      items: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "Short answer text, e.g. 'Use vitest'",
          },
          description: {
            type: "string",
            description: "One-line consequence or detail of this option",
          },
        },
        required: ["label"],
      },
    },
  },
  required: ["question"],
} as const;

function errorResult(text: string): AskUserToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Fixed dismiss text: the model should fall back to prose, not re-ask. */
const DISMISSED =
  "User dismissed the question without answering. Do not immediately re-ask; continue in plain prose or drop the question.";

function answered(prefix: string, text: string): AskUserToolResult {
  return { content: [{ type: "text", text: `${prefix}${text}` }] };
}

/** Collect a freeform answer: multiline editor in TUI, input dialog elsewhere. */
async function askFreeform(
  question: string,
  ctx: ExtensionContext,
): Promise<AskUserToolResult> {
  const text =
    ctx.mode === "tui"
      ? await ctx.ui.editor(question)
      : await ctx.ui.input(question, "Type your answer");
  const trimmed = text?.trim();
  if (!trimmed) return { content: [{ type: "text", text: DISMISSED }] };
  return answered("User answered: ", trimmed);
}

/**
 * Core execution, exported for tests. Assumes dialog-capable ctx fakes.
 */
export async function askUserExecute(
  params: AskUserParams,
  ctx: ExtensionContext,
): Promise<AskUserToolResult> {
  const question = (params.question ?? "").trim();
  if (!question) {
    return errorResult("ask_user requires a non-empty 'question'.");
  }
  if (!ctx.hasUI) {
    return errorResult(
      "No interactive UI is available in this mode. Ask the question directly in your reply text instead of calling ask_user.",
    );
  }

  const options = (params.options ?? [])
    .map((option) => ({
      label: (option?.label ?? "").trim(),
      description: option?.description?.trim() || undefined,
    }))
    .filter((option) => option.label);

  if (options.length === 0) {
    return askFreeform(question, ctx);
  }

  const labels = options.map((option) =>
    option.description ? `${option.label} — ${option.description}` : option.label,
  );
  labels.push(OTHER_LABEL);

  const selected = await ctx.ui.select(question, labels);
  if (selected === undefined) {
    return { content: [{ type: "text", text: DISMISSED }] };
  }
  if (selected === OTHER_LABEL) {
    return askFreeform(question, ctx);
  }
  // Map the composed row back to the bare label the model authored.
  const label = options[labels.indexOf(selected)]?.label ?? selected;
  return answered("User selected: ", label);
}

export default function askUserExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ask_user",
    label: "Ask user",
    description:
      "When the next step depends on a decision only the user can make, ask it here instead of ending your turn with a prose question — the user answers by picking an option. Covers a choice among concrete options, an ambiguous requirement, a preference, or confirming something risky. Pass 2-4 options when the choice can be enumerated; omit options for a genuinely open question, answered in the free-form editor. An 'Other (type your answer)' row is always appended; a dismissed dialog means no answer — fall back to plain prose once and do not re-ask.",
    promptSnippet:
      "Ask the user a single decision question with typed options — they pick one instead of typing.",
    promptGuidelines: [
      "Prefer ask_user over a prose question whenever your turn would otherwise end with a question only the user can answer",
      "Put your recommended option first and append '(Recommended)' to its label",
      "One question per call: ask the most blocking decision first, never a bundle",
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
