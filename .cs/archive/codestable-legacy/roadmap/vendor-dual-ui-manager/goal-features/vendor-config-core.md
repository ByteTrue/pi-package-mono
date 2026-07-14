# Goal Feature: vendor-config-core

- Roadmap item: `vendor-config-core`
- Depends on: none
- Nature: mixed
- Design: `.codestable/features/2026-07-12-vendor-config-core/vendor-config-core-design.md`
- Checklist: `.codestable/features/2026-07-12-vendor-config-core/vendor-config-core-checklist.yaml`
- Design review: `.codestable/features/2026-07-12-vendor-config-core/vendor-config-core-design-review.md`
- Code review: `.codestable/features/2026-07-12-vendor-config-core/vendor-config-core-review.md`
- QA: `.codestable/features/2026-07-12-vendor-config-core/vendor-config-core-qa.md`
- Acceptance: `.codestable/features/2026-07-12-vendor-config-core/vendor-config-core-acceptance.md`

## Deliverable

共享 config core：typed provider/model mutations、字段 descriptors、raw-byte revision、Pi public oracle、conditional atomic commit，并保持 unknown/missing 字段语义。

## Core Runtime Path

在临时 `models.json` 上执行 read → local validate → Pi oracle → revision recheck → atomic 0o600 write；覆盖 stale/invalid/unavailable/failure。TUI/Web 后续只消费该 public contract。

## Mandatory Commands

```bash
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor run typecheck
npm run typecheck --workspaces --if-present && npm test
```

最低 Pi `0.79.10` fixture 必须实际运行 oracle characterization，不只 typecheck。

## Feature DoD

- Checklist steps 全 done；blocking checks 有 evidence。
- MutationResult/ConfigCoreError、ordering、duplicate/unknown/missing/revision/temp cleanup 全有 tests。
- Coding-agent peer 更新为 `>=0.79.10`，pi-tui 不无故抬下限。
- Public exports 清晰；legacy UI migration 明确留给 TUI child。
- 无 repository/service 空壳或 scope creep。

## Stage Gates

- Implementation：scope/dod/evidence gates。
- Review：独立 reviewer；重点核验 error contract、oracle seam、atomic temp、ordering、field typing。
- QA：真实临时文件权限/cleanup/stale/oracle；最低 peer fixture。
- Acceptance：checks passed，item/writeback 更新。

## Evidence Required

- Command output
- Mutation/oracle/filesystem contract tests
- Unknown root/provider/model characterization
- Atomic 0o600 and cleanup evidence
- Diff/scope/cleanliness manifest

## Deliverables

- Config core source/public exports/tests
- Updated peer contract
- Review/QA/acceptance/evidence/gate reports

## Cleanliness

无 debug、临时 TODO、注释代码、unused imports、同名 shim；只触碰 approved config-core 范围。

## Failure Recovery

需要改变 roadmap §4.1/§4.2 或 legacy migration 边界时 handoff。Core test/peer/oracle 无法判断时不得继续到下 feature。
