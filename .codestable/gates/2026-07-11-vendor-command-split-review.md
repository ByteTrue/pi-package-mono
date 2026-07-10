---
doc_type: code-review
slug: 2026-07-11-vendor-command-split
status: passed
reviewer: self
source: .codestable/refactors/2026-07-11-vendor-command-split/
---

# vendor-command-split review

## 范围
packages/pi-vendor 拆分 command.ts + model-list 测试 + codestable refactor 产物

## 行为等价
- registerVendorCommand 保存/确认/rename/overwrite 逻辑保留在 command.ts
- 菜单文案常量随文件搬移未改写
- public export 仍经 command/index

## 正确性
- typecheck 通过；vendor tests 44 passed（含 model-list 6）
- 依赖方向：command → provider-menu → models-menu → model-list/vendor-ui；无环

## 问题
- Critical/Important: 无
- Note: TUI 无自动化 e2e；HUMAN 由用户「继续」放行

## 结论
**passed** — 可提交。
