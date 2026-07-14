---
doc_type: approval-report
unit: vendor-dual-ui-manager
status: approved
reason: review-authorization
created_at: 2026-07-12
---

# Approval Report

## Decision History

- 2026-07-12：owner 选择 Option B（Opaque keep-value）。已有 Pi known literal API key/header 默认不进入浏览器；child design 将 header paths 明确覆盖 provider、model 与 modelOverride，未改变 owner 的安全选择。
- 2026-07-12：owner 选择 Option A，确认 roadmap 并进入连续 ChildDesignBatch；只做 feature design + 独立 design review，不实现代码。
- 2026-07-12 ChildDesignReview 纠正两项实现前契约：Model source 直接依赖 Web runtime（routes/SecretRef hydration），closed DTO补当前 Pi安全已知cost/compat字段；不改变owner确认的产品范围。
- 2026-07-12：7 个 child design/checklist 均完成独立 review（全部 blocking 0 / important 0），进入统一 design owner checkpoint。
- 2026-07-13：owner 选择 Option A，统一批准 7 份 child design，并授权进入 goal-package / 后续可见 goal driver 实现；仍不授权自动 commit、push 或发布。

## Decision Needed

是否统一确认 7 份 child feature design，并允许 `cs-epic` 进入 goal-package / 后续实现 driver？

## Why Now

`codestable-workflow-next.py epic` 已返回 `user_gate: all-feature-designs-confirmation`：7 份 design 均为 `draft`、7 份 design-review 均为 `passed`，checklist 与 items YAML 全部校验通过。按 epic 协议，只有此时才能统一确认；在确认前不得实现产品代码。

## Design Batch Summary

1. **vendor-config-core**
   - Environment-free mutation + snapshot/oracle/revision/atomic commit 两块。
   - Stable `MutationResult` / `ConfigCoreError`；Pi public oracle；unknown/missing round-trip；peer `>=0.79.10`。
2. **vendor-web-modal-runtime**
   - One-shot `127.0.0.1:0` server、token/Origin/Host/CSP、first-terminal-action-wins。
   - Opaque keep-value 覆盖 provider API key 与 provider/model/modelOverride headers；exact-path hydration，不 Reveal/remap。
   - Minimal UI 只编辑现有 provider `baseUrl` + Save/Cancel。
3. **vendor-model-source-core**
   - Closed DTO 保留 current-safe `cost.tiers` / compat fidelity，但排除 routing/credential/unknown。
   - All-command trust preflight、exact Pi template parser、15s overall budget、2MiB stream、real runner tests。
   - 直接依赖 Web runtime 的 non-consuming credential hydration routes。
4. **vendor-tui-quick-workflows**
   - Root exact order：Add model / Add provider / Open Web / Cancel。
   - 两条任务状态机；Esc/Cancel/Add another 零 commit，Save 恰好一次 commit/refresh。
   - 旧完整 TUI editor 删除，低频操作转 Web。
5. **vendor-web-provider-workflows**
   - Single draft provider CRUD、common/optional field strategy、Raw JSON、sanitized Before/After。
   - Rename 遇 opaque refs 必须先重输/删除；delete/overwrite/clear 显示 secret removal counts。
6. **vendor-web-model-workflows**
   - Structured model table/editor、official/custom/discover bulk import。
   - Visual sort 不改 document；array shift SecretRef preflight；bulk 每批最多100、concurrency8、partial recovery。
7. **vendor-dual-ui-hardening**
   - Evidence-first，不加功能。
   - Generated asset clean guard、真实 npm tarball 解包 runtime smoke、CI/peer、cross-surface QA、a11y/platform/docs。

完整目录：`.codestable/features/2026-07-12-vendor-*/`；每个目录均有 design、checklist、passed design-review。

## Confirmed Cross-Cutting Contracts

- Whole-document draft + revision conditional commit；不是跨进程锁。
- Collision 默认 reject，只有显式 destructive confirm 后 overwrite。
- Browser 不接收解析后的 env/command output/credential；unknown custom secret 不在 masker 承诺内。
- Existing known SecretRef 移动一律 fail closed；UI 只能撤销移动或重输/删除，不能 remap。
- Browser tab close 不可靠终止 server；Pi Esc 是明确回收路径。
- Config core 使用 strict JSON；Pi comment support 是已知既有限制，hardening 必须测试并诚实文档化。
- No runtime Web framework、no daemon、no mouse、no autosave、no automatic conflict merge。

## Options

### A. 统一确认全部 design，继续 goal-package / 后续实现（推荐）

父流程将逐份把 design 标记 `approved`，随后进入 `cs-epic --stage goal-package`。Goal package 会冻结实现顺序、验收和预算；按 epic 状态机，准备完成后可派发可见 goal driver 修改产品代码并持续验证。不会自动 commit、push 或发布。

### B. 要求修改 design

指出要改的 child/接口/交互。相关 design 回到 `draft` 修订并重跑独立 design review；其他 passed design 保留。

### C. 保持全部 design 为 draft，暂不继续

不进入 goal-package，不修改产品代码；以后从仓库状态恢复到本 checkpoint。

## Recommendation

选择 A。所有 core/security/UX seam 已通过多轮独立 review；剩余风险都已明确落到 hardening evidence，不需要继续在 design 阶段扩张方案。

## Risks And Tradeoffs

- A 之后进入真正实现阶段，代码量和验证周期较大；但 goal package 会按依赖先 core/minimal loop，再 TUI/Web full flows，最后 hardening。
- Opaque exact-path 策略安全优先，会让 provider rename 或 model array shift 在存在 literal header secret 时要求重输/删除。
- Vanilla Web 避免 framework dependency，但 10k list 性能采用 measure-first；只有 hardening evidence 失败才引入虚拟化。
- Strict JSON 不等同 Pi 的 comment-tolerant loader；这是明确限制，不在本 epic 隐式扩 scope。

## Non-Automatic Actions

无论选择哪项，本 checkpoint 本身不 commit、merge、push、发布、安装全局依赖或修改用户 `models.json`。选择 A 才授权后续 goal-package / implementation driver 修改仓库产品代码；外部发布动作仍需单独授权。

## After You Answer

- A：标记 7 份 design `approved`，校验状态并继续 goal-package。
- B：修订指定 design，重跑对应独立 review，再回此统一 checkpoint。
- C：保持当前 `draft + passed-review`，停止。
