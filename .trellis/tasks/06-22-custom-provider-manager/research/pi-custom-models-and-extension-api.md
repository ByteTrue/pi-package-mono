# Pi custom models and extension API research

## Sources inspected

- `/Users/byte/.local/share/mise/installs/node/24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/models.md`
- `/Users/byte/.local/share/mise/installs/node/24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md`
- `/Users/byte/.local/share/mise/installs/node/24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `/Users/byte/.local/share/mise/installs/node/24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- Current repo package examples: `packages/pi-web-search`, `packages/pi-subagent`

## Confirmed facts

- User-editable custom model providers live in `~/.pi/agent/models.json` under a top-level `providers` object.
- A custom provider entry may include `baseUrl`, `api`, `apiKey`, `headers`, `authHeader`, `compat`, `models`, and `modelOverrides`.
- A model config requires only `id`; pi defaults include `name = id`, `input = ["text"]`, `reasoning = false`, `contextWindow = 128000`, `maxTokens = 16384`, and zero cost.
- Full model configs can include `id`, `name`, `api`, `baseUrl`, `reasoning`, `thinkingLevelMap`, `input`, `cost`, `contextWindow`, `maxTokens`, `headers`, and `compat`.
- `models.json` reloads when opening `/model`; editing it during a session does not require restarting pi.
- For OpenAI-compatible providers, `api: "openai-completions"` is the broadest compatibility target.
- OpenAI-compatible quirks are represented by `compat`, including `supportsDeveloperRole`, `supportsReasoningEffort`, `supportsUsageInStreaming`, `maxTokensField`, `thinkingFormat`, etc.
- Extensions can register slash commands via `pi.registerCommand()` and use `ctx.ui.select`, `ctx.ui.input`, `ctx.ui.editor`, `ctx.ui.confirm`, `ctx.ui.notify`, and `ctx.ui.custom()` for interactive flows.
- File-mutating custom tools should use `withFileMutationQueue()`, but a slash command handler doing its own serialized flow can keep the MVP simpler if only one file is edited at the end.
- Pi packages in this repo expose extensions via `package.json` `pi.extensions: ["./src/index.ts"]`, use TypeScript source loaded by jiti, and list pi core packages as peer dependencies.

## Product implications for this task

- The extension should target `models.json` editing, not dynamic `pi.registerProvider()` as the primary persistence path.
- MVP can be a slash-command wizard (`/vendor`) with standard `ctx.ui` dialogs instead of a custom full-screen TUI component. Custom UI can wait unless the flow becomes painful.
- `/models` import can be implemented with `fetch(new URL("models", baseUrl))`-style logic and OpenAI-compatible response parsing (`{ data: [{ id, ... }] }`).
- Live `/models` results usually provide IDs only; the extension still needs a template/library layer to enrich model configs for pi.
- The template layer should tolerate unknown IDs by falling back to safe pi defaults plus explicit user review before saving.
