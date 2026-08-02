# @bytetrue/pi-vision

Let a text-only model read images, by asking a vision-capable model from your own `models.json`.

If your main model can't see images — you paste a screenshot and it says "I can't see it" — this
adds one tool, `image_ask`, that hands the image to a model that can, and returns a text answer.

## Install

```bash
pi install @bytetrue/pi-vision
# or, from a local checkout
pi install /absolute/path/to/pi-package-mono/packages/pi-vision
```

## Configure

```
/vision
```

Picks from the vision-capable models already in your `models.json` and saves the choice to
`~/.pi/agent/settings.json`, preserving every other setting and the file's permissions.

There is no default model on purpose: auto-picking would silently use whichever vision model
happens to be first in your `models.json`, which can be an expensive one.

Equivalent by hand, in `~/.pi/agent/settings.json` (or `<project>/.pi/settings.json`, which wins):

```json
{
  "pi-vision": { "model": "bytetrueapi/qwen3.7-plus" }
}
```

Credentials come from your existing `models.json`; this package stores none of its own.

## Use

Nothing to learn. Paste a screenshot (pi's `ctrl+v` already saves it to a file and inserts the
path) or point at any image file, and ask:

```
/tmp/pi-clipboard-3f2a.png the submit button looks misaligned, fix it
```

The agent calls `image_ask` with that path and its own specific question, gets a text answer,
and keeps working.

If the agent reaches for the built-in `read` tool instead and pi tells it the image was dropped,
this extension appends a pointer to `image_ask` so it isn't a dead end.

### `image_ask(paths, question)`

- `paths` — local image files (PNG, JPEG, GIF, WebP), absolute or relative to cwd. Pass several
  at once to compare them, e.g. a mockup and the actual render.
- `question` — what you need to know. You get one text answer, not the image, so ask for the
  specific detail; ask again for follow-ups.

## What it does not do

- No provider config of its own — vision models are ordinary chat models in `models.json`.
- No API keys of its own — `/vision` only ever writes one field, `pi-vision.model`.
- No URLs. Download the file first, then pass the path.
- No automatic image description on paste; the agent asks its own question, which beats a
  generic description for the "why is this UI wrong" case.
- Nothing when your current model already accepts images — `read` behaves exactly as before.

## Development

```bash
npm --workspace @bytetrue/pi-vision test
npm --workspace @bytetrue/pi-vision run typecheck
```
