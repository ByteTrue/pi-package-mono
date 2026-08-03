# @bytetrue/pi-vision

Let a text-only model read images by delegating to a vision-capable model from your own `models.json`.

Use the opt-in automatic mode to analyze attached images before the first main-model call, or keep the
`image_ask` tool for explicit local files and follow-up questions.

## Install

```bash
pi install @bytetrue/pi-vision
# or, from a local checkout
pi install /absolute/path/to/pi-package-mono/packages/pi-vision
```

## Configure

```
/vision
/vision auto on
```

`/vision` picks from the vision-capable models already in your `models.json`. `/vision auto on` then
opts into analyzing images attached to the current user message before the first main-model call;
`/vision auto off` disables it. Settings are saved to `~/.pi/agent/settings.json`, preserving every
other setting and the file's permissions.

There is no default model and automatic mode is off by default. This prevents an unexpected provider
from receiving attachments or silently choosing an expensive model.

Equivalent by hand, in `~/.pi/agent/settings.json` (or `<project>/.pi/settings.json`, which wins only
after Pi marks the project trusted):

```json
{
  "pi-vision": {
    "model": "bytetrueapi/qwen3.7-plus",
    "autoAnalyzeAttachments": true
  }
}
```

Credentials come from your existing `models.json`; this package stores none of its own.

## Use

With automatic mode enabled, attach up to four PNG/JPEG/GIF/WebP images to a user message. The
extension sends the complete batch plus that user request to the configured vision provider once,
then injects the answer before the text-only main model starts. The batch must stay within 20MB and
passes MIME header validation; it is rejected as a whole rather than silently dropping images.

The UI reports the provider/model used or a failure. A failure is also injected into model context so
the main model cannot claim it saw the images and can explicitly retry with `image_ask`.

For local image paths or a more specific follow-up, ask normally:

```
/tmp/pi-clipboard-3f2a.png the submit button looks misaligned, fix it
```

The agent calls `image_ask` with that path and its own focused question.

If the agent reaches for the built-in `read` tool instead and pi tells it the image was dropped,
this extension appends a pointer to `image_ask` so it isn't a dead end.

### `image_ask(paths, question)`

- `paths` — local image files (PNG, JPEG, GIF, WebP), absolute or relative to cwd. Pass several
  at once to compare them, e.g. a mockup and the actual render.
- `question` — what you need to know. You get one text answer, not the image, so ask for the
  specific detail; ask again for follow-ups.

## What it does not do

- No provider config or API keys of its own — vision models and credentials stay in `models.json`.
- `/vision` writes only `pi-vision.model` and `pi-vision.autoAnalyzeAttachments`.
- No URLs. Download the file first, then pass the path.
- No fallback chains, automatic model switching or cache.
- Nothing when your current model already accepts images — `read` behaves exactly as before.

## Development

```bash
npm --workspace @bytetrue/pi-vision test
npm --workspace @bytetrue/pi-vision run typecheck
```
