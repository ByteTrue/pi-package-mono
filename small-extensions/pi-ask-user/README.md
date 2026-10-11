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

## Install

Same channel as the other small extensions — from this repo's `main` branch:

```bash
curl -fsSL https://raw.githubusercontent.com/ByteTrue/pi-package-mono/main/scripts/install-small-extension.sh | bash
```

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
