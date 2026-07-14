# Goal Final Audit Protocol

## 1. 启动

所有 feature accepted 后打印：

```text
CS_ROADMAP_GOAL_AUDIT_START
Roadmap: vendor-dual-ui-manager
Features to verify: 7
Commands to re-run: <去重命令列表>
```

读取 roadmap/items/goal plan/state/specs，以及每个 feature 的 design/checklist/review/QA/acceptance/evidence/gates。

## 2. 机器一致性与状态

先运行：

```bash
python3 /Users/byte/.agents/skills/cs-onboard/tools/codestable-goal-consistency-gate.py --roadmap .codestable/roadmap/vendor-dual-ui-manager
```

失败不得打印完成；修复或回退状态后重跑。必须确认：

- 每个 roadmap item `done` 或有理由 `dropped`。
- 每个 acceptance/review/QA `status: passed`，无 unresolved blocking/failed。
- Checklist steps 全 done、checks 全 passed。
- Residual risk 不隐藏核心验收缺口。
- Provider unavailable 有 fallback，warning 已解释。
- 核心判断不含未获用户接受的 H-only evidence。
- Architecture/requirement/roadmap 回写已处理或明确不适用。

## 3. 最终聚合命令

按 goal-plan 去重重跑全部 final aggregate commands。功能核心命令不得因耗时跳过；核心环境不可用则 handoff。非核心外部能力可用静态/一致性/文档替代，但必须写理由。

## 4. Roadmap 核心路径

必须实际核验：

- TUI root 与 quick add model/provider 的 Save/Cancel/Esc/single-commit 流。
- `/vendor web` modal 的 state/save/cancel、Opaque SecretRef、first-terminal race 与 registry refresh。
- Web provider CRUD/Raw JSON/diff 与 model CRUD/catalog/discover/import。
- Real npm tarball 解包后从 packed layout 启动 runtime 并读取 asset/state/cancel。
- Cross-surface unknown/missing/secret/error/a11y/platform evidence。

功能性核心路径无法验证时 handoff，不能只写 residual risk。

## 5. 工作区与清洁度（Owner no-commit policy）

检查 tracked/staged/unstaged/untracked、调试输出、临时 TODO/FIXME/XXX、注释掉代码、同名工具 shim、临时 runner/download/`__pycache__`。

由于用户禁止自动 commit：

- 允许本 roadmap 的累计产品/spec/evidence diff 留在工作树。
- 不得声称 `git status` clean；报告中列出完整累计 changed files 与归属。
- 必须确认无无关变化、临时污染，且从 `baseline_ref` 起的全部 diff 已由最终 review/QA/audit 覆盖。
- Generated asset 的本地可复现检查使用临时 index/快照；真实 CI clean guard 作为用户后续提交后的验证项保留。

## 6. 审计报告

写 `.codestable/roadmap/vendor-dual-ui-manager/goal-audit.md`：

```markdown
---
doc_type: roadmap-goal-audit
roadmap: vendor-dual-ui-manager
status: passed|blocked
audited: YYYY-MM-DD
round: 1
---

# vendor-dual-ui-manager Goal 最终审计
## 1. Scope
## 2. Roadmap State
## 3. Final Aggregate Commands
## 4. Core Acceptance Paths
## 5. Deliverables And Writebacks
## 6. QA Residual Risk Review
## 7. Provider And E/C/H Evidence Summary
## 8. Workspace And Cleanliness
## 9. Verdict
```

第 7 节聚合 evidence packs、provider warnings、final commands、E/C/H summary 与 H-only core checks。

## 7. 完成与学习反思

无缺口时打印：

```text
CS_ROADMAP_GOAL_AUDIT_COMPLETE
CS_ROADMAP_GOAL_LEARNING_REVIEW
CS_ROADMAP_GOAL_COMPLETE
```

学习反思只筛选候选，不自动写 compound；需用户确认后再运行 `cs-keep`。最终提醒用户自行 review/commit 累计 diff，并可运行 `cs-docs-neat`；不得自动 commit/push/release。
