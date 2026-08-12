# CodeStable Roadmap Goal Protocol

本文件由 `/goal` 会话读取。详细执行规则在同目录的 feature-loop、gates 与 audit 文档。

## 1. 先读文件

- `.codestable/roadmap/vendor-dual-ui-manager/goal-state.yaml`
- `.codestable/roadmap/vendor-dual-ui-manager/goal-plan.md`
- `.codestable/roadmap/vendor-dual-ui-manager/vendor-dual-ui-manager-roadmap.md`
- `.codestable/roadmap/vendor-dual-ui-manager/vendor-dual-ui-manager-items.yaml`
- `.codestable/roadmap/vendor-dual-ui-manager/goal-features/*.md`
- `.codestable/roadmap/vendor-dual-ui-manager/goal-protocol-feature-loop.md`
- `.codestable/roadmap/vendor-dual-ui-manager/goal-protocol-gates.md`
- `.codestable/roadmap/vendor-dual-ui-manager/goal-protocol-audit.md`
- `.codestable/roadmap/vendor-dual-ui-manager/goal-repair-plan.md`（存在时为当前恢复权威，优先于旧 passed 报告）

## 2. 启动检查

- 所有 feature design frontmatter 必须是 `status: approved`。
- `goal-state.yaml.current_feature_index` 是 0-based。
- `baseline_ref` 必须能解析为 git SHA。
- goal plan 必须包含核心路径、聚合命令、DoD/Gate/Provider/Owner Policy。
- checklist `steps` 与 `checks` 初始均为 `pending`。

## 3. Goal 模式接管

用户已确认 roadmap 与全部 child design，授权连续执行 implementation / review / QA / acceptance。

仍必须 handoff：

- 需要改变 approved design、roadmap item、接口契约或 feature 范围。
- 独立 reviewer pending / failed / blocked 且无用户降级授权。
- 同一失败项三轮修复仍不通过。
- 外部凭证或环境缺失导致核心行为不可判断。
- 功能核心路径或 roadmap 核心验收路径无法验证。
- 用户要求暂停、改方向或终止。

## 4. Owner Policy：不自动提交

用户明确授权实现，但未授权自动 `git commit`、push 或发布；该约束覆盖默认 scoped-commit 规则。

- 禁止运行 `git commit`、`git push`、发布或版本变更。
- 每个 feature accepted 后，记录 feature-boundary scope manifest、命令证据和累计 diff 解释，再更新 state/items。
- 不要求工作树 clean；只允许本 roadmap 的产品/spec/evidence 变化，禁止无关文件、临时 runner、下载物和调试残留。
- 后续 feature 将前序 accepted diff 作为 trust-prior；若修改前序文件，必须解释新 delta。最终审计重新核验从 `baseline_ref` 起的全部累计 diff。

## 5. 启动标记

```text
CS_ROADMAP_GOAL_START
Roadmap: vendor-dual-ui-manager
Features: 7
Baseline ref: <sha>
Plan: .codestable/roadmap/vendor-dual-ui-manager/goal-plan.md
Protocol: .codestable/roadmap/vendor-dual-ui-manager/goal-protocol.md
```

## 6. 执行顺序

1. 按 `current_feature_index` 找下一个 pending feature。
2. 读取 `goal-features/<feature-slug>.md`、design、checklist 与当前代码。
3. 按 feature-loop 执行 implementation → review → QA → acceptance。
4. 每阶段按 gates 文档执行。
5. Feature accepted 后更新 state/items，写 boundary evidence；不得 commit。
6. 全部 accepted 后按 audit 文档完成最终审计。

## 7. 完成与 handoff

最终审计通过后，先写 `goal-state.yaml status: complete`，再打印：

```text
CS_ROADMAP_GOAL_COMPLETE
```

无法继续时，先写 `status: handoff`、`handoff_reason`、`handoff_next`，再打印：

```text
CS_ROADMAP_GOAL_HANDOFF
Reason: <具体阻塞>
Next: <建议动作>
```
