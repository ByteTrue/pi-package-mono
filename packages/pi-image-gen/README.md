# @bytetrue/pi-image-gen

> Forked from [`@amaster.ai/pi-image-gen`](https://github.com/TGYD-helige/pi/tree/master/packages/pi-image-gen), Apache-2.0. See [NOTICE](NOTICE).

Image generation for Pi with two deliberately separate surfaces:

- `/image-gen` — complete TUI setup for people: provider, model, endpoint, credential, headers, output directory.
- `pi-image-gen` Skill + bundled CLI — loaded only when the agent actually needs to generate or edit an image. The package does **not** register a permanent Agent tool.

Supported image API protocols: OpenAI, Google Gemini, Alibaba DashScope, Volcengine Ark, and OpenRouter.

## Install

```sh
pi install npm:@bytetrue/pi-image-gen
```

Restart Pi, run `/image-gen`, choose a built-in or custom provider, and finish the wizard. No manual JSON editing is required.

For local development, build first because the package entry and Skill CLI use `dist`:

```sh
npm --workspace @bytetrue/pi-image-gen run build
pi install /absolute/path/to/pi-package-mono/packages/pi-image-gen
```

## Configure in Pi

Run `/image-gen` and choose:

- **Configure a built-in provider and model** — OpenAI, Gemini, DashScope, Ark, or OpenRouter.
- **Configure a custom provider and model** — choose one of the five wire protocols, then set the endpoint and model id.
- **Set output directory**.
- **Show effective configuration** — reports the route without printing credentials.

Credential choices are:

- the provider's standard environment variable;
- another `$ENV_VAR` reference;
- a literal key entered through a masked TUI field;
- no key for a local/keyless endpoint.

The wizard can write either the active global settings or, when Pi trusts the project, `<cwd>/.pi/settings.json`. Writes are atomic and `0600`; malformed files are never overwritten.

All configuration remains under the `pi-image-gen` key in Pi `settings.json`:

1. `~/.pi/agent/settings.json`;
2. `$PI_CODING_AGENT_DIR/settings.json` or `$PI_AGENT_HOME/settings.json` when set;
3. trusted `<cwd>/.pi/settings.json`.

Project settings are ignored by the normal Skill CLI path unless the running Pi session explicitly trusts that exact working directory. This prevents an untrusted repository from replacing an endpoint while reusing a global or environment credential during normal package use; it is not a sandbox against an actively modified shell invocation.

## Generate from Pi

Ask normally, for example:

> Generate a cinematic 16:9 image of a lunar research station.

Pi loads the bundled Skill, which invokes the CLI and returns generated files as inline markdown. To edit or preserve a character/style, attach a local image path or refer to a previous generated path.

The active model is fixed by `/image-gen`; the CLI has no model override. This keeps routing intentional and reproducible.

## Providers and built-in models

| Provider | Built-in models / addressing | Standard env var |
| --- | --- | --- |
| OpenAI | `gpt-image-2` | `OPENAI_API_KEY` |
| Gemini | `gemini-3-pro-image`, `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-2.5-flash-image` and Nano Banana aliases | `GEMINI_API_KEY` |
| DashScope | `qwen-image-2.0-pro`, `qwen-image-2.0` | `DASHSCOPE_API_KEY` |
| Ark | Seedream 4/4.5/5 model ids and aliases | `ARK_API_KEY` |
| OpenRouter | `openrouter/<vendor>/<model>` | `OPENROUTER_API_KEY` |

Custom providers use one of those wire protocols but may supply any endpoint and model id.

## Advanced settings shape

The TUI writes this shape and preserves unrelated Pi settings:

```json
{
  "pi-image-gen": {
    "defaultModel": "my-sd/sd-3-large",
    "outputDir": ".pi/images",
    "providers": {
      "openai": {
        "baseUrl": "https://proxy.example.com/v1",
        "apiKey": "$OPENAI_API_KEY",
        "headers": { "x-tenant": "team-a" }
      }
    },
    "customProviders": {
      "my-sd": {
        "api": "openai",
        "baseUrl": "https://api.example.com/v1",
        "apiKey": "$SD_KEY",
        "headers": { "x-tenant": "team-a" },
        "models": [{ "id": "sd-3-large", "alias": "sd3" }]
      }
    }
  }
}
```

`apiKey`, `baseUrl`, and header values support `$VAR`, `${VAR}`, and `${VAR:-fallback}` interpolation.

When the TUI explicitly selects `No API key` or `No extra headers`, it writes `apiKey: ""` or `headers: {}`. These are intentional tombstones: they suppress credentials and headers inherited from lower settings layers, and an empty built-in `apiKey` also suppresses the provider's standard environment-variable fallback.

Relative output directories resolve against the Pi session cwd. The default is `.pi/images`.

## Bundled CLI contract

The Skill calls `skills/pi-image-gen/scripts/image-gen.mjs`. It reads one JSON object from stdin:

```json
{
  "prompt": "A watercolor lighthouse in a winter storm",
  "image": ["/optional/reference.png"],
  "n": 1,
  "size": "1024x1024",
  "filename": "winter-lighthouse"
}
```

- `prompt` is required.
- `image` is an optional array of local paths or `http(s)` URLs.
- `n` is 1–8.
- `size` is provider-specific.
- `filename` and `outputDir` are optional.

Use `/image-gen` rather than invoking the CLI manually for setup. The CLI never prints credentials.

## Development checks

```sh
npm --workspace @bytetrue/pi-image-gen test
npm --workspace @bytetrue/pi-image-gen run typecheck
node packages/pi-image-gen/scripts/pack-smoke.mjs
```
