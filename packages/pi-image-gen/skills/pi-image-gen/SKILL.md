---
name: pi-image-gen
description: Generate or edit images with the user's configured pi-image-gen model. Use when the user asks to create, generate, draw, render, transform, restyle, or edit an image. Do not use for merely viewing or analyzing an existing image.
---

# Pi Image Gen

Generate through the package CLI; do not call provider APIs directly and do not inspect settings for credentials.

## Before running

- The user configures the active model with `/image-gen` in Pi. If the CLI says it is not configured, ask the user to run that command.
- Resolve `scripts/image-gen.mjs` relative to this skill directory.
- Reference images must be file paths or `http(s)` URLs. Pass a previous output path to iterate on it. Never pass base64 or `data:` URIs.

## Execute

Send one JSON object on stdin. Use a quoted heredoc delimiter so prompts are not shell-expanded:

```bash
node scripts/image-gen.mjs generate <<'PI_IMAGE_GEN_REQUEST'
{
  "prompt": "A precise description of the requested image",
  "image": ["/optional/reference.png"],
  "n": 1,
  "size": "1024x1024",
  "filename": "descriptive-name"
}
PI_IMAGE_GEN_REQUEST
```

Fields:

- `prompt` — required non-empty string.
- `image` — optional array of local paths or `http(s)` URLs.
- `n` — optional integer 1–8, default 1.
- `size` — optional provider-specific size hint.
- `filename` — optional safe filename prefix.
- `outputDir` — optional one-run override; normally let `/image-gen` settings decide.

Omit optional fields that the user did not request. Do not invent a model argument: the active model is fixed in settings.

## Return

On success, copy every emitted image markdown line into the user reply so Pi renders the files inline. Mention a revised prompt only when the CLI emits it. On failure, report the CLI's local error; never print settings or credential values.
