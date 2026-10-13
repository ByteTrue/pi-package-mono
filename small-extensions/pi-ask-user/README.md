# pi-ask-user

A minimal `ask_user` tool for Pi: when a user decision has concrete choices,
the model calls `ask_user` instead of writing a prose question, and you pick
an option with arrow keys + Enter instead of typing `第一个…第二个…` by hand.

It exists because without a tool the model's question format drifts every
session — one structured tool with `promptGuidelines` pins the format, and the
answer becomes three keystrokes.

## What it does

Registers one tool:

- **`ask_user(question, options?)`** — one decision or clarification question
  per call.
  - `options`: 2–4 `{label, description?}` choices. Rendered through Pi's
    built-in `ctx.ui.select` dialog with an always-appended
    **"Other (type your answer)"** row.
  - No `options`: an open question, answered through the built-in multiline
    editor (TUI) or input dialog (RPC).
  - Dismiss (Esc): returns a fixed "dismissed" text so the model falls back to
    plain prose instead of re-asking.
  - No dialog-capable UI (print/JSON mode): explicit error — the tool never
    guesses an answer.

Built-in dialogs only: no custom TUI, no overlay, no batch forms, no timeout,
no config. Anything heavier belongs upstream of this file's ambition.

### Where the model sees this (why the wording is trigger-first)

The registration text is the only lever this extension has, and where it lands
depends on the session:

- **Direct mode** (a session that declares `ask_user`): `promptSnippet` goes
  into `<tools>`, `promptGuidelines` into `<rules>`.
- **`codemode.mode: "only"`**, and any other hidden declaration: Pi leaves
  hidden tools out of `<tools>` *and* `<rules>`, so codemode inlines the
  description plus guidelines into its own tool description — a ~3k-token
  catalog of every callable tool. Nothing is lost, but the rule then sits deep
  in a tool listing instead of in the rules section. Measured on a real
  codemode-only session (13 callable tools, `inlineBudget: 6000`): all 13
  sections are present, `ask_user` among them, ~238 tokens. The budget only
  starts dropping sections when the catalog outgrows it.

So the description opens with the trigger condition ("when the next step
depends on a decision only the user can make…") rather than a mechanics
sentence, and the guidelines carry the behaviour the description cannot restate
in the rules section. ~230 tokens once per session, cached with the declaration.

If asking still drifts under codemode-only, the remaining lever is a
`before_agent_start` handler appending one bullet to `sections.rules`
(precedent: `pi-codemode-only`). Considered and deliberately not taken —
revisit only with evidence that the wording alone is not enough.

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

`npm --workspace pi-ask-user test` covers registration, option composition,
the Other/freeform path, dismiss semantics, mode guards, and schema shape
(plain JSON Schema, no TypeBox runtime symbols).
