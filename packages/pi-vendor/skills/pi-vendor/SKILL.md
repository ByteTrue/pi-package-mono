---
name: pi-vendor
description: >
  Inspect, add, update, remove, discover, and audit Pi providers, custom models,
  and modelOverrides in models.json. Use whenever the user asks to configure a
  model/provider, change routing or API adapters, import /models ids, repair or
  audit Pi model configuration, or mentions models.json. Prefer this skill over
  inventing model metadata. It keeps apiKey values out of replies and requires
  explicit choice when official templates are ambiguous.
---

# Pi Vendor

Manage Pi's `models.json` with the AI's normal read/edit tools and three package tools:

- `vendor_catalog_search` — search the active Pi catalog and return credential-free templates;
- `vendor_discover` — read a configured provider and safely list its `/models` ids;
- `vendor_validate` — refresh the running Pi registry and report whether it accepts the current file.

The package deliberately has no general write tool. Make the smallest targeted edit with the AI's normal edit tool, then validate it.

## Non-negotiable boundaries

- Treat every `apiKey` value as secret. You may read it to preserve the document, but never reproduce it in replies, proposed diffs, logs, tool arguments, or summaries. Refer to it only as “configured”, “missing”, or “changed”.
- Never ask the user to paste a key into chat. Use the bundled terminal script described under **API keys**.
- Distinguish the **target provider** (the key being edited) from the **official source provider** (the catalog template copied). They often differ.
- Never invent pricing, capabilities, context limits, token limits, or compat fields. Copy an explicitly selected official template or leave unknown metadata absent.
- Do not mutate `auth.json`, OAuth state, Pi settings, or unrelated providers unless the user explicitly asks.
- Preserve unknown fields and unrelated formatting/content. Use narrow edits rather than rewriting the whole document.

## Locate and inspect

The file is:

1. `$PI_CODING_AGENT_DIR/models.json` when that environment variable is set;
2. otherwise `~/.pi/agent/models.json`.

Read the active file before every mutation. Identify the requested operation and exact target provider/model. If the same model id exists under several target providers and the user did not name one, ask which target to edit.

For inspection or audit, summarize provider routing and model ids without showing credential values. Include model-level `api`/`baseUrl` overrides because they can differ from provider defaults.

## Official template selection

Call `vendor_catalog_search` before adding or aligning a model. If it reports `catalog_unavailable`, stop and repair/retry catalog resolution; do not reinterpret that failure as “no official match”.

1. If several distinct model ids match the query, show a compact comparison and ask which id the user means.
2. Once the id is exact, group candidates by official source provider.
3. If more than one official source remains, show material differences and ask the user to choose. Never silently pick one; a recommendation with a reason is allowed.
4. A provider-qualified request such as `anthropic/claude-opus-4-5` is an explicit source choice. Verify it exists and continue.
5. With no official match, say so and ask whether to create a custom model. Require only facts the user knows; do not fill unknown metadata from memory.

When displaying comparisons, include only useful differing fields: model id, name, source provider, API, context window, max tokens, cost, input types, and material compat differences. Catalog templates contain no credentials.

## Provider operations

### Add

Decide whether this is a minimal override of a built-in provider or a new custom provider.

For a built-in override, keep the built-in catalog and add only requested routing fields. For a custom provider, collect the provider key, `baseUrl`, API adapter, and required headers. Add only evidence-backed fields. If a key is required, create the provider without exposing a secret and then use **API keys**.

### Update

Patch only requested fields. Before changing provider-level `api`, `baseUrl`, or `compat`, identify models that inherit that value and preserve required model-level overrides.

### Remove

Name the exact provider and contained custom models. Check obvious references before deletion. Require confirmation unless the user's instruction already names the exact provider and explicitly requests removal. Explain that removing a built-in override restores built-in behavior rather than deleting Pi's built-in provider.

## Model operations

### Discover

For a configured target provider, call `vendor_discover` with its exact provider key. The tool resolves credentials internally and returns ids only. Discovery proves upstream availability, not metadata correctness; still use `vendor_catalog_search` for the chosen id.

### Add or update

Copy the selected official template's non-routing metadata. Do not copy catalog `baseUrl`, credentials, or headers into the target provider.

Routing rule:

- if the selected model uses `anthropic-messages` and the target provider `baseUrl` ends in `/v1`, set a model-level `baseUrl` with that trailing `/v1` removed;
- for other API adapters, do not add a model-level `baseUrl` unless the user explicitly needs a distinct endpoint;
- add model-level `api` only when it differs from the target provider's inherited adapter.

Use `models` for new/custom model definitions and `modelOverrides` for partial changes to an existing built-in or extension model. Never create duplicate ids in one provider's `models` array.

### Remove

Identify whether the target is in `models` or `modelOverrides`, show the exact target, and confirm unless the user's instruction already explicitly requests that exact deletion. Delete only that occurrence.

## API keys

The bundled script updates exactly one provider's `apiKey`, prompts in the user's terminal without echoing the value, and writes `models.json` atomically with mode `0600`:

```sh
node '<absolute-skill-directory>/scripts/set-api-key.mjs' '<provider-key>'
```

Replace `<absolute-skill-directory>` with the directory containing this `SKILL.md`, and quote both paths safely. Give this command to the user; do not execute it on their behalf because it needs interactive secret input. The key never appears in the command line or chat.

After the user reports completion, call `vendor_validate`. Do not ask them to reveal the value.

## Validate every mutation

After each edit:

1. parse-check the JSON;
2. call `vendor_validate`;
3. if invalid, repair the targeted change or restore the previous value before proceeding;
4. for additions, confirm the intended provider/model appears after refresh;
5. report only changed JSON paths, the selected official source provider, and validation status.

Do not print the whole edited provider or a full diff when it would expose `apiKey`.

## Audit

For an audit:

1. parse and validate the current file;
2. inspect duplicate ids, missing routing facts, broken shapes, and suspicious model-level overrides;
3. compare official-aligned models with `vendor_catalog_search`, but report ambiguity instead of assuming a source provider;
4. distinguish deliberate custom models from invalid models;
5. report findings by severity with exact JSON paths and remediation, never credential values.

A clean audit says what was checked and that `vendor_validate` passed. Do not rewrite a clean file.
