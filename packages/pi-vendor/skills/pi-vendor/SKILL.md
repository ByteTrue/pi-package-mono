---
name: pi-vendor
description: >
  Manage and audit Pi providers, custom models, modelOverrides, routing/API
  adapters, and upstream model discovery in models.json. Use for any models.json
  or provider/model configuration request. Every model field comes from the
  official catalog, upstream discovery, or the user; credentials stay out of the
  conversation; the user resolves ambiguous providers, model IDs, and official
  sources.
---

# Pi Vendor

Manage Pi's `models.json` with normal read/edit tools. The bundled script has exactly three AI-facing read-only queries:

```sh
node '<absolute-skill-directory>/scripts/vendor.mjs' catalog '<keyword>' ['<limit>']
node '<absolute-skill-directory>/scripts/vendor.mjs' discover '<provider-key>'
node '<absolute-skill-directory>/scripts/vendor.mjs' drift '<provider-key>' ['<official-provider>,...']
```

`drift` compares a provider's configured models against the active Pi installation's built-in official catalog (the same templates `catalog` serves) and reports per-field differences plus a machine-generated drift table; a model counts as up to date when it still matches at least one current official template exactly. Replace `<absolute-skill-directory>` with the directory containing this `SKILL.md`. Shell-quote the script path and every argument as one positional value (single quotes), so user text reaches the script literally. There is no AI-facing CRUD or lint command. `/vendor` remains the human cold-start TUI.

`set-key` is a separate user-terminal-only helper because it prompts for a secret:

```sh
node '<absolute-skill-directory>/scripts/vendor.mjs' set-key '<provider-key>'
```

Hand this command to the user to run in their own terminal and wait for them to report completion; the secret stays out of chat entirely.

When a bundled query fails (for example `catalog` printing `Official catalog is unavailable`), make at most one documented recovery attempt — locate the active Pi install prefix and retry once with `PI_VENDOR_PI_ROOT` — then report to the user in one short message what failed and what you tried, and wait for their direction. Diagnose from command output and package paths; `models.json` contents and credential values stay out of the transcript.

## Boundaries

- Treat every `apiKey` and authentication header value as secret: refer to it only as configured, missing, or changed — in replies, diffs, logs, tool arguments, and summaries alike.
- Locate provider/model keys first (targeted search), then read only the smallest range needed for the mutation. The file carries secrets, so a whole-file read (`cat`, full `read`) is the one read shape to avoid.
- Make the smallest targeted edit that preserves unknown fields and unrelated providers; everything outside the edit stays as the user wrote it.
- Distinguish the configured target provider from the official catalog provider whose metadata is copied.
- `catalog` is official metadata, not evidence that a target provider exposes a model. `discover` is upstream evidence, not official metadata.
- Every pricing, capability, context/token limit, compat field, model ID, and routing value comes from the selected catalog template, `discover` output, or the user; when none of them supplies it, ask.
- The user decides ambiguous model identity, official source, target provider, overwrite conflicts, and destructive operations.
- Edit only `models.json`, and in it only the requested provider/model. `auth.json`, OAuth state, Pi settings, and unrelated providers change only on an explicit request.
- For an exact synchronization, the machine-generated plan JSON is the only mutation authority: show it verbatim and refer to its arrays by name (`add`, `remove`, `after`) rather than retyping IDs. Machine-generated tables are relayed as-is, and user-facing references name each model by its exact ID.
- `drift` output is evidence for the user to confirm; its updates land only after the user approves them field by field.

## Exact synchronization templates

These are the only templates for exact synchronization. Keep `sync_dir`, `discovery_file`, and `plan_file` for the entire confirmation and mutation sequence; clean them after a successful finish or an abandoned plan. They contain only model IDs and route status, never credentials. Substitute only the shell-quoted provider key and absolute skill directory; the Node programs run byte-for-byte as written.

### Generate the plan

Run this once after `discover` has returned only `status: "ok"` routes. It writes the immutable plan file and prints the plan JSON followed by a machine-generated summary table; it reads only `providers.<key>.models` internally. Exact synchronization covers `models` only; `modelOverrides` go through workflow 4.

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
const kept = plan.before.filter((id) => !plan.remove.includes(id));
let summary = "#### Sync plan summary (machine-generated; the JSON above is the only mutation authority)\n\n";
if (plan.add.length + plan.remove.length === 0) summary += "No additions or removals: the configured set already equals the verified upstream union.\n";
else {
  summary += "| action | model id |\n|---|---|\n";
  for (const id of plan.add) summary += `| add | ${id} |\n`;
  for (const id of plan.remove) summary += `| remove | ${id} |\n`;
}
summary += `\nkept ${kept.length} of ${plan.before.length} configured models unchanged${kept.length ? `: ${kept.join(", ")}` : ""}\n`;
process.stdout.write(`${JSON.stringify(plan)}\n\n${summary}`);
NODE
```

Show that printed output verbatim: the one-line plan JSON is the mutation authority and the summary table below it is for the user. Resolve catalog source for every `add` ID, present that resolution as a table (model ID, official provider, key metadata, status), and obtain confirmation for the exact `remove` and `after` arrays. Every model ID the user sees comes from that machine output, quoted as-is; prose refers to models by their exact ID.

### Assert before and after

Immediately before editing, run this exact stale check with `PI_VENDOR_SYNC_EXPECT=before`. A `plan_stale` result invalidates the plan; regenerate it and obtain fresh confirmation. Immediately after editing, run the same unchanged program with `PI_VENDOR_SYNC_EXPECT=after`; it must print `plan_after_matches=yes` before continuing.

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

For the post-edit assertion, change only the shell assignment to `PI_VENDOR_SYNC_EXPECT=after`. On `plan_after_mismatch`, repair toward the plan's `after` array (or restore the prior state), then rerun the assertion.

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

Classify the request into exactly one workflow and follow its numbered steps. When a step hands off ("continue with workflow 1"), that hand-off is the only way into another workflow; a single `discover` call is the whole discovery for a request.

### 1. Configure a model

1. Treat the user's text as a model *request* and preserve it verbatim; the canonical ID is whatever `catalog` resolves it to.
2. Derive a useful catalog keyword and run `catalog`. For example, search `千问 3.7` with likely catalog terms such as `qwen 3.7`. If the first search is empty, retry with simpler brand/version terms.
3. Compare `count` with `total`. If truncated, rerun with limit `100` and narrow the keyword until every relevant candidate is visible.
4. Show the mapping `(user text -> candidate ID -> official provider)` and all viable matches. A fuzzy result is a candidate that the user confirms. If identity or official source is ambiguous, ask the user to select it.
5. Resolve the target provider. An exact target named by the user is settled; move on.
6. Locate only the target provider/model range and apply the narrow edit. When copying from the selected official template, preserve 100% of the official template's non-routing metadata verbatim:
   - Retain every official field (e.g. `allowedFallbackModels`, `compat`, `thinkingLevelMap`, `contextWindow`, etc.) without dropping or trimming anything.
   - Retain the exact key order of the official template, even when neighbouring models in the file use a different order.
   - Routing fields (`baseUrl`, credentials, headers, `provider`, `authHeader`) come from the target provider, so they are left out of the copy.
   - Apply the Anthropic Messages `baseUrl` Rule below if applicable.
7. Run the mandatory final verification below; completion is reported only after it passes.
8. Run the mandatory Model ordering check (see the "Model ordering" section). If any model order deviates, ask the user before concluding.

If catalog returns no match, say so — absence is not proof the model is invalid — and ask whether to use the requested text verbatim as a custom ID or to try another search term. The ID the user typed stays exactly as typed until they choose.

Use `models` for new/custom definitions and `modelOverrides` for partial changes to an existing built-in or extension model. Add model-level `api` or `baseUrl` only when it differs from the inherited provider route, with one mandatory exception:

- **Anthropic Messages `baseUrl` Rule**: Pi's `anthropic-messages` adapter (via the Anthropic SDK) automatically appends `/v1/messages` to requests. If a model uses or inherits `api: "anthropic-messages"` while the provider's `baseUrl` contains a trailing `/v1` (e.g. `http://host:port/v1`), you **must** configure a model-level `baseUrl` stripped of the trailing `/v1` (e.g. `baseUrl: "http://host:port"`). Leaving it unconfigured causes requests to hit `/v1/v1/messages` and fail with 404. When the provider's `baseUrl` has no `/v1` segment, the model inherits it unchanged (no model-level `baseUrl`).

- **Strict-Patch Rule (In-Place Integrity)**:
  - When updating an existing model, change **only** the specific field value requested by the user. Every other field and the original key declaration order remain 100% unchanged.
  - When adding a model from an official template, carry over all non-routing fields in their exact official key order.

Each model ID appears once per provider's `models` array; when the ID already exists, the request is an update (workflow 4), not a second entry.

### 2. List or synchronize a provider's upstream models

1. Run exactly one aggregate query:

   ```sh
   node '<absolute-skill-directory>/scripts/vendor.mjs' discover '<provider-key>'
   ```

2. Report each returned route by `routeId`, API type, status, and model IDs. The command already deduplicates effective provider/model routes across the four supported API adapters, so this one call is the whole discovery.
3. A returned ID is positive evidence that route listed it. An error means that route is unverified. Absence alone is not proof that a configured model is unsupported.
4. For a plain listing, stop here and report the routes and IDs as returned. Configured/unconfigured/unsupported set comparisons belong to exact synchronization only.
5. Only when the user explicitly requests an exact synchronization and every intended route has `status: "ok"`, use **Generate the plan** from the exact synchronization templates. It emits the sorted `{"before":[],"add":[],"remove":[],"after":[]}` JSON plus a machine-generated summary table without exposing configuration or credentials.
6. Treat that generated JSON as immutable. Show the printed plan JSON and its summary table verbatim, run `catalog` for every ID in `add`, and resolve every official source. Present the resolution as a table (model ID, official provider, key metadata, status), naming each model by its exact ID. Ask the user to confirm the exact `remove` and `after` arrays. Keep the whole batch read-only until every source and destructive choice is resolved.
7. **Kept-model drift check.** For the models that stay configured (present in both `before` and `after`), run `node '<absolute-skill-directory>/scripts/vendor.mjs' drift '<provider-key>'` and relay its drift table verbatim. A drifted model is a question: its configured copy no longer matches any current official template, and the user decides whether that is intended or stale. Combine this with the plan confirmation into a single confirmation round when both are ready; the update waits for the user's per-field approval.
8. If any intended route failed, report the unverified route and offer only additions with positive evidence (workflow 1); removals and exact synchronization wait until every intended route is `ok`.
9. Immediately before editing, run **Assert before and after**. If it returns `plan_stale`, stop, regenerate the plan, show it verbatim, and obtain fresh confirmation — the old plan is discarded.
10. Apply only the confirmed plan and selected catalog templates, ensuring any `anthropic-messages` models on a provider with a trailing `/v1` `baseUrl` receive a model-level `baseUrl` stripped of `/v1`. Immediately run its after assertion. `plan_after_mismatch` means repair only this mutation or restore its prior state, then rerun the assertion; the gate is the assertion, beyond Pi merely loading the file.
11. After the sync assertions pass, apply the user-approved drift updates as strict in-place patches: change only the approved field values, keep every other field and the original key declaration order 100% unchanged, and leave unapproved fields as they are.
12. Run the mandatory final verification, then **Assert the final discovery union**. Exact sync is successful only when all three assertion templates pass.
13. Run the mandatory Model ordering check, fetching `https://models.dev/api.json` for release dates (retry once through the environment's configured proxy if the direct fetch fails). If any order deviates, prompt the user before concluding.
14. If the user chooses only one model to add instead of synchronizing, continue with workflow 1 and use `catalog` only to resolve its official metadata.

### 3. Add a provider

1. Collect the provider key, `baseUrl`, API adapter, and any required non-secret headers; ask for anything unresolved.
2. Locate the `providers` object and add only the new provider with a narrow edit. Preserve every unrelated field.
3. If a key is required, create the provider without exposing it and give the user the `set-key` command. Continue only after the user reports completion.
4. Run the mandatory Pi offline verification.
5. When credentials are configured, run `discover <provider-key>`. At least the intended route must have `status: "ok"` before reporting the provider as upstream-verified.
6. If the user also requested a model, continue with workflow 1.

### 4. Read, update, or delete a provider/model

1. Locate the exact provider key or model ID with a targeted search and read only that range.
2. For a read, report only non-secret routing fields and model IDs.
3. For an update, apply a strict in-place patch: modify only the requested field value. Keep every other existing field, nested structure, and key declaration order 100% intact. Before changing inherited provider routing, identify affected models and preserve required model-level overrides (including the Anthropic Messages trailing `/v1` `baseUrl` rule).
4. For deletion, show the exact target and confirm unless the user already requested that exact deletion. Removing a built-in override restores built-in behavior; it does not delete Pi's built-in provider.
5. Apply the narrow edit, then run the mandatory final verification.
6. After a model update or deletion, run the mandatory Model ordering check. If any order deviates, ask the user before concluding.

For conflicts, report the exact JSON path and ask whether to update, replace, skip, or choose another target; the edit waits for that answer.

## Mandatory final verification

Every mutation has a hard completion gate:

1. Run the active Pi executable against the active configuration:

   ```sh
   pi --list-models --offline
   ```

2. Inspect both streams. Pi can exit zero even when it prints `Warning: errors loading models.json:`. Require no models.json loading warning; after a model mutation, also require the intended model ID to be present or absent as requested.
3. For an exact synchronization, structurally compare the configured sorted ID set with the confirmed plan's `after` array. Exact equality is mandatory; both sides come from the assertion template, never from a hand-built list.
4. If the command fails, emits any models.json loading warning, or any intended or exact-set assertion fails, repair only the targeted edit or restore its previous value, then rerun every failed check. The task ends only with a configuration that passes every check.
5. After provider routing, authentication, model routing, or synchronization changes, also run `discover <provider-key>`. Require every intended route to return `status: "ok"`; for exact sync, require its discovered-ID union to equal the confirmed `after` set. Otherwise report verification failure, not configuration success.
6. Report verification by changed JSON paths and check results; the whole provider block, full diff, credential-bearing diagnostics, and raw secret values stay out of the transcript.

An actual generation request can consume quota and is not part of the default gate. Run one only when the user explicitly asks for a live model call.

After successful verification, check model ordering (next section), then report only the changed JSON paths, selected official source or custom status, Pi offline verification result, and applicable discovery status.

## Model ordering

Every model mutation workflow (Configure a model, Exact sync, Update/delete a model) has a mandatory ordering check gate before reporting completion.

After a successful mutation and mandatory final verification, check the entire file just edited — every provider's `models` array, not only the provider you touched — against the agreed order. Partial reordering is meaningless.

The agreed order is:

1. Model series / families in alphabetical order (A-Z) by top-level brand or series name (e.g. `claude` before `deepseek`, `deepseek` before `gemini`, `gemini` before `glm`, `glm` before `gpt`, `gpt` before `kimi`, `kimi` before `qwen`).
2. Within the same model series, models are ordered strictly by release date (`release_date`), oldest first (e.g. across the entire `claude` series: `claude-haiku-4-5` [2025-10-15] before `claude-fable-5` [2026-06-07] before `claude-sonnet-5` [2026-06-29] before `claude-opus-5` [2026-07-24] before `claude-fable-5-1` [2026-09-01]; fable-5 was released before sonnet-5 and opus-5, so it must precede them).

Release dates come from `https://models.dev/api.json`. Fetch it, and when the direct fetch fails, retry once through the environment's configured proxy; match each configured model ID against the providers/models there and use the matched model's `release_date`. If a model cannot be matched there, keep its relative position and ask the user for its date.

**Enforcement Gate**:
If any provider's `models` array deviates from the agreed order (such as `claude-fable-5` incorrectly placed after `claude-opus-5`), **explicitly alert the user to the detected disorder** and ask whether to reorganize the entire file before reporting completion.

Reordering is a narrow edit: move whole model objects without changing any field or key order within them. Confirm the proposed final order with the user before editing. Then rerun the mandatory final verification.

This check applies to the file just edited only.

## API keys

Give the user this command to run in their own terminal:

```sh
node '<absolute-skill-directory>/scripts/vendor.mjs' set-key '<provider-key>'
```

It prompts without echo and atomically writes mode `0600`. After the user reports completion, run the mandatory final verification; the value itself stays with the user.

## Audit

For an audit, run Pi offline validation, use `discover` for configured upstream routes, and use `catalog` only for model metadata questions. Run `drift <provider-key>` against the built-in official catalog and report per-model template drift alongside the Pi version the comparison used. Verify routing constraints, especially the Anthropic Messages rule: any model with `api: "anthropic-messages"` under a provider whose `baseUrl` ends in `/v1` must specify a model-level `baseUrl` without `/v1`. Report exact JSON paths, route statuses, routing defects, ambiguity, and remediation without credential values. A clean file gets a clean report and no edit.
