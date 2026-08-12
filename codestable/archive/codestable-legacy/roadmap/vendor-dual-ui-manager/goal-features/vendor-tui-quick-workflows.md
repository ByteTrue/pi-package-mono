# Goal Feature: vendor-tui-quick-workflows

- Roadmap item: `vendor-tui-quick-workflows`
- Depends on: `vendor-config-core`, `vendor-model-source-core`, `vendor-web-modal-runtime`
- Nature: functional
- Design: `.codestable/features/2026-07-12-vendor-tui-quick-workflows/vendor-tui-quick-workflows-design.md`
- Checklist: `.codestable/features/2026-07-12-vendor-tui-quick-workflows/vendor-tui-quick-workflows-checklist.yaml`
- Design review: `.codestable/features/2026-07-12-vendor-tui-quick-workflows/vendor-tui-quick-workflows-design-review.md`
- Code review: `.codestable/features/2026-07-12-vendor-tui-quick-workflows/vendor-tui-quick-workflows-review.md`
- QA: `.codestable/features/2026-07-12-vendor-tui-quick-workflows/vendor-tui-quick-workflows-qa.md`
- Acceptance: `.codestable/features/2026-07-12-vendor-tui-quick-workflows/vendor-tui-quick-workflows-acceptance.md`

## Deliverable

任务导向 `/vendor`：精确 root menu、已有 provider quick add model、新 provider最短向导、Web入口，并移除旧完整字段编辑器。

## Core Runtime Path

在 Pi TUI 中按 root → provider/source/model → summary → Save/Add another/Cancel；新 provider按 key/baseUrl/api/apiKey/model/summary；所有 draft 到 Save 才单次 conditional commit + refresh。

## Mandatory Commands

```bash
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor run typecheck
```

并留下真实 Pi TUI transcript（或环境阻塞时明确 handoff，不能以 mocks替代核心路径）。

## Feature DoD

- Root exact order/default：Add model / Add provider / Open full manager / Cancel。
- 每层 Esc 返回父级；root Esc/Cancel、final Cancel、Add another均零 commit；Save恰好一次 commit/refresh。
- Existing model conflict必须显式replace confirm；official ambiguity显式source选择。
- New provider必填验证、http/https、默认 api、首 model；changed/new command不触发 discovery。
- `/vendor web`与root Web action复用 runtime；non-TUI fail fast。
- 旧 provider/model完整编辑器不可达并删除孤儿代码。

## Stage Gates

- Review：独立 reviewer核验状态机、single-write、shared core、legacy removal。
- QA：scripted transitions + manual TUI root/quick paths/narrow terminal。
- Acceptance：transcript与自动测试覆盖所有 Save/Cancel/Esc/conflict/error路径。

## Evidence Required

- Command output
- Scripted transition tests
- Manual TUI transcript
- Single commit/refresh assertions
- Scope/cleanliness manifest

## Deliverables

- Quick-flow state machines/adapters/tests
- Updated command/root menu
- Removed obsolete TUI full editor
- Review/QA/acceptance/evidence/gates

## Cleanliness

TUI保持轻 adapter；不得复制 config/model-source语义，不加mouse，不保留不可达legacy。

## Failure Recovery

Pi UI API不支持approved step/取消语义，或真实TUI核心路径不可验证时 handoff。仅视觉微调不改变状态机可在本feature修复。
