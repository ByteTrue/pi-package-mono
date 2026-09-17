---
doc_type: approval-report
unit: vendor-dual-ui-manager
status: approved
reason: route-choice
created_at: 2026-07-12
---

# Approval Report

## Decision History

- 2026-07-12：owner 选择 Option A，现在进入 `cs-epic` planning。

## Decision Needed

是否现在把已收敛的双界面方向转入 `cs-epic` planning，拆分共享领域层、TUI 快捷流和 Web 完整管理器，并定义三者接口与实施顺序？

## Why Now

讨论已经确认产品形态、Web 生命周期和字段呈现策略，剩余问题主要是多 feature 的边界、依赖与接口契约；继续在 brainstorm 中逐项设计会开始侵入 epic planning 的职责。

## Context

已确认：

- TUI 承担简单高频流程，Web 承担完整管理能力。
- Web 是预构建静态前端加轻量本地 server。
- Web 采用一次性浏览器 modal，Save/Cancel 后关闭 server。
- 常用字段始终显示，可选字段按已有配置显示并可通过 `Add setting…` 添加，同时保留 Raw JSON。

完整讨论记录见 `.codestable/brainstorms/vendor-dual-ui-manager/brainstorm.md`。

## Options

### A. 现在进入 `cs-epic` planning（推荐）

把整体能力拆成可独立验收的子 feature，明确共享逻辑、TUI 与 Web API 的依赖顺序，并产出 roadmap 与机器可读 items。

### B. 先停在 brainstorm

保留当前记录，不创建 roadmap；后续准备开工时再恢复并进入 `cs-epic`。

## Recommendation

选择 A。当前范围已经明显超过单 feature，但方向已足够稳定；此时做 roadmap 能避免直接实现时让 TUI 和 Web 各自演化出重复逻辑。

## Risks And Tradeoffs

- 选择 A 会增加一次正式规划步骤，但能提前锁定共享边界、最小闭环和分批交付顺序。
- 选择 B 没有即时成本，但下一次实现前仍需完成同一拆解，且口头上下文更容易被误当作单个 feature。

## Non-Automatic Actions

无论选择哪项，都不会自动实现代码、安装依赖、提交、推送或发布包。

## After You Answer

- 选择 A：在当前 run 加载 `cs-epic` planning，并把 brainstorm 路径作为输入。
- 选择 B：停止在已保存的 brainstorm，等待后续指令。
