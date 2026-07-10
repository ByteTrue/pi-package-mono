---
doc_type: refactor-apply-notes
refactor: 2026-07-11-vendor-command-split
---

# vendor-command-split apply notes

## 步骤 1: Extract model-list pure helpers + unit tests
- 完成时间: 2026-07-11
- 改动文件: `model-list.ts`, `model-list.test.ts`, `command.ts`（import）
- 验证结果: `npm --workspace @bytetrue/pi-vendor test` 44 passed；typecheck 通过
- 偏离: 无

## 步骤 2: Extract vendor-ui wrappers
- 完成时间: 2026-07-11
- 改动文件: `vendor-ui.ts`, `command.ts`
- 验证结果: test 44 + typecheck 通过
- 偏离: 无

## 步骤 3: Extract models-menu.ts
- 完成时间: 2026-07-11（代码已落地）
- 改动文件: `models-menu.ts`（~277 行）, `provider-menu`/`command` 调用链
- 验证结果: AI — typecheck + test 通过；**HUMAN 待确认**
- HUMAN 清单:
  - [ ] Manage models → Add model（搜索 / custom id）
  - [ ] Import from /models（若有 baseUrl+key）
  - [ ] Replace/edit model JSON
  - [ ] Remove model
  - [ ] Back
- 偏离: 步骤 3 与 4 代码同批落地（拆文件依赖），HUMAN 验证合并一次也可

## 步骤 4: Extract provider-menu.ts; thin command.ts
- 完成时间: 2026-07-11（代码已落地）
- 改动文件: `provider-menu.ts`（~146 行）, `command.ts`（~92 行）
- 验证结果: AI — typecheck + test 通过；**HUMAN 待确认**
- HUMAN 清单:
  - [ ] 选已有 provider / Add provider
  - [ ] Edit key/name/baseUrl/apiKey
  - [ ] Save
  - [ ] Cancel
  - [ ] Rename confirm（改 key 时）
- 偏离: 同步骤 3

## 行数对照
| 文件 | 约行数 |
|---|---|
| command.ts | 92（原 595） |
| models-menu.ts | 277 |
| provider-menu.ts | 146 |
| vendor-ui.ts | ~70 |
| model-list.ts | ~35 |

## HUMAN 验证
- 时间: 2026-07-11
- 用户确认语录: 「继续」（步骤 3+4 合并放行）
- 结果: 通过，进入 code-review / commit
