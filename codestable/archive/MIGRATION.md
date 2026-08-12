# CodeStable 迁移记录

## 2026-08-12 workspace-root migration

当前工作区按最新版 CS Skill 契约从 `.cs/` 整体迁移到 `codestable/`。现有实体和冻结 archive 均原样保留，现行引用统一更新为 `codestable/...`；`codestable/archive/codestable-legacy/` 内部记录旧系统的 `.codestable/...` 原始引用，不做历史改写。仓库不保留 `.cs` 兼容目录或 symlink。

## 2026-08-01 entity-format migration

当时位于 `.cs/` 的现行实体改为扁平编号格式；这些实体当前位于：

- issues：`codestable/issues/<NNN>-o|x-<slug>.md`
- epics：`codestable/epics/<NNN>-o|x-<slug>/spec.md`
- talks / notes：`codestable/talks/<NNN>-<slug>.md`、`codestable/notes/<NNN>-<slug>.md`
- foundation：`codestable/vision/index.md`

`codestable/archive/codestable-legacy/` 是迁移前系统的冻结历史证据，不作为当前 CS 实体；本阶段未修改冻结 archive，只更新了现行实体之间的交叉引用。

## 2026-07-14 legacy-system onboarding

接入当时的新 CodeStable：旧 `.codestable/` 整包迁入当时的 `.cs/archive/codestable-legacy/`，并抽取**仍然成立**的真相到当时的 `.cs/` 实体树。

- **旧系统原根**：`.codestable/`
- **当前 archive 落点**：`codestable/archive/codestable-legacy/`
- **当前实体根**：`codestable/`（2026-08-12 从 `.cs/` 迁入）

## 映射原则

| 旧实体 | 新落点 | 策略 |
|---|---|---|
| `reference/*`（技能体系说明） | 不迁入 project spec | 描述旧技能家族，不是本 monorepo 产品真相 |
| `attention.md` | 未复制（空壳） | 启动规则进 memory / 未来 AGENTS；坑点进 notes |
| `brainstorms/vendor-dual-ui-manager` | `codestable/talks/001-vendor-dual-ui-manager.md` | 讨论收束 |
| `roadmap/vendor-dual-ui-manager` | `codestable/epics/001-x-vendor-dual-ui-manager/spec.md` | 已关闭 epic；goal-state/protocol 留 archive |
| `features/2026-07-12-vendor-*` | `codestable/issues/012-x-vendor-config-core.md` 至 `codestable/issues/018-x-vendor-web-provider-workflows.md` | 关闭结论；design/review/qa 原文留 archive |
| `issues/2026-07-11-*` | `codestable/issues/001-x-atomic-config-write.md` 至 `codestable/issues/011-x-web-search-budgets.md` | 关闭 bug issue |
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

- dual-UI roadmap：`codestable/archive/codestable-legacy/roadmap/vendor-dual-ui-manager/`
- feature 证据：`codestable/archive/codestable-legacy/features/`
- web-search audits：`codestable/archive/codestable-legacy/audits/`
