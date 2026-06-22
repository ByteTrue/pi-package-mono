# Provider Manager Contract

## Scenario: `/vendor` custom provider manager

### 1. Scope / Trigger

Applies when changing `@bytetrue/pi-vendor` code that reads/writes `models.json`, imports `/models`, enriches model configs, or registers the `/vendor` command.

This extension manages custom providers stored in `models.json`. Do not replace this with dynamic `pi.registerProvider()` registration unless a future task explicitly changes the product scope.

### 2. Signatures

- Slash command: `/vendor`
- User config path:
  - `process.env.PI_CODING_AGENT_DIR + "/models.json"` when `PI_CODING_AGENT_DIR` is set
  - otherwise `~/.pi/agent/models.json`
- Package entry: `packages/pi-vendor/src/index.ts`
- Pi manifest: `package.json` `pi.extensions: ["./src/index.ts"]`

### 3. Contracts

#### `models.json`

Known shape:

```ts
type ModelsJson = {
  providers?: Record<string, ProviderConfig>;
  [key: string]: unknown;
};
```

Rules:

- Missing file reads as `{ providers: {} }`.
- Malformed JSON must block saving; never overwrite malformed `models.json`.
- Preserve unrelated top-level fields and unrelated providers.
- On save, re-read current file, then upsert only the edited provider.
- If provider key changes, remove the old key only after explicit confirmation.
- If the new key already exists, confirm before overwriting it.

#### Official catalog enrichment

- Source is the installed local Pi catalog: `@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/models.generated.js`.
- Use exact model id lookup across all official providers.
- If multiple official candidates match, ask the user to choose; do not auto-select by the custom provider's current `api`.
- Copy official model metadata by removing only routing/auth fields:
  - `provider`
  - `baseUrl`
  - `headers`
  - `apiKey`
  - `authHeader`
- Do not use a positive allowlist of metadata fields. Keep future Pi metadata unless it is clearly routing/auth.

#### Fallback enrichment

Only after official lookup has no exact match:

1. exact local template id
2. longest matching template prefix
3. safe defaults

Fallback templates should at least fill:

- `contextWindow`
- `maxTokens`
- `reasoning`
- `input`

Safe defaults:

```ts
{
  id,
  name: id,
  reasoning: false,
  input: ["text"],
  contextWindow: 128000,
  maxTokens: 16384,
}
```

#### OpenAI-compatible `/models` import

- Use the in-memory provider draft, not a saved provider.
- Require draft `baseUrl` and `apiKey`.
- Build endpoint by appending `models` to the base path without dropping prefixes: `https://host/v1` -> `https://host/v1/models`.
- Resolve `$NAME` and `${NAME}` env references only for the fetch. Keep the env reference in `models.json`; never persist the resolved secret.
- Parse only OpenAI-compatible `{ data: [{ id: string }] }`, ignore invalid entries, dedupe and sort ids.

#### `/vendor` TUI navigation
- Root provider list: `Esc` exits `/vendor` because there is no parent page.
- Nested pages must treat `Esc` as "go back" to the immediate parent page, not as command exit. Examples: provider edit -> provider list; Manage models -> provider edit; Add model/search/provider-confirmation -> the previous model flow page.
- Footer help text must match the actual `Esc` behavior (`Esc exits` only on the root provider list; `Esc goes back` elsewhere).
- Manual model search shows unique model IDs first. After the user chooses a model ID, show all official provider candidates for that ID and save only the chosen candidate's routing-stripped metadata.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Missing `models.json` | Use `{ providers: {} }` |
| Malformed `models.json` | Notify/throw and do not save |
| Official catalog missing | Continue with fallback templates/defaults |
| Official id has multiple candidates | Prompt user to choose |
| Unknown model id | Show/edit safe default config before adding |
| Env API key missing during `/models` import | Warn and leave draft unchanged |
| `/models` fetch fails | Warn and leave draft unchanged |
| Rename target provider exists | Confirm before overwrite |

### 5. Good/Base/Bad Cases

- Good: model id `gpt-4o` exists in official catalog; `/vendor` shows all exact official candidates and saves the chosen merge-ready config without official routing/auth.
- Base: model id misses official catalog but matches `gpt-4` prefix; save fallback template config.
- Bad: malformed `models.json` exists; command must not write a new formatted file over it.

### 6. Tests Required

- Official routing/auth stripping keeps non-routing metadata like `cost`, `compat`, `thinkingLevelMap`, `contextWindow`, and `maxTokens`.
- Official ambiguity returns candidates instead of guessing.
- Template exact match beats prefix; longest prefix wins otherwise.
- `/models` URL construction preserves path prefixes.
- Env reference resolution works for fetch and fails clearly when missing.
- Upsert preserves unrelated fields/providers and handles provider rename.

### 7. Wrong vs Correct

#### Wrong

```ts
// Guesses based on the custom provider API and may choose the wrong official metadata.
const chosen = candidates.find((candidate) => candidate.model.api === draft.config.api) ?? candidates[0];
```

#### Correct

```ts
// User chooses because custom providers usually do not mirror Pi's official provider/API layout.
const chosen = await chooseOfficialCandidate(candidates);
```

#### Wrong

```ts
// Positive allowlist drops future Pi metadata.
const { id, name, contextWindow, maxTokens } = officialModel;
```

#### Correct

```ts
// Remove only routing/auth fields that conflict with the custom provider.
const { provider, baseUrl, headers, apiKey, authHeader, ...mergeReady } = officialModel;
```
