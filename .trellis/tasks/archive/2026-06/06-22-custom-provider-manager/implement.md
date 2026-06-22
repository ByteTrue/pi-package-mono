# Implementation Plan: Custom Provider Manager Extension

## Gate

Do not implement until the user reviews `prd.md`, `design.md`, and this file, then explicitly approves starting implementation. After approval, run:

```bash
python3 ./.trellis/scripts/task.py start 06-22-custom-provider-manager
```

## Target package

Create `packages/pi-vendor` with the same minimal package shape as existing packages:

- `package.json`
- `tsconfig.json`
- `README.md`
- `src/index.ts`
- focused modules under `src/`
- unit tests next to modules as `*.test.ts`

## Ordered checklist

### 1. Package skeleton

- Add `packages/pi-vendor/package.json`.
- Add `packages/pi-vendor/tsconfig.json` extending `../../tsconfig.base.json`.
- Add initial `README.md` documenting `/vendor`, `models.json`, and official-catalog-first enrichment.
- Add `src/index.ts` registering `/vendor`.

Validation:

```bash
npm run typecheck --workspace @bytetrue/pi-vendor
```

### 2. Config and JSON persistence helpers

Implement `src/models-json.ts`:

- resolve `models.json` path from `PI_CODING_AGENT_DIR` or `~/.pi/agent`;
- read missing file as `{ providers: {} }`;
- fail on malformed JSON without overwriting;
- upsert provider while preserving unrelated top-level fields and providers;
- formatted write with trailing newline.

Tests:

- missing file default;
- malformed JSON returns/throws safe error;
- upsert preserves unknown fields and unrelated providers;
- provider key rename removes old key only when requested by caller.

### 3. Official catalog lookup

Implement `src/official-catalog.ts`:

- locate installed `models.generated.js` locally;
- load `MODELS` dynamically;
- exact-match model id across all official providers;
- produce merge-ready configs by removing only routing/auth fields:
  - `provider`
  - `baseUrl`
  - `headers`
  - `apiKey`
  - `authHeader`
- return all candidates for ambiguous IDs.

Tests:

- merge-ready stripping keeps non-routing metadata;
- multiple candidates are returned, not auto-selected;
- missing catalog degrades to no candidates.

### 4. Fallback templates and enrichment

Implement:

- `src/templates.ts`
- `src/enrich.ts`

Behavior:

- official exact lookup first;
- if one official candidate, use it;
- if many, command layer asks user to choose;
- if none, exact template match;
- then longest prefix template;
- then safe defaults;
- track enrichment source (`official`, `template`, `default`) for preview/warnings.

Tests:

- exact template beats prefix;
- longest prefix wins;
- unknown ID uses safe defaults;
- official result beats fallback template.

### 5. OpenAI-compatible `/models` import

Implement `src/openai-models.ts`:

- endpoint construction from provider `baseUrl`;
- API key resolution for literal/env-reference values without changing stored provider config;
- fetch `{ data: [{ id }] }`;
- return sorted/deduped IDs.

Tests:

- URL construction preserves `/v1`;
- env references resolve for fetch;
- unresolved env reference fails clearly;
- response parser ignores entries without string `id`.

### 6. `/vendor` command flow

Implement `src/command.ts`:

- provider list;
- add/edit provider draft;
- provider form loop;
- model list loop;
- manual model ID add;
- local library/template selection;
- `/models` import;
- official ambiguity chooser;
- JSON preview via `ctx.ui.editor` or `ctx.ui.notify` + editor;
- save confirmation and write.

Keep it boring: repeated `ctx.ui.select` / `ctx.ui.input` loops, no custom full-screen TUI for MVP.

### 7. README and root docs

- Document package in `packages/pi-vendor/README.md`.
- Add one row to root `README.md` package table.

### 8. Final validation

Run:

```bash
npm run typecheck --workspace @bytetrue/pi-vendor
npm run test --workspace @bytetrue/pi-vendor
npm run test
```

If package-level scripts are not enough, run the relevant existing workspace checks as well.

## Risk points

- Official catalog resolution can differ between local dev and installed package layout. Keep lookup defensive and testable.
- `ctx.ui.select` may not support multi-select. If so, use a simple repeated selection flow for MVP instead of adding custom TUI.
- Do not persist resolved secret values when the provider draft uses `$ENV_VAR` or `${ENV_VAR}`.
- Do not overwrite malformed `models.json`.
- Do not let official provider routing/auth leak into the custom provider model config.

## Rollback

All implementation is contained in:

- `packages/pi-vendor/**`
- root `README.md` package row
- optional workspace metadata/package-lock changes if npm install/update is needed

Rollback by deleting `packages/pi-vendor` and reverting the README/package-lock changes.
