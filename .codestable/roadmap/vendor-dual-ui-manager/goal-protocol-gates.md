# Goal Gate Policy

## 1. 通用 Gate Result

每个 gate 输出：

```json
{
  "gate_id": "gate-name",
  "stage": "stage.name",
  "status": "passed|failed|blocked|skipped",
  "blocking": [],
  "warnings": [],
  "evidence": [],
  "providers": {}
}
```

`failed` 是已完成但有 blocking；`blocked` 是缺输入/环境不可判断；`skipped` 只允许非核心并必须写理由。`protocol-only` 是由 review/QA/acceptance/audit 消费证据的规则，不是缺脚本。

## 2. feature_design.before_approve

已完成的前置 gate：

- design-review passed 且独立 reviewer 已记录。
- checklist YAML 可解析。
- Acceptance Coverage Matrix 与 DoD Contract 存在。
- Design `status: approved`。

任何 design 实质修改都必须 handoff 回 design/review，不得 goal 内静默改约。

## 3. implementation.before_review

必须从当前 `cs-onboard` skill 的 `tools/` 运行：

- `codestable-scope-gate.py`
- `codestable-dod-runner.py`
- `codestable-evidence-pack.py`

检查：

- checklist steps 全 `done`。
- 当前 feature delta 与 approved scope 一致；累计 diff 中前序 accepted 部分有 trust-prior 记录。
- 清洁度通过。
- checklist core commands 有执行证据。
- evidence pack 包含 Scope、DoD Results、Validation Commands、Scope And Cleanliness、Residual Risks。

脚本缺失表示 CodeStable 安装不完整，必须更新/修复，不能伪造 passed。

## 4. review.before_pass

必须运行 `review-evidence-gate`（若当前安装将其作为 protocol-only，则由正式 review 逐项证明）：

- Review 基于当前 feature delta 与累计 diff 上下文。
- `status: passed`。
- 独立 Task/Paseo reviewer；self/ocr 仅用户显式降级可用。
- 无 unresolved blocking。
- Review 明确消费 evidence pack/gate results，并解释 provider warnings。

失败返回 review-fix，再重跑独立 review。

## 5. qa.before_acceptance

必须运行 `qa-evidence-gate`（或由 QA 报告按 protocol-only 逐项证明）：

- QA `status: passed`。
- QA matrix 覆盖 design 场景、DoD、review focus、residual risks。
- 功能核心路径有实际运行证据；非功能 feature 有替代证据理由。
- 核心缺口不能降格为 residual risk。
- 高风险 feature 优先用独立 QA agent；主流程核验并落盘。

失败返回 qa-fix，并重跑 review 与 QA。

## 6. acceptance.before_done

必须运行 `acceptance-dod-gate`（或正式 acceptance 逐项证明）：

- Acceptance `status: passed`。
- checklist checks 全 `passed`。
- blocking DoD 有 pass evidence。
- Roadmap item 已回写。
- Residual risk 不含核心验收缺口。

实现缺口回 implementation，并重跑 review/QA/acceptance。

## 7. roadmap_audit.before_complete

必须运行：

- `python3 /Users/byte/.agents/skills/cs-onboard/tools/codestable-goal-consistency-gate.py --roadmap .codestable/roadmap/vendor-dual-ui-manager`
- goal-audit gate（若为 protocol-only，由 `goal-audit.md` 逐项证明）

检查：

- goal-state 全 features `accepted`；items 全 `done` 或有理由 `dropped`。
- 每个 feature 的 review/QA/acceptance/evidence/gate/DoD 产物存在并 passed。
- checklist steps 全 done、checks 全 passed。
- final aggregate commands 已重跑；核心命令不得 trust-prior 跳过。
- provider warnings 已解释。
- `goal-audit.md status: passed`。

## 8. Provider Policy

- archguard/meta-cc unavailable 记录 fallback，不自动阻塞基础流程。
- Provider warning 必须由 review/QA/audit 解释；未解释的核心风险可阻塞。
- meta-cc 首批只读取已有摘要或记录 unavailable。

## 9. Owner no-commit Gate Adaptation

用户明确禁止自动 commit/push/release：

- 标准“feature accepted 后 scoped-commit + clean tree”替换为“feature boundary manifest + scope/cleanliness evidence”。
- Gate 不要求 tracked product/spec diff 为空，但要求所有变化归属本 roadmap，且无临时/无关污染。
- Generated asset 可复现性在未提交工作树中使用临时 git index/独立快照比较；CI 在最终用户提交后仍运行真实 clean guard。
- 最终 audit 必须明确列出累计未提交文件并提醒用户自行 review/commit；不得因此伪造 clean 状态。
