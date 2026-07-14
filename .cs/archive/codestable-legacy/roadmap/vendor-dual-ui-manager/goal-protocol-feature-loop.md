# Goal Feature Loop

## 1. 进入 Feature

读取 goal-feature spec、approved design、checklist、roadmap item 与当前代码；打印：

```text
CS_ROADMAP_GOAL_FEATURE_START
Feature: <N>/7 <feature-slug>
Design: <路径>
Checklist: <路径>
Depends on: <依赖|none>
Mandatory commands: <命令列表>
Evidence required: <证据列表>
```

将当前 feature 状态改为 `implementing`，并记录 feature-start scope manifest：当前 `git status --porcelain=v1 -uall`、`git diff --name-only baseline_ref` 与已 accepted feature 列表。

## 2. Implementation

必须加载并进入 `cs-feat` implementation 阶段；不能加载时 handoff。写代码前打印：

```text
CS_STAGE_START feature=<feature-slug> stage=implementation skill=cs-feat
```

- 做基线预检。
- 按 checklist steps 顺序实现；完成后只把该 step 从 `pending` 改为 `done`。
- 不修改 checks；checks 仅 acceptance 更新。
- 每步留下命令、API、浏览器、TUI、diff 或手工证据。
- 每步执行清洁度检查。
- 只实现 approved design；改变契约/范围必须 handoff。

结束后运行 `implementation.before_review` gates。

## 3. Code Review

按 `cs-code-review` 只读审查，写 `<feature-slug>-review.md`：

- 读取 design/checklist/evidence/gate results/累计 diff。
- 使用 feature-start manifest 区分本 feature 新 delta 与前序 accepted trust-prior。
- 必须由独立 Task/Paseo reviewer 给出结论，主流程核验后落盘。
- 解释 gate/provider warnings，给出 QA focus。

有 blocking 时打印 `CS_ROADMAP_GOAL_REVIEW_FIX`；修复后重跑独立 review。

## 4. QA

按 `cs-feat` QA 阶段只读验证并写 `<feature-slug>-qa.md`：

- 覆盖 design 核心场景、DoD commands、review QA focus、residual risks。
- 功能路径必须有真实运行证据；无法验证核心路径则 handoff。
- QA 不直接修改代码。

QA failed/blocked 时打印 `CS_ROADMAP_GOAL_QA_FIX`；修复后重跑 review 和 QA。

## 5. Acceptance

按 `cs-feat` acceptance 阶段：

- Review/QA 必须 passed，无 unresolved blocking/failed。
- 复核 evidence pack、DoD/Gate Results。
- 写 `<feature-slug>-acceptance.md`。
- checklist checks 从 `pending` 改为 `passed`。
- 回写 roadmap item 和必要 reference/architecture/requirement，或记录不适用。

## 6. Feature Boundary（Owner no-commit policy）

打印 `CS_ROADMAP_GOAL_FEATURE_VERIFY`，列出 implementation/review/QA/acceptance/commands/deliverables/cleanliness/item。

全部通过后：

- 写 feature-end scope manifest 与 feature-specific delta 解释。
- 确认没有无关文件、临时 runner、下载物、调试输出、临时 TODO/FIXME/XXX、注释掉代码或同名工具 shim。
- 当前 feature state 改为 `accepted`，roadmap item 改为 `done`，`current_feature_index` 加 1。
- **不得 commit、push 或发布；不要求工作树 clean。**
- 打印 `CS_ROADMAP_GOAL_FEATURE_DONE`。

前序 accepted changes 是后续 trust-prior，但最终审计必须重新核验从 baseline 起的累计 diff。
