# Goal Feature: vendor-dual-ui-hardening

- Roadmap item: `vendor-dual-ui-hardening`
- Depends on: `vendor-tui-quick-workflows`, `vendor-web-model-workflows`
- Nature: non-functional
- Design: `.codestable/features/2026-07-12-vendor-dual-ui-hardening/vendor-dual-ui-hardening-design.md`
- Checklist: `.codestable/features/2026-07-12-vendor-dual-ui-hardening/vendor-dual-ui-hardening-checklist.yaml`
- Design review: `.codestable/features/2026-07-12-vendor-dual-ui-hardening/vendor-dual-ui-hardening-design-review.md`
- Code review: `.codestable/features/2026-07-12-vendor-dual-ui-hardening/vendor-dual-ui-hardening-review.md`
- QA: `.codestable/features/2026-07-12-vendor-dual-ui-hardening/vendor-dual-ui-hardening-qa.md`
- Acceptance: `.codestable/features/2026-07-12-vendor-dual-ui-hardening/vendor-dual-ui-hardening-acceptance.md`

## Deliverable

Evidence-first aggregate hardening：CI/generated/real tarball smoke、cross-surface regression、security/error/race/a11y/platform/10k证据、README与scope cleanup；不加产品功能。

## Core Runtime Path

非功能 feature，无新runtime path。替代证据是对已实现TUI/Web核心路径、真实tarball安装布局与组合fixtures的全面复核。

## Mandatory Commands

```bash
npm --workspace @bytetrue/pi-vendor run build:web
npm --workspace @bytetrue/pi-vendor run typecheck
npm --workspace @bytetrue/pi-vendor test
npm run typecheck --workspaces --if-present
npm test
node packages/pi-vendor/scripts/pack-smoke.mjs
```

还需 generated reproducibility、最低Pi fixture、browser/TUI/manual/platform/a11y evidence。

## Feature DoD

- 先跑aggregate matrix，仅修acceptance failure；不预做大清理/重写。
- Generated assets deterministic；CI build→guard→tests→real tarball extraction/runtime smoke。
- Cross-surface fixture证明single-write、unknown/missing、secret leak、errors/races一致。
- Opener adapters、keyboard/focus/narrow、10k measure-first有证据。
- README诚实覆盖命令、Web/TUI、安全/限制/恢复；无secret/capability/local path。
- No release/version/commit/push；只删本epic产生的obsolete文件。

## Stage Gates

- Review：独立 reviewer核验evidence、CI/pack、scope/no-new-feature、docs honesty。
- QA：完整aggregate commands、真实tarball、TUI/Web core paths、a11y/platform/screenshots。
- Acceptance：所有前序/当前checks与items/writebacks齐全，残余风险无核心缺口。

## Evidence Required

- Command/CI outputs
- Real tarball asset/runtime smoke
- QA matrix、TUI transcript、browser manual/screenshots
- Secret/error/race/cross-surface reports
- Workspace scope/cleanliness and docs diff

## Deliverables

- CI scripts/workflow and pack smoke
- Aggregate tests/fixtures/evidence
- README/docs updates
- Review/QA/acceptance/gates

## Cleanliness

无新增feature/route/mutation/framework/E2E framework；无release、broad cleanup、temporary artifacts。

## Failure Recovery

Aggregate evidence发现approved contract实现缺口时回对应feature修复并重跑其review/QA，再回hardening。若必须改变approved design则 handoff。
