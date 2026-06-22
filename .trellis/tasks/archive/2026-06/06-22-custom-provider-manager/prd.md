# Design Custom Provider Manager Extension

## Goal

Design a new pi package/extension that manages custom providers stored in `~/.pi/agent/models.json`, aimed at users who route many upstream models through an OpenAI-compatible aggregation gateway and need a faster way to add/update provider model entries.

The extension should mimic the useful interaction shape of `vscode-unify-chat-provider`: create/edit a provider first, then manage its models in a separate model-list flow, with multiple ways to add models before saving the provider.

## Problem

The user uses an aggregation gateway that exposes many upstream models to pi through one custom provider. Upstream model lists change frequently. Today, adding a model means manually finding the right pi model parameters from pi source/docs or existing configs and copying them into `models.json`.

This is tedious because a live `/models` endpoint usually returns only model IDs, while pi model entries need additional fields such as context window, max output tokens, input modality, reasoning support, cost, and compatibility flags.

## Confirmed Facts

- The target object is a custom provider inside `~/.pi/agent/models.json`, not pi's official built-in provider concept.
- The initial user requirement is provider/model management for entries written to `models.json`.
- Do not lead with a dynamic `pi.registerProvider()` runtime registration design; persistence to `models.json` is the core.
- The reference interaction is not a one-shot provider form. It is provider list → provider form → model list → choose model source(s) → save provider.
- Model sources should include at least manual add, a local model/template library, and live import from an OpenAI-compatible `/models` endpoint.
- Live `/models` import should work against the in-progress provider draft; the provider should not need to be saved before fetching models.
- Current repo packages are TypeScript pi extensions under `packages/*`, loaded by jiti via `package.json` `pi.extensions`.
- Pi supports `~/.pi/agent/models.json`; it reloads when opening `/model`.
- Pi custom model config only requires `id`, but defaults may be too generic for high-quality model behavior.
- MVP decision: manual model-id entry is a first-class model source alongside OpenAI-compatible `/models` import; both paths use the same template enrichment, preview, and save flow.
- MVP decision: the template library supports both exact model-id templates and family/prefix templates. Exact id matches win first; otherwise the longest matching prefix wins.
- MVP decision: when a model id matches Pi's installed official built-in catalog, use the official model config as the primary source of model metadata instead of hand-maintained templates.
- The installed local catalog is authoritative for official model metadata: `@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/models.generated.js`.
- MVP decision: when the official catalog returns multiple matches for the same model id, show the candidate official configs and let the user choose; do not auto-select by current custom provider API because users typically do not mirror official provider/API configuration in custom providers.
- MVP decision: fallback local templates should at least fill `contextWindow`, `maxTokens`, `reasoning`, and `input`; official catalog matches can carry richer fields such as `cost`, `compat`, and `thinkingLevelMap`.

## Requirements

### Command and package shape

- Add a new package under `packages/` for the custom provider manager extension.
- Register a `/vendor` command as the main entry point.
- The command should manage providers in `~/.pi/agent/models.json`.
- Use normal `ctx.ui` dialogs for MVP unless a specific flow requires custom TUI.

### Provider flow

- `/vendor` opens a provider list for custom providers from `models.json`.
- The user can add a provider.
- The provider draft captures at least:
  - provider key/id used under `providers`
  - display name, if supported by pi config
  - base URL
  - API key value or env reference
  - API format, with OpenAI-compatible as the MVP default
  - optional provider-level compatibility flags
  - models entry point
- Provider edits remain draft state until the user explicitly saves.

### Model list flow

- The provider form has a models entry that opens a separate model-list flow.
- The model-list flow lets the user add models through multiple sources before saving the provider:
  - manual model id entry
  - add from local model/template library
  - add from provider `/models` endpoint
- The model-list flow shows selected/draft models and allows removing/replacing entries before save.
- Live `/models` fetch uses the provider draft fields already entered by the user.

### Model config enrichment

- Model config enrichment order should be:
  1. look up the model id in Pi's installed official built-in catalog;
  2. if found, copy the official model config while removing official provider routing/auth fields that conflict with the custom provider;
  3. if not found, fall back to the extension's local template/library matching;
  4. if still unknown, add the model with safe defaults and warn/review before saving.
- Fallback template matching supports exact model-id templates and broader family/prefix templates; exact id matches win over broader prefix templates, otherwise the longest matching prefix wins.
- Do not maintain a fixed allowlist of copied official fields; carry over official model metadata unless it is clearly provider routing/auth data that must remain custom.
- Official catalog ambiguity is resolved by asking the user to choose among matching official configs.

### models.json persistence

- Read from `~/.pi/agent/models.json`.
- Preserve unrelated providers and unknown fields where possible.
- Save by upserting the selected provider entry and its model list.
- Do not require pi restart after saving; tell the user to open `/model` if they need to refresh model selection.
- Avoid writing secrets by default when the user chooses an env-var reference.

## Out of Scope for MVP

- Managing pi built-in provider definitions as first-class objects.
- Building a generic dynamic provider runtime/registerProvider system.
- Non-OpenAI-compatible live model discovery.
- Full custom streaming APIs.
- OAuth or SSO provider setup.
- Remote hosted template syncing.
- Complex multi-window TUI unless standard dialogs prove insufficient.

## Acceptance Criteria

- [ ] Planning identifies the new package name and command name.
- [ ] Planning defines the provider-list → provider-form → model-list → save state flow.
- [ ] Planning defines the `models.json` read/write strategy, including preservation of unrelated content.
- [ ] Planning defines the official Pi catalog lookup strategy plus fallback local model/template library data shape and matching precedence.
- [ ] Planning defines how OpenAI-compatible `/models` import maps live IDs to pi model configs.
- [ ] Planning defines MVP vs later scope boundaries.
- [ ] Before implementation, complex-task artifacts `design.md` and `implement.md` exist and are reviewed.

