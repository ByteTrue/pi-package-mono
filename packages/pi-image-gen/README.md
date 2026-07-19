# @bytetrue/pi-image-gen

> Forked from [`@amaster.ai/pi-image-gen`](https://github.com/TGYD-helige/pi/tree/master/packages/pi-image-gen), Apache-2.0. See [NOTICE](NOTICE).

Pi extension that adds an `image_generate` tool. Supported providers:

| Provider                       | Model id (alias)                              | Env var               |
| ------------------------------ | --------------------------------------------- | --------------------- |
| OpenAI                         | `gpt-image-2`                                 | `OPENAI_API_KEY`      |
| Google Gemini ("Nano Banana")  | `gemini-3-pro-image` (alias `nano-banana-pro`), `gemini-3.1-flash-image` (alias `nano-banana-2`), `gemini-3.1-flash-lite-image` (alias `nano-banana-2-lite`), `gemini-2.5-flash-image` (alias `nano-banana`) | `GEMINI_API_KEY` |
| Alibaba DashScope (Qwen-Image) | `qwen-image-2.0-pro`, `qwen-image-2.0`          | `DASHSCOPE_API_KEY`   |
| Volcengine Ark (ByteDance Seedream) | `doubao-seedream-5-0-pro-260128` (alias `seedream-5-pro`), `doubao-seedream-5-0-260128` (alias `seedream-5`, `seedream`), `doubao-seedream-5-0-lite-260128` (alias `seedream-5-lite`), `doubao-seedream-4-5-251128` (alias `seedream-4-5`), `doubao-seedream-4-0-250828` (alias `seedream-4`) | `ARK_API_KEY`         |
| OpenRouter                     | any (use `openrouter/<vendor>/<id>`)          | `OPENROUTER_API_KEY`  |
| Custom providers               | whatever you declare in settings              | (your choice, via `$VAR`) |

Upstream API docs (handy when debugging gateway behavior or adding new models):

- OpenAI gpt-image-2 — [developers.openai.com/api/docs/models/gpt-image-2](https://developers.openai.com/api/docs/models/gpt-image-2)
- Google Gemini image generation — [ai.google.dev/gemini-api/docs/image-generation](https://ai.google.dev/gemini-api/docs/image-generation)
- Alibaba DashScope Qwen-Image (text-to-image) — [help.aliyun.com/zh/model-studio/text-to-image](https://help.aliyun.com/zh/model-studio/text-to-image)
- Alibaba DashScope Qwen-Image-Edit — [help.aliyun.com/zh/model-studio/qwen-image-edit-guide](https://help.aliyun.com/zh/model-studio/qwen-image-edit-guide)
- Volcengine Ark Seedream — [volcengine.com/docs/82379/1824121](https://www.volcengine.com/docs/82379/1824121)
- OpenRouter image API — [openrouter.ai/docs/api/api-reference/images/create-images](https://openrouter.ai/docs/api/api-reference/images/create-images)

The env-var names match [pi.dev's provider table](https://pi.dev/docs/latest/providers) — if the agent already has a key set for a provider, this extension will reuse it. You don't need to introduce a new variable.

The active model is **fixed in settings.json**. The `image_generate` tool intentionally does **not** take a `model` parameter — point your project at one model, get consistent output. To switch models, edit settings and run `/image-gen reload`.

```sh
pi install npm:@bytetrue/pi-image-gen
```

For local development:

```sh
pi install /absolute/path/to/pi-package-mono/packages/pi-image-gen
```

The published package bundles its small Apache-2.0 configuration helper dependency, so it works when installed by pi without relying on an ambient npm workspace.

The package's `pi.extensions` field auto-registers it with the host pi-coding-agent runtime; no extra wiring needed.

## Configure

1. `~/.pi/agent/settings.json` (global)
2. `$PI_CODING_AGENT_DIR/settings.json` or `$PI_AGENT_HOME/settings.json` (override)
3. `<cwd>/.pi/settings.json` (project)

All settings live under the `pi-image-gen` key. The minimum viable config sets `defaultModel`:

```json
{
  "pi-image-gen": {
    "defaultModel": "nano-banana"
  }
}
```

…and exports the matching env var:

```sh
export GEMINI_API_KEY=sk-...
```

That's it. From the agent: `image_generate({ prompt: "a cyberpunk cat" })`.

### All settings fields

```json
{
  "pi-image-gen": {
    "defaultModel": "nano-banana",
    "outputDir": ".pi/images",

    "providers": {
      "openai":     { "baseUrl": "https://my-proxy.example.com/v1", "apiKey": "${MY_OPENAI_KEY}" },
      "gemini":     { "headers": { "x-goog-trace": "pi-prod" } },
      "dashscope":  { "baseUrl": "https://dashscope-intl.aliyuncs.com/api/v1" },
      "ark":        { "apiKey": "$ARK_API_KEY" },
      "openrouter": { "apiKey": "$OPENROUTER_API_KEY" }
    },

    "customProviders": {
      "my-stable-diffusion": {
        "api": "openai",
        "baseUrl": "https://api.my-sd.example.com/v1",
        "apiKey": "${MY_SD_KEY}",
        "headers": { "x-tenant": "team-a" },
        "models": [
          { "id": "sd-3-large", "alias": "sd3" },
          "sd-3-medium"
        ]
      }
    }
  }
}
```

| Field             | Purpose                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `defaultModel`    | Model id or alias the tool will use. **Required.**                                       |
| `outputDir`       | Where to write generated images. Relative paths resolve against the session cwd. Default `.pi/images`. |
| `providers`       | Per-built-in-provider override. Set `apiKey`, `baseUrl`, or `headers` to point at a proxy or non-standard env var. |
| `customProviders` | User-defined providers — see below.                                                      |

`apiKey`, `baseUrl`, and `headers` values support `$VAR` and `${VAR}` env interpolation, with `:-` fallback (e.g. `${FOO:-default}`).

## Built-in setup walkthrough

### 1. OpenAI (`gpt-image-2`)

```sh
export OPENAI_API_KEY=sk-...
```

```json
{ "pi-image-gen": { "defaultModel": "gpt-image-2" } }
```

### Claude Code Hub (`gpt-image-2`)

CCH must route `gpt-image-2` through an enabled **OpenAI Compatible** provider. Then configure the extension with CCH's `/v1` base URL and a CCH API key:

```json
{
  "pi-image-gen": {
    "defaultModel": "gpt-image-2",
    "providers": {
      "openai": {
        "baseUrl": "http://localhost:23000/v1",
        "apiKey": "$CCH_API_KEY"
      }
    }
  }
}
```

Verify the active route with `/image-gen list`, then call `image_generate({ prompt: "…" })`.

### 2. Google Gemini "Nano Banana"

```sh
export GEMINI_API_KEY=...
```

```json
{ "pi-image-gen": { "defaultModel": "nano-banana" } }
```

### 3. Alibaba DashScope (Qwen-Image)

```sh
export DASHSCOPE_API_KEY=...
```

```json
{ "pi-image-gen": { "defaultModel": "qwen-image-2.0" } }
```

For the international DashScope endpoint, override the base URL:

```json
{
  "pi-image-gen": {
    "defaultModel": "qwen-image-2.0",
    "providers": {
      "dashscope": { "baseUrl": "https://dashscope-intl.aliyuncs.com/api/v1" }
    }
  }
}
```

### 4. Volcengine Ark (ByteDance Seedream)

```sh
export ARK_API_KEY=...
```

```json
{ "pi-image-gen": { "defaultModel": "seedream" } }
```

> Supported `size` values are model-dependent. Seedream 5.0 / 5.0 lite / 4.5 require 2K or larger (e.g. `2048x2048`, `1728x2304`, `2848x1600`) — `1024x1024` will fail with `InvalidParameter`. Seedream 4.0 is the only one that accepts 1K sizes. Full sizing matrix in the [official docs](https://www.volcengine.com/docs/82379/1824121). Other built-in providers default to `1024x1024`, so this is the one knob to remember when switching to Seedream ≥ 4.5.

The default base URL is `https://ark.cn-beijing.volces.com/api/v3`. To use a different region (e.g. `ap-southeast`), override it:

```json
{
  "pi-image-gen": {
    "defaultModel": "seedream",
    "providers": {
      "ark": { "baseUrl": "https://ark.ap-southeast.bytepluses.com/api/v3" }
    }
  }
}
```

### 5. OpenRouter (one key, many models)

```sh
export OPENROUTER_API_KEY=...
```

```json
{ "pi-image-gen": { "defaultModel": "openrouter/bytedance-seed/seedream-4.5" } }
```

The string after `openrouter/` is the OpenRouter model slug; pass any image model OpenRouter supports (`google/gemini-3.1-flash-image`, `openai/gpt-image-2`, `bytedance-seed/seedream-4.5`, …).

OpenRouter's image API is **not** OpenAI-compatible despite the family name — it lives at `POST /api/v1/images` (no `/generations` suffix) and uses JSON `input_references` for image-to-image. The extension targets the right endpoint automatically; no wire-shape config needed.

## Custom providers

Use `customProviders` for anything not built in: a self-hosted Stable Diffusion, an internal corp gateway, a third-party image API. The shape mirrors [pi.dev's custom-provider docs](https://pi.dev/docs/latest/custom-provider).

Each custom provider declares:

| Field      | Required | Notes                                                                                |
| ---------- | -------- | ------------------------------------------------------------------------------------ |
| `api` | yes      | One of `openai`, `gemini`, `dashscope`, `openrouter`, `ark`. Picks the image-API wire shape. |
| `baseUrl`  | yes      | API endpoint URL. `$VAR` syntax supported.                                           |
| `apiKey`   | usually  | API key string. `$VAR` syntax supported.                                             |
| `name`     | no       | Display name shown in `/image-gen list`.                                             |
| `headers`  | no       | Extra headers merged into every request.                                             |
| `models`   | no       | Optional model id/alias list. Omit to make this a **catch-all** — the provider will accept any unknown model id (passed through as the remote id). Provide a list only when you want aliases or want to route specific ids elsewhere. Each entry is a string or `{ id, alias?, name? }`. |

> Note: pi.dev custom providers also have an `api` field, but its values (`openai-completions`, `anthropic-messages`, …) are LLM streaming formats that don't apply to image generation. The values here (`openai`, `gemini`, `dashscope`, `openrouter`, `ark`) are image-API wire shapes — same field name, different namespace.

### Example: self-hosted Stable Diffusion (OpenAI-compatible)

```sh
export SD_KEY=local-secret
```

```json
{
  "pi-image-gen": {
    "defaultModel": "sd3",
    "customProviders": {
      "my-sd": {
        "api": "openai",
        "baseUrl": "http://localhost:8000/v1",
        "apiKey": "$SD_KEY",
        "models": [{ "id": "sd-3-large", "alias": "sd3" }]
      }
    }
  }
}
```

The agent calls `image_generate({prompt: ...})`; the extension sees `defaultModel: "sd3"`, finds it under `my-sd`, and POSTs to `http://localhost:8000/v1/images/generations` with `Bearer $SD_KEY`.

### Example: Volcengine Doubao image API (OpenAI-compatible)

```json
{
  "pi-image-gen": {
    "defaultModel": "doubao-seed-image",
    "customProviders": {
      "doubao": {
        "api": "openai",
        "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
        "apiKey": "${ARK_API_KEY}",
        "models": [{ "id": "doubao-seedream-4-0-250828", "alias": "doubao-seed-image" }]
      }
    }
  }
}
```

### Example: a Gemini-shape proxy

If your provider speaks the Google Generative Language wire format:

```json
{
  "pi-image-gen": {
    "defaultModel": "internal-banana",
    "customProviders": {
      "internal": {
        "api": "gemini",
        "baseUrl": "https://gemini-proxy.corp.example/v1beta",
        "apiKey": "$INTERNAL_GEMINI_KEY",
        "models": [{ "id": "gemini-2.5-flash-image", "alias": "internal-banana" }]
      }
    }
  }
}
```

### Direct addressing without an alias

If a custom provider has no `models` list, you can still address it with `<providerName>/<remoteId>`:

```json
{
  "pi-image-gen": {
    "defaultModel": "my-sd/sd-3-large",
    "customProviders": {
      "my-sd": { "api": "openai", "baseUrl": "http://localhost:8000/v1", "apiKey": "$SD_KEY" }
    }
  }
}
```

## Tool: `image_generate`

```ts
image_generate({
  prompt: string,                  // required — what to draw or how to edit
  image?: string[],                // optional — array of file paths or http(s) URLs
  n?: number,                      // 1–8, default 1
  size?: string,                   // e.g. "1024x1024" — provider-specific
  filename?: string,               // filename prefix (no extension)
  outputDir?: string,              // override settings.outputDir for this call
})
```

Returns the absolute file path(s) of saved images. Files land in `outputDir` (default `<cwd>/.pi/images`), filename pattern `<filename or model-UTC-stamp>.<ext>`.

### Tool result format

The tool's text result is shaped as ready-to-paste markdown the model can copy verbatim into its reply, so the UI renders the image inline:

```
Generated 1 image(s) via amaster (custom) (qwen-image-2.0). Show each one to the user as inline markdown — copy the lines below verbatim into your reply:

![white](/Users/.../white.png)
```

The `alt` text is the filename without its extension — i.e. whatever you passed as `filename`, or `<model>-<UTC-stamp>` if you didn't. When OpenAI returns a `revised_prompt`, it appears as a quote line under the image:

```
![beaver](/Users/.../beaver.png)
> revised prompt: a cute beaver, photorealistic, water droplets
```

### Image-to-image / edit

`image` is always an array — pass `["path"]` for a single image, `["a", "b"]` for multi-image conditioning. Each entry must be:

- **Local file path** — absolute or relative (resolved against the session cwd).
- **http(s) URL** — downloaded with the same fetch (and abort signal) used for the API call.

Base64 strings and `data:` URIs are intentionally rejected — tool arguments don't survive megabyte-sized strings cleanly. If you have raw image bytes, write them to a file first and pass the path.

**Iterating on a previous result:** pass the previous output path back. The next image is conditioned on the last one:

```
image_generate({ prompt: "a beaver chewing wood", filename: "beaver" })
  → /Users/.../.pi/images/beaver.png

image_generate({ prompt: "now in watercolor style", image: ["/Users/.../.pi/images/beaver.png"] })
  → /Users/.../.pi/images/gpt-image-2-20260605-...png  (edited)
```

Provider behavior:

| Provider | Image input route |
|---|---|
| OpenAI (`gpt-image-2`) | `POST /v1/images/edits` (multipart). Supports multi-image. |
| Gemini (`gemini-3-pro-image`, `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-2.5-flash-image`) | `inline_data` parts prepended to the user message. Supports multi-image. |
| DashScope (`qwen-image-2.0`, `qwen-image-2.0-pro`) | `image` parts in `messages[].content`. |
| OpenRouter | `POST /api/v1/images` with `input_references` JSON. Supports multi-image. |

There is intentionally no `model` parameter on the tool — the active model is fixed by `pi-image-gen.defaultModel` in settings.

## Slash commands

- `/image-gen list` — show the active model, which provider it routes to, whether the key is set, configured providers, and the catalog of built-in model ids.
- `/image-gen reload` — re-read settings from disk.

Use `/image-gen list` to verify your config — it will tell you when `defaultModel` is unset, points at a provider with no API key, or names an unknown id.
