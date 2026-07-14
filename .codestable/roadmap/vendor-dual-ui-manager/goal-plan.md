---
doc_type: roadmap-goal-plan
roadmap: vendor-dual-ui-manager
status: ready-to-dispatch
created: 2026-07-13
baseline_ref: 3f6c641c25943511e5dbca3f3dbf4545a606cea0
---

# vendor-dual-ui-manager Goal 执行计划

## 1. Inputs

- Roadmap: `.codestable/roadmap/vendor-dual-ui-manager/vendor-dual-ui-manager-roadmap.md`
- Items: `.codestable/roadmap/vendor-dual-ui-manager/vendor-dual-ui-manager-items.yaml`
- Roadmap review: `.codestable/roadmap/vendor-dual-ui-manager/vendor-dual-ui-manager-roadmap-review.md`
- Approved feature designs/checklists/reviews: `.codestable/features/2026-07-12-vendor-*/`
- Active repair authority: `.codestable/roadmap/vendor-dual-ui-manager/goal-repair-plan.md`（false-complete 后恢复时必须先读）

## 2. Feature Order

1. `vendor-config-core` — mixed：共享 mutation、Pi oracle、revision 与 atomic commit。
2. `vendor-web-modal-runtime` — functional：一次性 loopback server、Opaque SecretRef、minimal browser save/cancel。
3. `vendor-model-source-core` — functional：closed catalog/enrichment DTO、bounded discovery、trusted command resolver。
4. `vendor-tui-quick-workflows` — functional：任务导向 `/vendor` root 与两条 quick flows。
5. `vendor-web-provider-workflows` — functional：provider CRUD、field visibility、Raw JSON、sanitized preview。
6. `vendor-web-model-workflows` — functional：model CRUD、catalog/custom/discover bulk import。
7. `vendor-dual-ui-hardening` — non-functional：aggregate evidence、tarball/CI、cross-surface QA、docs。

严格按顺序执行；approved design/interface 发生实质变化必须 handoff，不得 goal 内静默改约。

## 3. Roadmap Core Acceptance Paths

必须真实运行并留证：

- `/vendor` root 的默认顺序，以及 quick add model/provider 的 Esc/Cancel/Add another/Save single-commit 行为。
- `/vendor web` 从 Pi 启动一次性 browser modal；state/save/cancel/Esc/shutdown、first-terminal-action-wins 与 refresh。
- Opaque keep-value：known literal API key/provider-model-modelOverride headers 不进入 browser；moved/copied/forged/cross-revision refs fail closed。
- Web provider create/rename/delete、common/optional fields、Raw JSON single store、Before/After 与 409 恢复。
- Web model add/edit/delete、official ambiguity、custom/default warning、`/models` import、100 cap/concurrency8/partial recovery。
- `models.json` unknown/missing fields、strict JSON limitation、revision conflict、atomic `0o600`。
- Real npm tarball 解包后从 packed layout 启动 runtime并读取 asset/state/cancel。
- Keyboard/focus/narrow terminal/browser/platform opener 与 10k result measure-first evidence。

## 4. Assumptions

- Node 22 是 CI 最低运行环境；当前工作树基线 SHA 如 frontmatter。
- Pi `>=0.79.10` 提供 `ModelRegistry.create/refresh/getError` 与 `AuthStorage.inMemory`。
- Web 只监听 `127.0.0.1:0`，同次 session 单 token；browser 本身不被视为 secret storage。
- Browser close 不能可靠通知 server，Pi Esc 是明确回收路径。
- Revision 是 optimistic check，不是跨进程锁。
- Strict JSON 不支持 Pi comment-tolerant loader 的注释输入；必须测试并文档化，不在本 goal 扩 parser。

## 5. Top 3 Risks And Mitigation

1. **Secret/config loss**：Opaque exact-path hydration、Pi oracle、revision、atomic 0o600、recursive leak scans、adversarial ref tests。
2. **TUI/Web semantic drift**：共享 pure mutations/descriptors/model-source；state-machine contract tests；最终 cross-surface fixture equality。
3. **Local server/network/build lifecycle**：loopback/token/Origin/Host/CSP/body budgets、first-terminal races、active connection cleanup、generated snapshot + real tarball smoke。

## 6. Mandatory Command Set

Feature commands按各 goal-feature spec 执行。去重核心集合：

```bash
npm --workspace @bytetrue/pi-vendor run build:web
npm --workspace @bytetrue/pi-vendor run typecheck
npm --workspace @bytetrue/pi-vendor test
npm run typecheck --workspaces --if-present
npm test
node packages/pi-vendor/scripts/pack-smoke.mjs
```

最低 Pi peer fixture、browser/TUI manual transcript、HTTP integration 与 screenshots 按对应 checklist 补充。

## 7. Final Aggregate Commands

Roadmap 完成前必须重跑：

```bash
npm --workspace @bytetrue/pi-vendor run build:web
npm --workspace @bytetrue/pi-vendor run typecheck
npm --workspace @bytetrue/pi-vendor test
npm run typecheck --workspaces --if-present
npm test
node packages/pi-vendor/scripts/pack-smoke.mjs
python3 /Users/byte/.agents/skills/cs-onboard/tools/codestable-goal-consistency-gate.py --roadmap .codestable/roadmap/vendor-dual-ui-manager
```

另外运行 generated asset reproducibility check。由于 owner 禁止自动 commit，本地使用临时 git index/独立快照比较；最终提交后的 CI 仍运行真实 clean guard。

## 8. Preflight Strategy

- 每个 feature 开始读取 goal state/spec/design/checklist 与当前相关代码，运行其基线 core commands。
- 记录 feature-start/end scope manifest，区分前序 accepted trust-prior 与当前 delta。
- 任何 core baseline failure 先诊断；与本 feature 无关且阻塞判断时 handoff，不隐瞒。
- 外部测试工具缺失时，只能补设计已要求的测试依赖、lockfile 或既有 runner 配置；禁止同名 shim/伪造结果。
- Goal state/status 回退或 `goal-repair-plan.md` 存在时，先完成所有 reopened dependency repairs，再恢复原 feature 顺序；旧 passed 报告不可覆盖新 blocking evidence。

## 9. DoD Policy

- Checklist steps 全 done；checks 仅 acceptance 改 passed。
- 每个 feature 有 independent review、QA、acceptance、evidence pack、gate results。
- Core commands 与功能核心路径必须有实际证据。
- 清洁度：无 debug output、临时 TODO/FIXME/XXX、注释代码、unused imports、临时 runner/download/shim。
- Roadmap item/state/writeback 同步；residual risk 不得隐藏核心缺口。

## 10. Gate Policy

运行时权威：`.codestable/roadmap/vendor-dual-ui-manager/goal-protocol-gates.md`。

- implementation：scope-gate + dod-runner + evidence-pack。
- review：独立 reviewer + evidence gate；blocking 必须 review-fix 后重跑。
- QA：功能路径实证；failed/blocked 必须 qa-fix 后重跑 review/QA。
- acceptance：DoD/checks/items/writebacks 全部通过。
- audit：goal consistency + aggregate commands + core paths + workspace scope。

## 11. Provider Policy

- archguard/meta-cc unavailable 记录 fallback，不自动阻塞。
- Provider warning 必须由 review/QA/audit 解释；未解释的核心风险阻塞。
- meta-cc 首批只读已有摘要或记录 unavailable。
- Reviewer/QA agent 只读，结果由唯一主 writer 核验落盘并关闭。

## 12. Owner Policy

用户明确授权实现，但不授权自动 `git commit`、push、release/version bump。

- Goal driver 禁止 commit/push/publish。
- 标准 scoped-commit gate 改为 feature boundary scope manifest；工作树允许累计 roadmap-owned diff。
- 最终审计列出全部未提交变化并提醒用户自行 review/commit，不宣称 clean。

## 13. Failure Recovery

- Approved contract/scope 必须变化：handoff 给用户，回 design/review。
- 同一 gate 三轮仍失败：handoff，保留 state/index/evidence。
- 核心凭证/浏览器/环境导致无法判断：handoff，不降格为 residual risk。
- 非核心 provider unavailable：记录 fallback 并继续。

## 14. Final Audit Deliverables

- 每个 feature 的 review、QA、acceptance、evidence pack、gate results、boundary manifests。
- `goal-audit.md`：状态、聚合命令、核心路径、writebacks、residual risks、provider/E-C-H、workspace scope、verdict。
- Goal evidence summary（可内嵌 audit）。
- Goal consistency gate output。
- Learning candidates；不自动写 compound。
