<p align="center">
  <img src="./docs/banner.webp" alt="A precise aperture transforming a prompt stream into an image plane" width="100%">
</p>

<h1 align="center">@bytetrue/pi-image-gen</h1>

<p align="center">Generate and edit images from Pi without carrying a permanent Agent tool.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bytetrue/pi-image-gen"><img src="https://img.shields.io/npm/v/@bytetrue/pi-image-gen?style=flat-square" alt="npm version"></a>
</p>

> Forked from [`@amaster.ai/pi-image-gen`](https://github.com/TGYD-helige/pi/tree/master/packages/pi-image-gen). Redistribution details are preserved in [NOTICE](NOTICE).

The package deliberately has two surfaces:

- `/image-gen` gives people a complete TUI setup flow.
- The `pi-image-gen` Skill and bundled CLI load only when the Agent needs to create or edit an image.

No permanent `image_generate` tool schema is added to every request.

## Install

```bash
pi install npm:@bytetrue/pi-image-gen
```

Restart Pi and run:

```text
/image-gen
```

Choose a built-in or custom provider, select a model, configure credentials, and set an output directory. Normal setup never requires editing JSON by hand.

## Generate from Pi

Ask normally:

> Generate a cinematic 16:9 image of a lunar research station.

For an edit or a consistent character/style, attach a local reference image or mention a previously generated path. The Skill invokes the bundled CLI and returns generated files as inline Markdown.

The configured `defaultModel` is always used; the CLI does not accept a model override.

## Providers

| Protocol | Built-in routing | Standard environment variable |
| --- | --- | --- |
| OpenAI | `gpt-image-2` | `OPENAI_API_KEY` |
| Google Gemini | Gemini image models and Nano Banana aliases | `GEMINI_API_KEY` |
| Alibaba DashScope | Qwen Image models | `DASHSCOPE_API_KEY` |
| Volcengine Ark | Seedream models and aliases | `ARK_API_KEY` |
| OpenRouter | `openrouter/<vendor>/<model>` | `OPENROUTER_API_KEY` |

Custom providers select one of these wire protocols and supply their own endpoint and model id.

## Configuration

`/image-gen` can write either the active global settings or a trusted project's `<cwd>/.pi/settings.json`. All fields stay under `pi-image-gen`; unrelated Pi settings are preserved.

Credential choices include:

- the provider's standard environment variable;
- another `$ENV_VAR` reference;
- a literal key entered in a masked field; or
- no key for a local or keyless endpoint.

Writes use an atomic `0600` path and refuse to overwrite malformed settings. Selecting **No API key** writes `apiKey: ""`, blocking lower-layer and standard-environment credentials. Selecting **No extra headers** writes `headers: {}`, blocking inherited headers.

Relative output directories resolve from the Pi session working directory. The default is `.pi/images`.

<details>
<summary>Optional settings shape</summary>

```json
{
  "pi-image-gen": {
    "defaultModel": "my-sd/sd-3-large",
    "outputDir": ".pi/images",
    "providers": {
      "openai": {
        "baseUrl": "https://proxy.example.com/v1",
        "apiKey": "$OPENAI_API_KEY"
      }
    },
    "customProviders": {
      "my-sd": {
        "api": "openai",
        "baseUrl": "https://api.example.com/v1",
        "apiKey": "$SD_KEY",
        "models": [{ "id": "sd-3-large", "alias": "sd3" }]
      }
    }
  }
}
```

`apiKey`, `baseUrl`, and header values support `$VAR`, `${VAR}`, and `${VAR:-fallback}` interpolation.

</details>

## Skill CLI

The bundled Skill sends one JSON object to `skills/pi-image-gen/scripts/image-gen.mjs`:

```json
{
  "prompt": "A watercolor lighthouse in a winter storm",
  "image": ["/optional/reference.png"],
  "n": 1,
  "size": "1024x1024",
  "filename": "winter-lighthouse"
}
```

`prompt` is required. `image`, `n` (1–8), `size`, `filename`, and `outputDir` are optional. Image inputs may be local paths or HTTP(S) URLs. The CLI never prints configured credentials.

> [!IMPORTANT]
> Project settings participate only when the running Pi session trusts that exact working directory. This prevents an untrusted repository from changing the endpoint while inheriting a global or environment credential during normal Skill use.

## Development

This package builds `dist` because the extension and Skill CLI share one production core:

```bash
npm --workspace @bytetrue/pi-image-gen test
npm --workspace @bytetrue/pi-image-gen run typecheck
node packages/pi-image-gen/scripts/pack-smoke.mjs
```
