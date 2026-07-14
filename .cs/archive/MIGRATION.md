# CodeStable 迁移：`.codestable` → `.cs`

- **日期**：2026-07-14  
- **动作**：接入新 CodeStable；旧目录整包迁入 archive，并抽取**仍然成立**的真相到新实体。  
- **旧根**：`.cs/archive/codestable-legacy/`（原 `.codestable/`）  
- **新根**：`.cs/`

## 映射原则

| 旧实体 | 新落点 | 策略 |
|---|---|---|
| `reference/*`（技能体系说明） | 不迁入 project spec | 描述旧技能家族，不是本 monorepo 产品真相 |
| `attention.md` | 未复制（空壳） | 启动规则进 memory / 未来 AGENTS；坑点进 notes |
| `brainstorms/vendor-dual-ui-manager` | `.cs/talks/2026-07-12-vendor-dual-ui-manager.md` | 讨论收束 |
| `roadmap/vendor-dual-ui-manager` | `.cs/epics/2026/07/12/vendor-dual-ui-manager/spec.md` | 已关闭 epic；goal-state/protocol 留 archive |
| `features/2026-07-12-vendor-*` | `.cs/issues/2026/07/12/closed-vendor-*.md` | 关闭结论；design/review/qa 原文留 archive |
| `issues/2026-07-11-*` | `.cs/issues/2026/07/11/closed-*.md` | 关闭 bug issue |
| `audits/*` | archive only | 证据；结论已进 bug issue / package 行为 |
| `refactors/*` | archive + notes 指针 | 执行史；proxy 结论已在 web-search spec |
| `tools/*`、`gates/*`、`hooks/*` | archive only | 旧 harness，非新 cs 实体 |
| `goals/`、`requirements/`、`compound/` 空目录 | 丢弃为空目录语义 | 无内容不迁 |

## 毕业到 project spec 的内容

- monorepo 是什么、两包职责、npm workspaces 约定  
- web-search：默认 exa-free、三态配置、proxy 隔离、SSRF/预算  
- vendor：双 UI、三子系统、SecretRef、revision、边界  

## 未毕业（有意留下）

- goal driver 协议、gate JSON、false-complete 流水  
- 逐 finding 审计原文与旧 code-review 长文  
- 未实现的 UX polish 清单（见 epic 关闭结论）  

## 旧路径快速索引

- dual-UI roadmap：`archive/codestable-legacy/roadmap/vendor-dual-ui-manager/`  
- feature 证据：`archive/codestable-legacy/features/`  
- web-search audits：`archive/codestable-legacy/audits/`  
