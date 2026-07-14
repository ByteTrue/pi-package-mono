# Goal Feature: vendor-web-model-workflows

- Roadmap item: `vendor-web-model-workflows`
- Depends on: `vendor-model-source-core`, `vendor-web-provider-workflows`
- Nature: functional
- Design: `.codestable/features/2026-07-12-vendor-web-model-workflows/vendor-web-model-workflows-design.md`
- Checklist: `.codestable/features/2026-07-12-vendor-web-model-workflows/vendor-web-model-workflows-checklist.yaml`
- Design review: `.codestable/features/2026-07-12-vendor-web-model-workflows/vendor-web-model-workflows-design-review.md`
- Code review: `.codestable/features/2026-07-12-vendor-web-model-workflows/vendor-web-model-workflows-review.md`
- QA: `.codestable/features/2026-07-12-vendor-web-model-workflows/vendor-web-model-workflows-qa.md`
- Acceptance: `.codestable/features/2026-07-12-vendor-web-model-workflows/vendor-web-model-workflows-acceptance.md`

## Deliverable

Web model table/editor与三种来源：official catalog、custom id、OpenAI-compatible `/models` bulk import；共享mutation、closed DTO和SecretRef array-shift防护。

## Core Runtime Path

选择provider后管理models；official/custom逐项enrich；discover最多选100并concurrency8处理；ambiguous/default/failed逐行决策，Apply只更新browser draft，最终Save仍走单次PUT。

## Mandatory Commands

```bash
npm --workspace @bytetrue/pi-vendor run build:web
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor run typecheck
```

## Feature DoD

- Document index是identity；visual sort不改array；stale editor用index+previousId检测。
- add/replace/delete复用shared mutations；conflict/overwrite/delete显式确认并保持order。
- preview mutation检查surviving SecretRefs；array shift/moved refs block；allowedRemovedPrefixes只由confirmed action生成。
- Official闭合DTO逐字段copy，不导入routing/credential/unknown；ambiguity必须选择，default warning可编辑。
- Discover只走server hydration/routes；最多100，concurrency8，abort旧请求，partial recovery/deterministic apply/skipped summary。
- Catalog unavailable降级到custom/discover；model routes不settle session。
- Table/dialog/live status/keyboard/focus/narrow/a11y证据齐全；10k measure-first。

## Stage Gates

- Review：独立 reviewer核验index identity、order、SecretRef shifts、DTO fidelity、bulk state/concurrency、scope。
- QA：state/route/browser matrices、10k measurement、keyboard/narrow/screenshots。
- Acceptance：model CRUD与三来源导入核心路径、single draft/save、all checks passed。

## Evidence Required

- build/test/typecheck outputs
- Model mutation/order/stale/ref tests
- Route integration and bulk pipeline tests
- Browser manual/screenshots/10k measurement
- Scope/cleanliness manifest

## Deliverables

- Model table/editor/catalog/custom/discover/import modules and tests
- Updated static assets
- Review/QA/acceptance/evidence/gates

## Cleanliness

无model CRUD HTTP、browser fetch/command、drag reorder、预设虚拟化依赖、secret reveal/remap。

## Failure Recovery

10k性能证据失败时先measure并在approved measure-first边界内最小优化；若需新增framework/virtualization architecture或改变SecretRef contract则 handoff。
