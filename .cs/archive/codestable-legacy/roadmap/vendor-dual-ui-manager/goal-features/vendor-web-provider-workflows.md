# Goal Feature: vendor-web-provider-workflows

- Roadmap item: `vendor-web-provider-workflows`
- Depends on: `vendor-config-core`, `vendor-web-modal-runtime`
- Nature: functional
- Design: `.codestable/features/2026-07-12-vendor-web-provider-workflows/vendor-web-provider-workflows-design.md`
- Checklist: `.codestable/features/2026-07-12-vendor-web-provider-workflows/vendor-web-provider-workflows-checklist.yaml`
- Design review: `.codestable/features/2026-07-12-vendor-web-provider-workflows/vendor-web-provider-workflows-design-review.md`
- Code review: `.codestable/features/2026-07-12-vendor-web-provider-workflows/vendor-web-provider-workflows-review.md`
- QA: `.codestable/features/2026-07-12-vendor-web-provider-workflows/vendor-web-provider-workflows-qa.md`
- Acceptance: `.codestable/features/2026-07-12-vendor-web-provider-workflows/vendor-web-provider-workflows-acceptance.md`

## Deliverable

完整 Web provider 管理：single draft、create/rename/delete、common/optional field策略、Add setting、Raw JSON、sanitized Before/After 与 recoverable save errors。

## Core Runtime Path

浏览器加载 sanitized document，选择/新增 provider，结构化编辑或Apply Raw JSON，使用shared mutation/conflict policies和SecretRef preflight，最终通过既有PUT一次保存或Cancel。

## Mandatory Commands

```bash
npm --workspace @bytetrue/pi-vendor run build:web
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor run typecheck
```

## Feature DoD

- Structured forms与Raw JSON只共享一个canonical draft；invalid Raw text不污染draft。
- Common字段常显；optional按hasOwn/Add setting；clear/remove语义明确；unknown无损。
- Create/rename/delete复用shared mutations；冲突/overwrite/delete显式confirm并显示影响counts。
- Rename含SecretRef subtree时block并要求重输/删除，不remap；remove secret有独立确认。
- Sanitized Before/After/summary不泄露literal/ref内部值。
- 400字段关联、409保留draft并要求重开、success terminal、cancel零写。
- Semantic HTML/native dialog/details、keyboard/focus/error association/narrow layout。

## Stage Gates

- Review：独立 reviewer核验single-store、field visibility、mutations、SecretRef path、Raw JSON、a11y。
- QA：state tests、HTTP integration、browser provider matrix、keyboard/narrow screenshots。
- Acceptance：provider全生命周期与error/cancel证据，全checks passed。

## Evidence Required

- build/test/typecheck outputs
- State/mutation/SecretRef adversarial tests
- HTTP integration
- Browser manual + screenshots
- Scope/cleanliness manifest

## Deliverables

- Browser store/provider UI/raw/diff modules and tests
- Updated static assets
- Review/QA/acceptance/evidence/gates

## Cleanliness

Vanilla TS/CSS，无framework、无model CRUD、无secret reveal/remap、无输入级HTTP CRUD。

## Failure Recovery

Shared mutation/SecretRef contract需变化时 handoff。A11y/视觉/错误映射可在approved边界内修复。
