---
name: pi-vendor
description: >
  Manage and audit Pi providers, custom models, modelOverrides, routing/API
  adapters, and upstream model discovery in models.json. Use for any models.json
  or provider/model configuration request. Never invent model metadata, expose
  credentials, or choose ambiguous providers, model IDs, or official sources
  for the user.
---

# Pi Vendor

Manage Pi's `models.json` with normal read/edit tools. The bundled script has exactly two AI-facing queries:

```sh
node '<absolute-skill-directory>/scripts/vendor.mjs' catalog '<keyword>' ['<limit>']
node '<absolute-skill-directory>/scripts/vendor.mjs' discover '<provider-key>'
```

Replace `<absolute-skill-directory>` with the directory containing this `SKILL.md`. Shell-quote the script path and every argument as one positional value; never interpolate shell operators. There is no AI-facing CRUD, compare, or lint command. `/vendor` remains the human cold-start TUI.

`set-key` is a separate user-terminal-only helper because it prompts for a secret:

```sh
node '<absolute-skill-directory>/scripts/vendor.mjs' set-key '<provider-key>'
```

Never execute `set-key` for the user and never ask them to paste a key into chat.

## Non-negotiable boundaries

- Treat every `apiKey` and authentication header value as secret. Never reproduce one in replies, diffs, logs, tool arguments, or summaries. Refer to it only as configured, missing, or changed.
- Never use `cat`, print the complete `models.json`, or perform a full configuration read for discovery. Locate provider/model keys first and read only the smallest range needed for a mutation.
- Preserve unknown fields and unrelated providers. Make the smallest targeted edit; do not rewrite the document.
- Distinguish the configured target provider from the official catalog provider whose metadata is copied.
- `catalog` is official metadata, not evidence that a target provider exposes a model. `discover` is upstream evidence, not official metadata.
- Never invent pricing, capabilities, context limits, token limits, compat fields, model IDs, or routing.
- The user decides ambiguous model identity, official source, target provider, overwrite conflicts, and destructive operations.
- Do not mutate `auth.json`, OAuth state, Pi settings, or unrelated providers unless explicitly requested.
- For an exact synchronization, the machine-generated plan JSON is the only mutation authority. Never hand-copy, rename, summarize, or reconstruct its model ID sets in prose.

## Exact synchronization templates

These are the only templates for exact synchronization. Keep `sync_dir`, `discovery_file`, and `plan_file` for the entire confirmation and mutation sequence; clean them after a successful finish or an abandoned plan. They contain only model IDs and route status, never credentials. Substitute the shell-quoted provider key and absolute skill directory, but do not alter the Node programs.

### Generate the plan

Run this once after `discover` has returned only `status: "ok"` routes. It writes and prints the one immutable plan JSON; it reads only `providers.<key>.models` internally. Exact synchronization does not support `modelOverrides`; use workflow 4 for those.

```sh
sync_dir="$(mktemp -d "${TMPDIR:-/tmp}/pi-vendor-sync.XXXXXX")"
discovery_file="$sync_dir/discovery.json"
plan_file="$sync_dir/plan.json"
node '<absolute-skill-directory>/scripts/vendor.mjs' discover '<provider-key>' > "$discovery_file"
PI_VENDOR_PROVIDER_KEY='<provider-key>' PI_VENDOR_DISCOVERY_FILE="$discovery_file" PI_VENDOR_SYNC_PLAN_FILE="$plan_file" node <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");
const sorted = (ids) => [...new Set(ids)].sort((a, b) => a.localeCompare(b));
const providerKey = process.env.PI_VENDOR_PROVIDER_KEY;
const configPath = join(process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent"), "models.json");
const provider = JSON.parse(readFileSync(configPath, "utf8"))?.providers?.[providerKey];
if (!provider || !Array.isArray(provider.models) || Object.keys(provider.modelOverrides ?? {}).length) throw new Error("exact_sync_requires_models_without_overrides");
const rawBefore = provider.models.map((model) => { if (!model || typeof model.id !== "string") throw new Error("invalid_model_id"); return model.id; });
if (new Set(rawBefore).size !== rawBefore.length) throw new Error("duplicate_configured_model_id");
const discovery = JSON.parse(readFileSync(process.env.PI_VENDOR_DISCOVERY_FILE, "utf8"));
if (!Array.isArray(discovery.routes) || discovery.routes.some((route) => route?.status !== "ok" || !Array.isArray(route.modelIds))) throw new Error("exact_sync_requires_verified_routes");
const before = sorted(rawBefore);
const after = sorted(discovery.routes.flatMap((route) => route.modelIds));
const beforeSet = new Set(before);
const afterSet = new Set(after);
const plan = { before, add: after.filter((id) => !beforeSet.has(id)), remove: before.filter((id) => !afterSet.has(id)), after };
writeFileSync(process.env.PI_VENDOR_SYNC_PLAN_FILE, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
process.stdout.write(JSON.stringify(plan));
NODE
```

Show that exact JSON output verbatim, resolve catalog source for every `add` ID, and obtain confirmation for its exact `remove` and `after` arrays. Do not type any model ID outside that JSON block.

### Assert before and after

Immediately before editing, run this exact stale check with `PI_VENDOR_SYNC_EXPECT=before`. A `plan_stale` result invalidates the plan; regenerate it rather than applying or merging it. Immediately after editing, run the same unchanged program with `PI_VENDOR_SYNC_EXPECT=after`; it must print `plan_after_matches=yes` before continuing.

```sh
PI_VENDOR_PROVIDER_KEY='<provider-key>' PI_VENDOR_SYNC_PLAN_FILE="$plan_file" PI_VENDOR_SYNC_EXPECT=before node <<'NODE'
const { readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");
const sorted = (ids) => [...new Set(ids)].sort((a, b) => a.localeCompare(b));
const expected = process.env.PI_VENDOR_SYNC_EXPECT;
if (expected !== "before" && expected !== "after") throw new Error("invalid_sync_assertion");
const configPath = join(process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent"), "models.json");
const provider = JSON.parse(readFileSync(configPath, "utf8"))?.providers?.[process.env.PI_VENDOR_PROVIDER_KEY];
const actual = sorted((provider?.models ?? []).map((model) => model?.id));
const plan = JSON.parse(readFileSync(process.env.PI_VENDOR_SYNC_PLAN_FILE, "utf8"));
if (JSON.stringify(actual) !== JSON.stringify(plan[expected])) { console.error(expected === "before" ? "plan_stale" : "plan_after_mismatch"); process.exit(1); }
console.log(`plan_${expected}_matches=yes`);
NODE
```

For the post-edit assertion, change only the shell assignment to `PI_VENDOR_SYNC_EXPECT=after`. Do not repair toward any hand-written list.

### Assert the final discovery union

After the mandatory Pi offline verification, rerun `discover` into `$discovery_file`, then run this assertion. It blocks success if any route fails or if the verified upstream union differs from the confirmed plan.

```sh
node '<absolute-skill-directory>/scripts/vendor.mjs' discover '<provider-key>' > "$discovery_file"
PI_VENDOR_DISCOVERY_FILE="$discovery_file" PI_VENDOR_SYNC_PLAN_FILE="$plan_file" node <<'NODE'
const { readFileSync } = require("node:fs");
const sorted = (ids) => [...new Set(ids)].sort((a, b) => a.localeCompare(b));
const discovery = JSON.parse(readFileSync(process.env.PI_VENDOR_DISCOVERY_FILE, "utf8"));
const plan = JSON.parse(readFileSync(process.env.PI_VENDOR_SYNC_PLAN_FILE, "utf8"));
if (!Array.isArray(discovery.routes) || discovery.routes.some((route) => route?.status !== "ok" || !Array.isArray(route.modelIds))) { console.error("discovery_unverified"); process.exit(1); }
if (JSON.stringify(sorted(discovery.routes.flatMap((route) => route.modelIds))) !== JSON.stringify(plan.after)) { console.error("discovery_union_mismatch"); process.exit(1); }
console.log("discovery_union_matches=yes");
NODE
```

## Choose one workflow

Classify the request into exactly one workflow, then follow its numbered steps. Do not invent a second discovery loop or combine workflows speculatively.

### 1. Configure a model

1. Treat the user's text as a model request, not automatically as a canonical ID. Preserve the original text.
2. Derive a useful catalog keyword and run `catalog`. For example, `千问 3.7` should be searched using likely catalog terms such as `qwen 3.7`, not mechanically written as the model ID. If the first search is empty, retry with simpler brand/version terms.
3. Compare `count` with `total`. If truncated, rerun with limit `100` and narrow the keyword until every relevant candidate is visible.
4. Show the mapping `(user text -> candidate ID -> official provider)` and all viable matches. A fuzzy result is a candidate, never silent authorization. If identity or official source is ambiguous, ask the user to select it.
5. Resolve the target provider. An exact target named by the user remains valid; do not ask twice.
6. Locate only the target provider/model range and apply the narrow edit. Copy non-routing metadata only from the selected official template. Never copy catalog `baseUrl`, credentials, headers, `provider`, or `authHeader`.
7. Run the mandatory final verification below. Do not report completion before it passes.

If catalog returns no match, say this is not proof the model is invalid. Ask whether to use the requested text as a custom ID or provide another search term. Do not silently normalize, suffix, or substitute it.

Use `models` for new/custom definitions and `modelOverrides` for partial changes to an existing built-in or extension model. Add model-level `api` or `baseUrl` only when it differs from the inherited provider route. Never create duplicate IDs in one provider's `models` array.

### 2. List or synchronize a provider's upstream models

1. Run exactly one aggregate query:

   ```sh
   node '<absolute-skill-directory>/scripts/vendor.mjs' discover '<provider-key>'
   ```

2. Report each returned route by `routeId`, API type, status, and model IDs. The command already deduplicates effective provider/model routes across the four supported API adapters; do not build a manual loop.
3. A returned ID is positive evidence that route listed it. An error means that route is unverified. Absence alone is not proof that a configured model is unsupported.
4. For a plain listing, stop here. Do not calculate or present configured/unconfigured/unsupported sets.
5. Only when the user explicitly requests an exact synchronization and every intended route has `status: "ok"`, use **Generate the plan** from the exact synchronization templates. It emits the sorted `{"before":[],"add":[],"remove":[],"after":[]}` JSON without exposing configuration or credentials.
6. Treat that generated JSON as immutable. Show it verbatim, run `catalog` for every ID in `add`, resolve every official source, and ask the user to confirm the exact `remove` and `after` arrays. Keep the whole batch read-only until every source and destructive choice is resolved.
7. If any intended route failed, do not propose removals or exact synchronization. Report the unverified route; individually adding IDs with positive evidence may continue through workflow 1.
8. Immediately before editing, run **Assert before and after**. If it returns `plan_stale`, stop, regenerate the plan, show it verbatim, and obtain fresh confirmation. Never merge a concurrent change into the old plan.
9. Apply only the confirmed plan and selected catalog templates. Immediately run its after assertion. `plan_after_mismatch` means repair only this mutation or restore its prior state, then rerun the assertion; a Pi-loadable file is not sufficient.
10. Run the mandatory final verification, then **Assert the final discovery union**. Exact sync is successful only when all three assertion templates pass.
11. If the user chooses only one model to add instead of synchronizing, continue with workflow 1 and use `catalog` only to resolve its official metadata.

### 3. Add a provider

1. Collect the provider key, `baseUrl`, API adapter, and any required non-secret headers. Do not guess unresolved routing.
2. Locate the `providers` object and add only the new provider with a narrow edit. Preserve every unrelated field.
3. If a key is required, create the provider without exposing it and give the user the `set-key` command. Continue only after the user reports completion.
4. Run the mandatory Pi offline verification.
5. When credentials are configured, run `discover <provider-key>`. At least the intended route must have `status: "ok"` before reporting the provider as upstream-verified.
6. If the user also requested a model, continue with workflow 1.

### 4. Read, update, or delete a provider/model

1. Locate the exact provider key or model ID without printing the full file.
2. For a read, report only non-secret routing fields and model IDs.
3. For an update, patch only the requested fields. Before changing inherited provider routing, identify affected models and preserve required model-level overrides.
4. For deletion, show the exact target and confirm unless the user already requested that exact deletion. Removing a built-in override restores built-in behavior; it does not delete Pi's built-in provider.
5. Apply the narrow edit, then run the mandatory final verification.

For conflicts, report the exact JSON path and ask whether to update, replace, skip, or choose another target. Do not upsert silently.

## Mandatory final verification

Every mutation has a hard completion gate:

1. Run the active Pi executable against the active configuration:

   ```sh
   pi --list-models --offline
   ```

2. Inspect both streams. Pi can exit zero even when it prints `Warning: errors loading models.json:`. Require no models.json loading warning; after a model mutation, also require the intended model ID to be present or absent as requested.
3. For an exact synchronization, structurally compare the configured sorted ID set with the confirmed plan's `after` array. Exact equality is mandatory; do not reconstruct either side manually.
4. If the command fails, emits any models.json loading warning, or any intended or exact-set assertion fails, repair only the targeted edit or restore its previous value, then rerun every failed check. Never end with an invalid or wrongly synchronized configuration.
5. After provider routing, authentication, model routing, or synchronization changes, also run `discover <provider-key>`. Require every intended route to return `status: "ok"`; for exact sync, require its discovered-ID union to equal the confirmed `after` set. Otherwise report verification failure, not configuration success.
6. Do not print the whole provider, full diff, credential-bearing diagnostics, or raw secret values while verifying.

An actual generation request can consume quota and is not part of the default gate. Run one only when the user explicitly asks for a live model call.

After successful verification, report only the changed JSON paths, selected official source or custom status, Pi offline verification result, and applicable discovery status.

## API keys

Give the user this command; do not execute it:

```sh
node '<absolute-skill-directory>/scripts/vendor.mjs' set-key '<provider-key>'
```

It prompts without echo and atomically writes mode `0600`. After the user reports completion, run the mandatory final verification; never ask them to reveal the value.

## Audit

For an audit, run Pi offline validation, use `discover` for configured upstream routes, and use `catalog` only for model metadata questions. Report exact JSON paths, route statuses, ambiguity, and remediation without credential values. Do not rewrite a clean file.
