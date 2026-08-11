<p align="center">
  <img src="./docs/banner.webp" alt="A crystalline lens translating an image into structured marks" width="100%">
</p>

<h1 align="center">@bytetrue/pi-vision</h1>

<p align="center">Let a text-only Pi model understand images through a vision-capable model you already configured.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bytetrue/pi-vision"><img src="https://img.shields.io/npm/v/@bytetrue/pi-vision?style=flat-square" alt="npm version"></a>
</p>

`pi-vision` uses models and credentials from your existing `models.json`. It adds no provider configuration and chooses no model for you.

## Install

```bash
pi install npm:@bytetrue/pi-vision
```

Restart or reload Pi, then select a model:

```text
/vision
```

The menu lists models whose Pi configuration declares image input. There is deliberately no default, so the extension cannot silently choose an expensive provider.

If the list is empty, first add a model whose `input` includes `image` to Pi's `models.json`, then rerun `/vision`. [`@bytetrue/pi-vendor`](https://www.npmjs.com/package/@bytetrue/pi-vendor) can manage that configuration.

## Two ways to use it

| Mode | Best for | How it works |
| --- | --- | --- |
| `image_ask(paths, question)` | Local files, comparisons, and focused follow-ups | The Agent sends one or more local images plus a specific question to the configured vision model |
| Automatic attachment analysis | Images attached through Pi startup, print mode, or RPC | The extension analyzes the whole batch before the first text-only main-model call |

Enable or disable automatic mode explicitly:

```text
/vision auto on
/vision auto off
```

Automatic mode is off by default because enabling it sends attachments and the current request to another provider.

> [!NOTE]
> Pi's interactive <kbd>Ctrl</kbd>+<kbd>V</kbd> image paste becomes a local file path in the input. That path uses `image_ask`; it is not an automatic attachment. The same applies when you paste or mention any local image path.

## `image_ask`

```text
image_ask(paths, question)
```

- `paths` — local PNG, JPEG, GIF, or WebP files, absolute or relative to the current working directory.
- `question` — the specific detail the vision model should answer.

Ask naturally:

> Compare `/tmp/mockup.png` with `/tmp/render.png` and list the visible layout differences.

Pass several paths together to compare a mockup with a rendered page, or successive screenshots of the same flow. HTTP(S) URLs are not accepted; download the image first.

If a text-only model tries Pi's built-in `read` tool on an image, the extension appends a short pointer to `image_ask` instead of leaving the model at a dead end.

## Automatic-mode limits

One request may contain up to four images with a combined decoded size of 20 MiB. The batch has a fixed 60-second deadline and is rejected as a whole if validation fails.

Success or failure is injected before the main model starts. A failure explicitly tells the main model that it did not see the images, reducing the risk of a fabricated visual answer.

Trusted project settings may override the global configuration. An untrusted project cannot enable attachment forwarding.

## Settings

`/vision` writes only the `pi-vision` section and preserves every other Pi setting:

```json
{
  "pi-vision": {
    "model": "provider/vision-model",
    "autoAnalyzeAttachments": false
  }
}
```

The global file is normally `~/.pi/agent/settings.json`. A trusted project may override it with `<project>/.pi/settings.json`.

When the current main model already accepts images, `image_ask` is removed from active tools and the extension stays out of Pi's normal image path.

## Development

```bash
npm --workspace @bytetrue/pi-vision test
npm --workspace @bytetrue/pi-vision run typecheck
npm --workspace @bytetrue/pi-vision pack --dry-run
```

Requires `@earendil-works/pi-coding-agent >=0.79.10`.
