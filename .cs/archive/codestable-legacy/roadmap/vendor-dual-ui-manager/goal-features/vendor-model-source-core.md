# Goal Feature: vendor-model-source-core

- Roadmap item: `vendor-model-source-core`
- Depends on: `vendor-config-core`, `vendor-web-modal-runtime`
- Nature: functional
- Design: `.codestable/features/2026-07-12-vendor-model-source-core/vendor-model-source-core-design.md`
- Checklist: `.codestable/features/2026-07-12-vendor-model-source-core/vendor-model-source-core-checklist.yaml`
- Design review: `.codestable/features/2026-07-12-vendor-model-source-core/vendor-model-source-core-design-review.md`
- Code review: `.codestable/features/2026-07-12-vendor-model-source-core/vendor-model-source-core-review.md`
- QA: `.codestable/features/2026-07-12-vendor-model-source-core/vendor-model-source-core-qa.md`
- Acceptance: `.codestable/features/2026-07-12-vendor-model-source-core/vendor-model-source-core-acceptance.md`

## Deliverable

安全 model-source core：official search/enrichment closed DTO、exact Pi config-value resolver、all-command trust preflight、bounded `/models` discovery，以及 runtime routes。

## Core Runtime Path

GET catalog、POST enrich、POST discover；discover 从 sanitized provider draft 经 runtime non-consuming credential hydration，先预检所有 command paths，再在单一15s预算内执行runner/fetch/stream reader，保持 Web session open。

## Mandatory Commands

```bash
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor run typecheck
npm run typecheck --workspaces --if-present && npm test
```

## Feature DoD

- Closed DTO 逐字段映射 current-safe cost.tiers/compat；禁止 spread/cast/routing/credential/unknown。
- Exact Pi parser：raw command equality/no trim、env templates/escapes/fallback/uncached semantics。
- All-command preflight 后才能执行任何 runner；real runner 覆盖 nonzero/abort/timeout/64KiB。
- 15s overall deadline、caller abort precedence、2MiB decoded stream、redirect error、non-2xx cancel、10k/1KiB/code-unit sort。
- Routes 使用 typed safe errors、request disconnect cancellation、session-preserving behavior。
- Deep-path compatibility stubs与行为等价 move有验证。

## Stage Gates

- Review：独立 reviewer核验 DTO fidelity、command trust、deadline/abort、secret sanitization、DAG/runtime seam。
- QA：fixture catalog、real runner、fake streams、real local HTTP disconnect/routes。
- Acceptance：serialization leak scan、route/session evidence、all checks passed。

## Evidence Required

- DTO serialization scan/fixtures
- Resolver/runner/fetch/stream contract tests
- HTTP route/disconnect integration
- Command output and workspace regression
- Scope/cleanliness manifest

## Deliverables

- `src/model-source/**` + compatibility exports/tests
- Runtime model routes
- Review/QA/acceptance/evidence/gates

## Cleanliness

不复制 Pi private schema，不 browser fetch/command，不引入搜索/HTTP框架；safe DTO unknown field必须 loud failure而非 passthrough。

## Failure Recovery

Current Pi catalog新增字段导致approved DTO需变更，或 command/credential contract不闭合时 handoff 回 design。非核心 catalog unavailable 可 fail-soft，但 custom/discover路径仍须可用。
