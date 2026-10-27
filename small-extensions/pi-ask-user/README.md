# pi-ask-user

A minimal `ask_user` tool for Pi: when a user decision has concrete choices,
the model calls `ask_user` instead of writing a prose question, and you pick
options with arrow keys + Enter instead of typing `第一个…第二个…` by hand.

It exists because without a tool the model's question format drifts every
session — one structured tool with `promptGuidelines` pins the format, and each
answer becomes a few keystrokes across both TUI and RPC (BySpace) modes.

## What it does

Registers one tool:

- **`ask_user(questions)`** — 1–4 decision or clarification questions per call.
  - `questions`: array of `{question, options?, multiple?}` items (a single
    question is simply a 1-item array; legacy top-level `{question, options?,
    multiple?}` is also accepted at runtime).
  - **Single-select (`options` without `multiple: true`)**: rendered through
    Pi's built-in `ctx.ui.select` dialog with an always-appended
    **"Other (type your answer)"** row.
  - **Multi-select (`multiple: true`)**: rendered through a `ctx.ui.select`
    checklist loop where picking an option toggles `[✓]` / `[ ]`, picking
    **"Other (type your answer)"** merges custom text into the checklist as
    `[✓] Other: …`, and **"✓ Done (N selected)"** confirms the question.
  - **Back-navigation (`questions.length > 1`)**: questions 2..N include a
    **"← Back to previous question"** row so you can return to an earlier
    question and revise its answer (previous selections are preserved).
  - **Open question (no `options`)**: answered through the built-in multiline
    editor (TUI) or input dialog (RPC).
  - **Dismiss (Esc)**: returns a fixed "dismissed" text so the model falls back
    to plain prose instead of re-asking.
  - **No dialog-capable UI (print/JSON mode)**: explicit error — the tool never
    guesses an answer.

Built-in dialogs only: no custom TUI components, no overlay, no runtime
imports, no timeout, no config.

### Every dialog runs with the working spinner hidden

While any of these dialogs is open, the extension calls
`ui.setWorkingVisible(false)` and restores it in a `finally` block. Pi's
working spinner (a `pi-tui` Loader) re-renders the whole alt-screen frame every
80ms — 12.5 frames/s, transcript included — for as long as the dialog waits.
Nothing on screen changes during that wait, and users routinely leave an
`ask_user` dialog open for over an hour (676 minutes in the longest recorded
call); that much sustained redraw was enough to wedge Windows Terminal
(`Application Hang` / `RADAR_PRE_LEAK_64` in the event log). Hiding the spinner
actually disposes the loader's `setInterval`, so the frames stop instead of
merely being drawn invisible.

Known limits, deliberately not fixed here:

- **Only `ask_user`.** Other extension dialogs (`/model` picker, confirmations,
  login prompts, `showExtensionConfirm` / `showExtensionEditor`) still spin
  while they wait.
- **Restore re-enables Pi's default, not the caller's value.**
  `setWorkingVisible` has no getter, so if some extension globally hid the
  spinner, `ask_user` turning it back on would override that. No extension in
  this repo does that today.
- **The terminal-side root cause is outside this boundary.** If hangs persist,
  the next step is a newer Windows Terminal (1.25+) or WezTerm, not another
  patch here. The real general fix belongs upstream: pause the working
  indicator while a dialog is pushed onto the extension-dialog stack.
- Non-TUI modes (print / JSON / RPC) are untouched — they have no spinner.

The tool declares `constrainedSampling: {type: "json_schema", strict: "prefer"}`,
the same request Pi's built-in `read`/`bash`/`edit`/`write` tools make. Strict
mode lets the provider constrain the argument text to a valid JSON object, which
removes the whole class of "Invalid arguments: … after JSON at position N"
failures — trailing text, a doubled closing brace, or duplicated stream deltas
from a proxy. `prefer` means a provider without strict support still gets the
tool, just unconstrained.

### Where the model sees this (why the wording is trigger-first)

The registration text is the only lever this extension has, and where it lands
depends on the session:

- **Direct mode** (a session that declares `ask_user`): `promptSnippet` goes
  into `<tools>`, `promptGuidelines` into `<rules>`.
- **`codemode.mode: "only"`**, and any other hidden declaration: Pi leaves
  hidden tools out of `<tools>` *and* `<rules>`, so codemode inlines the
  description plus guidelines into its own tool description — a ~3k-token
  catalog of every callable tool. Nothing is lost, but the rule then sits deep
  in a tool listing instead of in the rules section.

So the description opens with the trigger condition ("when the next step
depends on a decision only the user can make…") rather than a mechanics
sentence, and the guidelines carry the batching, multi-select, recommendation,
and do-not-ask rules.

If asking still drifts under `codemode.mode: "only"`, the remaining lever is a
`before_agent_start` handler appending one bullet to `sections.rules`
(precedent: the since-removed `pi-codemode-only` small extension). Considered
and deliberately not taken — revisit only with evidence that the wording alone
is not enough.

## Install

Same channel as the other small extensions — run the repo's installer and tick `pi-ask-user` in the menu; the command is in [small-extensions → Install](../#install).

Restart or reload Pi afterwards.

## History

The repo previously carried a fuller `@bytetrue/pi-ask-user` package and
removed it for the minimal-tool principle (issues 043/047). This single-file
form is the re-scoped version: the user re-judged the daily-interaction pain
(question format drift, typed answers) as worth one small tool, and asked for
the lightest possible shape — built-in dialogs, plain JSON schema, zero runtime
imports.

## Tests

`npm --workspace pi-ask-user test` covers registration, single-select option
composition, multi-select toggling and custom `Other` merging, multi-question
batching with back-navigation, the freeform path, dismiss semantics, mode
guards, schema shape (plain JSON Schema, no TypeBox runtime symbols, still
convertible to the strict subset so `strict: "prefer"` can engage), and spinner
suppression (hide/restore on every path, one symmetric pair per dialog, fully
skipped outside TUI mode, restored even when the dialog throws).
