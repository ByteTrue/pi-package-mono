# Design: Custom Provider Manager Extension

## Summary

Add a new package `@bytetrue/pi-vendor` under `packages/pi-vendor`. It registers a `/vendor` command that edits custom providers in `~/.pi/agent/models.json`.

The extension is a wizard, not a runtime provider system. It keeps a provider draft in memory, lets the user open a separate model-list flow, enriches selected model IDs using Pi's installed official model catalog first, falls back to a small local template library, previews the resulting config, and writes the selected provider back to `models.json` only when the user explicitly saves.

## Package and command

- Package directory: `packages/pi-vendor`
- npm package name: `@bytetrue/pi-vendor`
- Entry point: `src/index.ts`
- Pi manifest: `package.json` with `pi.extensions: ["./src/index.ts"]`
- Command: `/vendor`
- MVP dependencies: only Node built-ins plus existing peer deps (`@earendil-works/pi-coding-agent`, `typebox` if schemas are useful). No new runtime dependency.

## Data model

The extension treats `models.json` as unknown-preserving JSON with a known subset:

```ts
type ModelsJson = {
  providers?: Record<string, ProviderConfig>;
  [key: string]: unknown;
};

type ProviderConfig = {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  compat?: Record<string, unknown>;
  models?: ProviderModelConfig[];
  [key: string]: unknown;
};

type ProviderModelConfig = {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: Array<"text" | "image">;
  cost?: Record<string, number>;
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  [key: string]: unknown;
};
```

Draft shape:

```ts
type ProviderDraft = {
  key: string;
  config: ProviderConfig;
};
```

The draft starts from an existing provider copy or a minimal new provider:

```json
{
  "baseUrl": "",
  "api": "openai-completions",
  "apiKey": "$ENV_VAR",
  "models": []
}
```

## File locations

- User target file: `${PI_CODING_AGENT_DIR ?? ~/.pi/agent}/models.json`
  - Use `PI_CODING_AGENT_DIR` when set so tests and config-backup workflows can redirect the agent dir.
  - Otherwise use `join(homedir(), ".pi", "agent", "models.json")`.
- Official catalog source:
  1. Try `import.meta.resolve("@earendil-works/pi-coding-agent")`, walk from the resolved package location to `node_modules/@earendil-works/pi-ai/dist/models.generated.js`.
  2. Try relative to the installed extension's module root: ancestor `node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/models.generated.js`.
  3. If no local catalog is found, official lookup returns no matches and enrichment falls back to templates. Do not call the network.

## `/vendor` flow

### Provider list

1. Read `models.json`; if missing, use `{ providers: {} }`.
2. List provider keys from `providers` plus `Add provider...`.
3. User selects existing provider or add.
4. Existing provider creates a draft by shallow/deep cloning that provider config. New provider prompts for key and creates a minimal draft.

### Provider form

Use repeated `ctx.ui.select` actions instead of a custom TUI for MVP:

- Edit provider key
- Edit display name
- Edit base URL
- Edit API key/env reference
- Edit API format
- Edit compatibility JSON
- Manage models
- Preview provider JSON
- Save provider
- Cancel

Provider edits mutate only the in-memory draft. `models.json` is untouched until Save.

API format MVP choices:

- `openai-completions` default
- `openai-responses`
- `anthropic-messages`
- custom string/manual input

MVP live import only supports OpenAI-compatible `/models`; non-OpenAI APIs can still be manually configured but have no live discovery.

### Model list flow

The provider form's `Manage models` action opens a separate loop over `draft.config.models`:

- Add manual model id
- Add from local library/templates
- Import from `/models` endpoint
- Remove model
- Replace/edit model JSON
- Preview selected models
- Back to provider form

All add paths produce one or more model IDs, then pass through the same enrichment pipeline.

## Model enrichment pipeline

For each model ID:

1. Official Pi catalog exact lookup.
2. If exactly one official match, use that match's merge-ready config.
3. If multiple official matches, show a chooser with provider/id/name/api/context summary and let the user choose.
4. If no official match, use local template matching:
   - exact ID template first;
   - otherwise longest prefix template.
5. If still no match, create `{ id }` plus safe defaults only where useful for preview:
   - `name: id`
   - `reasoning: false`
   - `input: ["text"]`
   - `contextWindow: 128000`
   - `maxTokens: 16384`
6. Show a preview before adding when the source is ambiguous or unknown.

### Official catalog merge-ready config

Official model configs are copied as-is except for routing/auth fields that must not leak from official providers into the custom provider:

- remove `provider`
- remove `baseUrl`
- remove `headers`
- remove `apiKey`
- remove `authHeader`

Do not maintain a positive allowlist. If Pi adds future model metadata, keep it unless it is clearly routing/auth.

Rationale: this matches the existing `pi-official-model-config` workflow and avoids stale template metadata.

### Local template library

Local templates are only fallback data for IDs absent from Pi's installed official catalog.

```ts
type ModelTemplate = {
  id?: string;
  prefix?: string;
  name?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  cost?: Record<string, number>;
  compat?: Record<string, unknown>;
  thinkingLevelMap?: Record<string, string | null>;
};
```

Minimum first-version fields for bundled fallback templates:

- `contextWindow`
- `maxTokens`
- `reasoning`
- `input`

`cost`, `compat`, and `thinkingLevelMap` are allowed when known, but not required in fallback templates. Official matches may carry these richer fields.

## OpenAI-compatible `/models` import

Given a provider draft:

1. Require `baseUrl` and `apiKey` to be present in the draft.
2. Resolve endpoint by appending `/models` safely:
   - if base URL ends with `/v1`, request `/v1/models`;
   - preserve existing path prefix;
   - avoid double slashes.
3. Send `GET` with `Authorization: Bearer <key>` if `apiKey` is a literal value.
4. If `apiKey` is an env reference (`$NAME` or `${NAME}`), resolve it from `process.env` for fetch only; keep the env reference in `models.json`.
5. Parse OpenAI-compatible responses shaped like `{ data: [{ id: string }] }`.
6. Show fetched IDs for selection. MVP can use repeated select/add or a simple editor list if `ctx.ui.select` lacks multi-select.
7. Enrich selected IDs through the common pipeline.

If auth is unresolved or fetch fails, show a warning and return to the model-list flow without mutating the draft.

## Persistence strategy

- Read JSON with `JSON.parse`.
- Missing file becomes `{ providers: {} }`.
- Malformed JSON blocks the wizard and shows the parse error; do not overwrite.
- On save:
  1. Re-read the current file to reduce accidental overwrite risk.
  2. Parse again; if malformed, abort.
  3. Preserve all top-level fields.
  4. Preserve unrelated providers.
  5. Upsert `providers[draft.key] = draft.config`.
  6. If the provider key changed, remove the old key only after confirmation.
  7. Write formatted JSON with trailing newline.
- After save, notify: open `/model` to refresh model selection; pi restart is not required.

## Tests and validation targets

Small unit tests should cover:

- official catalog match normalization and routing/auth field removal;
- exact vs longest-prefix template matching;
- OpenAI `/models` response parsing;
- endpoint URL construction;
- env-reference handling for fetch without persisting secrets;
- models.json upsert preserves unrelated fields/providers.

## Tradeoffs

- Standard `ctx.ui` dialogs are less elegant than a full TUI, but enough for MVP and much less code.
- JSON formatting will be normalized on save instead of preserving original whitespace/comments. JSON comments are invalid anyway; preserving unknown fields matters more.
- Official catalog lookup is local-only. This avoids network drift and matches the user's installed Pi version.
- Local templates are deliberately fallback-only to avoid maintaining a stale duplicate of Pi's official catalog.
