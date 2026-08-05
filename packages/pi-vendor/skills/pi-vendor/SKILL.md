---
name: pi-vendor
description: >
  Inspect, add, update, remove, discover, and audit Pi providers, custom models,
  and modelOverrides in models.json. Use whenever the user asks to configure a
  model/provider, change routing or API adapters, import /models ids, repair or
  audit Pi model configuration, or mentions models.json. Prefer this skill over
  inventing model metadata. It protects credentials and requires the user—not
  the AI—to choose every ambiguous target provider, model ID, and official source.
---

# Pi Vendor

Manage Pi's `models.json` with normal read/edit tools and the bundled Node script:

```sh
node '<absolute-skill-directory>/scripts/vendor.mjs' <catalog|discover|lint|set-key> [argument]
```

Replace `<absolute-skill-directory>` with the directory containing this `SKILL.md`. Shell-quote the script path and every argument as one positional value; never interpolate shell operators. `catalog`, `discover`, and `lint` are AI-facing. `set-key` is user-terminal-only because it prompts for a secret.

The package deliberately has no general write tool. Make the smallest targeted edit with the normal edit tool, then run `lint`.

## User decides; AI recommends

Treat configuration as a two-phase transaction because a plausible model can still be the wrong provider, source, or ID.

### Phase 1: inspect and ask — read-only

Read the active file, run all useful catalog/discovery queries, and present the complete decision set. Do **not** call edit/write or partially mutate the file during this phase.

The user owns these choices:

- target provider key;
- exact model ID when the request is fuzzy, has several matches, or has no official match;
- official source provider whenever an exact model ID has multiple catalog sources;
- overwrite/conflict resolution;
- whether to create a custom model when no official template exists;
- every removal or other destructive operation not already named exactly.

Never infer a user-owned choice from the current routing, nearby models, prior conventions, the first catalog result, or your recommendation. A request such as “add these models” authorizes the operation, not unresolved placement or identity choices. If the user says “you choose”, give one recommendation with reasons and ask them to confirm that concrete option; a recommendation is not authorization.

For a batch, resolve every item before editing. Ask once with a compact table or numbered list. If the user answers only some items, keep the whole batch read-only and ask only for the unresolved choices.

When the `question` tool is available, use it for the unresolved choices and include every viable option plus the custom-answer path. Otherwise ask in plain text. Mark recommendations clearly, but do not preselect or execute them.

### Phase 2: mutate — only after explicit selection

Proceed only when the user's own words resolve every applicable choice. Restate the resulting plan as `(requested name → exact ID → official source/custom → target provider)` and then perform the narrow edit.

A provider-qualified model such as `anthropic/claude-opus-4-5` resolves the official source only after catalog verification. An exact target provider named by the user resolves placement. Exact prior answers in the same conversation remain valid; do not ask twice.

### Required comparison

For every fuzzy query or exact ID with multiple sources, show **all** matches returned by `catalog`, grouped by exact model ID and then official source provider. Do not collapse duplicate IDs across sources. Include only useful differences:

- exact model ID and name;
- official source provider;
- API adapter;
- context window and max tokens;
- input types, cost, and material compat differences.

Also list every viable configured target provider when placement is unresolved, with its provider key and effective API/base URL. You may recommend one option with a short reason. Never describe a candidate as “the one” until the user selects it.

If catalog returns no match, say that this is not proof the model is invalid. Ask whether to use the requested text as a custom ID or provide another exact ID; do not silently normalize, suffix, or substitute it.

## Non-negotiable boundaries

- Treat every `apiKey` value as secret. You may read it to preserve the document, but never reproduce it in replies, proposed diffs, logs, tool arguments, or summaries. Refer to it only as “configured”, “missing”, or “changed”.
- Never ask the user to paste a key into chat. Use **API keys** below.
- Distinguish the target provider being edited from the official source provider whose metadata is copied.
- Never invent pricing, capabilities, context limits, token limits, or compat fields. Copy a user-selected official template or leave unknown metadata absent.
- Do not mutate `auth.json`, OAuth state, Pi settings, or unrelated providers unless explicitly requested.
- Preserve unknown fields and unrelated content. Use narrow edits rather than rewriting the document.

## Locate and inspect

The active file is:

1. `$PI_CODING_AGENT_DIR/models.json` when set;
2. otherwise `~/.pi/agent/models.json`.

Read it before every mutation. For inspection or audit, summarize routing and model IDs without credential values. Include model-level `api`/`baseUrl` overrides because they can differ from provider defaults. Use Node for ad hoc inspection rather than assuming Python is installed.

## Official catalog

Before adding or aligning a model, run:

```sh
node '<absolute-skill-directory>/scripts/vendor.mjs' catalog '<query>' ['<limit>']
```

If the official catalog is unavailable, stop and repair/retry catalog resolution; do not reinterpret the failure as “no match”. Run broad enough queries to find fuzzy IDs, but preserve the script's full result set for the user-choice phase. Check the returned `count` against `total`: when `count < total`, first rerun as `catalog '<query>' '100'`, then refine the query until every relevant match is enumerated. If the result still cannot be made complete, say it is truncated and ask the user to narrow the query; never present a partial set as complete or enter the mutation phase.

## Provider operations

### Add

Determine whether candidates are built-in overrides or custom providers, but leave ambiguous placement to the user. For a built-in override, keep the built-in catalog and add only requested routing fields. For a custom provider, collect the provider key, `baseUrl`, API adapter, and required headers. Add only evidence-backed fields. If a key is required, create the provider without exposing a secret and then use **API keys**.

### Update

Patch only requested fields. Before changing provider-level `api`, `baseUrl`, or `compat`, identify models that inherit it and preserve required model-level overrides.

### Remove

Show the exact provider and contained custom models, and check obvious references before deletion. Confirm unless the user already named that exact provider and explicitly requested removal. Explain that removing a built-in override restores built-in behavior rather than deleting Pi's built-in provider.

## Model operations

### Discover

For a configured target provider, run:

```sh
node '<absolute-skill-directory>/scripts/vendor.mjs' discover '<provider-key>' ['<configured-model-id>']
```

The optional model ID uses that model's effective `api`, `baseUrl`, and headers together with the provider's `authHeader`. For a heterogeneous provider, group configured models by effective route and run one representative from each group.

Discovery is positive evidence only. A returned ID proves that route listed it. A configured ID missing from the response is a warning to verify with a real request or upstream documentation; list APIs may be incomplete or paginated. Never call it unsupported, delete it, or reroute it from absence alone. Still run `catalog` for metadata. Preserve exact unique IDs and counts; when routes return the same set, say so instead of duplicating the list.

### Add or update

Copy non-routing metadata from the official source the user selected. Do not copy catalog `baseUrl`, credentials, or headers into the target provider.

Routing rules:

- if the selected model uses `anthropic-messages` and the target provider `baseUrl` ends in `/v1`, set a model-level `baseUrl` with that trailing `/v1` removed;
- otherwise add model-level `baseUrl` only when the user explicitly needs a distinct endpoint;
- add model-level `api` only when it differs from the target provider's inherited adapter.

Use `models` for new/custom definitions and `modelOverrides` for partial changes to an existing built-in or extension model. Never create duplicate IDs in one provider's `models` array. A conflict is a user-owned choice: report the exact path and ask whether to update, replace, skip, or choose another target.

### Remove

Identify whether the target is in `models` or `modelOverrides`, show the exact occurrence, and confirm unless the user explicitly requested that exact deletion. Delete only that occurrence.

## API keys

Give this command to the user; do not execute it because it needs interactive secret input:

```sh
node '<absolute-skill-directory>/scripts/vendor.mjs' set-key '<provider-key>'
```

The script updates one provider's `apiKey`, prompts without echo, and atomically writes mode `0600`. After the user reports completion, run `lint`; never ask them to reveal the value.

## Check every mutation

After each edit:

1. run `node '<absolute-skill-directory>/scripts/vendor.mjs' lint`;
2. if lint fails, repair the targeted change or restore the previous value;
3. re-read and confirm the intended provider/model exists;
4. report changed JSON paths, the user-selected official source/custom status, and lint status only.

`lint` checks shape and duplicate IDs. It does not prove a running Pi session loaded the model. Do not print the whole provider or a full diff when it could expose `apiKey`.

## Audit

1. Parse and lint the current file.
2. Inspect duplicate IDs, missing routing facts, broken shapes, and suspicious model-level overrides.
3. Group heterogeneous providers by effective API, base URL, and merged headers; use route-specific discovery and report missing configured IDs as warnings requiring verification.
4. Compare official-aligned models with `catalog`; expose every source ambiguity instead of choosing.
5. Distinguish deliberate custom models from invalid models.
6. Report severity, exact JSON paths, and remediation without credential values.

A clean audit says what was checked and that `lint` passed. Do not rewrite a clean file.
