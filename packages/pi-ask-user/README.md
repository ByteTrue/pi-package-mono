# @bytetrue/pi-ask-user

Adds the OpenCode-compatible `question` tool to Pi.

The tool lets the model ask one or more structured questions during execution:

- `questions` is an array of `{ question, header, options, multiple? }`.
- Each option is `{ label, description }`.
- A `Type your own answer` option is added automatically.
- Single-choice questions submit immediately; multiple questions and multi-select questions use a Confirm page.
- Answers returned to the model are arrays of selected labels, using OpenCode's exact output format.
- Escape dismisses the question and fails the tool call instead of inventing an answer.

## Install

```bash
pi install npm:@bytetrue/pi-ask-user
```

Or from this checkout:

```bash
pi install /absolute/path/to/pi-package-mono/packages/pi-ask-user
```

The interactive question UI is available in Pi's TUI mode. The tool fails explicitly in print and JSON modes because there is no user input surface.

## Development

```bash
npm --workspace @bytetrue/pi-ask-user test
npm --workspace @bytetrue/pi-ask-user run typecheck
```
