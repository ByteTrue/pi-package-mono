---
kind: epic
title: pi-vendor Web 产品化升级
status: closed
created: 2026-07-14
---

# pi-vendor Web 产品化升级

## 这个 Epic 要改变什么

在已关闭的 dual-UI 骨架之上，把 **Web 管理器**做成日常可用、视觉完整的产品面：

- 关键加/改模型能力对齐（并在编辑器内可达）TUI 的 catalog/enrich 路径
- 主任务路径清晰（加模型、编辑、导入、保存）
- 对整个 Web surface 重做信息架构、视觉层级、组件状态与响应式体验；让高密度配置操作保持安静、可扫、可恢复

不推翻 config core / SecretRef / revision 安全模型，也不引入运行时 UI 框架或远程资产。

## 为什么现在做

dual-UI 已关但 owner 判断成品不可日常使用；能力缺口（如 id→官方模板）与交互简陋叠加，问题面过大，需要一条有边界的活规格分批推进。

## 关联 Project Spec

- `.cs/spec/pi-vendor/index.md`：Web 能力与边界；本 epic 将扩展「Web 日常可用」的完成度描述
- `.cs/spec/index.md`：当前方向
- 讨论：`.cs/talks/2026-07-14-vendor-web-productization.md`
- 前序（已关闭）：`.cs/epics/2026/07/12/vendor-dual-ui-manager/spec.md`

## 当前方案

1. **能力优先**：已完成「按 id 官方填充」；下一步对齐 Add model 三源路径与表单字段。
2. **全表面视觉重设计**：以克制的深色高密度本地工具为方向，统一 provider、models、catalog/import、Raw JSON、Preview、dialog 与所有状态的层级、组件和响应式行为。
3. **路径/文案在新骨架收口**：单一主保存栏、密钥人话、dialog 生命周期与任务反馈。
4. 不做主题切换、营销式视觉、运行时 UI 框架或远程字体/CDN。
5. **填充策略（已确认，已实现）**：
   - 新增：默认用 catalog/enrich 结果整表填入模板字段
   - 编辑：用户主动「从官方填充」→ 二次确认后覆盖模板字段
   - **不覆盖** headers 及用户密钥类字段
6. **catalog 运行时来源**：始终使用 active Pi 安装的 catalog；`dev:web` 必须模拟当前 PATH 的 Pi，不能让 workspace peer fixture 决定结果。

## 需求变化

相对当前 project spec / 已交付 dual-UI：

- Web 加/改模型必须能完成 TUI 级「搜 id / 官方模板」而不只靠旁路 catalog 块或手填
- Web 由原型式黑底表单升级为完整、可日常使用的本地配置工具；验收看任务完成、信息可扫与错误可恢复，而不是「有 API」
- 重设计覆盖 provider 侧栏与详情、模型列表/编辑器、catalog/import、Raw JSON、Preview、确认/错误/空/加载态，以及窄屏响应式

## 架构考量

- 复用已有 `/api/catalog`、`/api/enrich` 与 model-source core，优先接线不重造
- 安全边界默认不动；若编辑器填充触及 SecretRef 路径，fail closed 与 exact-path 规则不变
- 双 UI 单语义：填充结果仍是 draft 内 `ProviderModelConfig`，经既有 Save/revision 提交
- 视觉基座用本地 CSS tokens 与语义组件状态；不以卡片堆砌、渐变或装饰性 motion 遮蔽配置任务
- 深色是当前本地、专注配置场景的明确选择；不在本 epic 建主题系统

## 统一语言

- **官方填充**：catalog 选择或 enrich 将官方字段写入编辑器 draft
- **模板字段**：id/name/api/reasoning/context/maxTokens/input/compat/thinkingLevelMap 等非密钥配置
- **用户密钥字段**：headers 及 opaque secret 路径，填充时不覆盖

## 当前推进

该 Epic 已关闭；稳定结论已毕业到 `.cs/spec/pi-vendor/index.md` 的「Web 完整管理」与「Web 产品化已关闭」。

### Issues

- [x] `.cs/issues/2026/07/14/closed-web-model-editor-official-fill.md`：编辑器 id→官方填充（含 active-Pi catalog 回归修复）
- [x] `.cs/issues/2026/07/15/closed-web-visual-redesign.md`：全表面视觉重设计（owner 验收）
- [x] `.cs/issues/2026/07/14/closed-web-model-form-fields.md`：模型表单全字段（与视觉重设计一并验收）
- [x] `.cs/issues/2026/07/14/closed-web-add-model-main-path.md`：Add model 主路径 + discover + import dialog（owner 验收）
- [x] `.cs/issues/2026/07/14/closed-web-actions-copy.md`：动作栏与文案（owner 验收）
- [~] `.cs/issues/2026/07/14/superseded-web-layout-density.md`：被视觉重设计取代

### 暂停或废弃

- 无

### 剩余阻碍

- 无；owner 已确认关闭。

## 暂不推进范围

- 重写 config core / 远程管理 / daemon
- TUI 大改与本 epic 默认解耦
- npm 发版
- 主题切换、远程字体/CDN、运行时 UI 框架

## 已确认问题

- cost 与当前 closed DTO 的所有模型字段都纳入结构化 Web editor，不再延后。

## 关闭条件

- 视觉重设计 issue 关闭：全表面状态可用、响应式可用、键盘/焦点与 reduced-motion 基线不回退
- Web 上：新增/编辑模型可完成官方填充；Add 主路径含 catalog/custom/import；单一主保存；12+ 模型列表可扫
- owner 确认「可日常用」；安全回归（SecretRef/revision）不回退
- 稳定结论合并回 `.cs/spec/pi-vendor/index.md`

## 合并回 Project Spec 的候选

- Web 日常主路径与官方填充能力
- 填充策略与密钥不覆盖规则
- 本地高密度配置工具的视觉/交互原则（若跨 epic 保持稳定）
- 动作层级/文案约定（若仍稳定）
- draft 生命周期动作词汇：只有 `Save & close` 写盘；其他动作明确 `…to draft` 或丢弃局部编辑
- 恢复性确认文案：对象、后果、保留路径；secret 仅称「configured」且从不暴露原值或内部 ref

## 关闭回写

- 状态：`closed`
- 合并位置：`.cs/spec/pi-vendor/index.md`（Web 完整管理、主路径与架构考量）；`.cs/spec/index.md`（当前方向、阅读路径）
- Vision：本 Epic 没有来源 Vision，因此无 Vision 状态需更新
- 保留材料：issue 执行记录与本 epic 过程


## 关闭结论

- **关闭判断**：所有计划 issue 已关闭或明确 superseded；owner 明确确认关闭整个 Epic。官方填充、全字段 editor、Add/Import 主路径、完整 Web app shell 与 draft/recovery 动作均已验收。
- **质量证据**：Web 主路径均用 agent-browser 验收；最终 vendor 测试 296 passed，typecheck、build:web、Impeccable detector 通过。SecretRef/revision 安全语义未改变。
- **毕业内容**：Web 完整管理结构、单 draft 单写入、active-Pi catalog、官方填充的 non-secret 覆盖规则、import 语义和恢复性动作词汇已写入 project spec。
- **遗留**：无。本 Epic 未定义主题系统、远程管理、daemon、TUI 大改或 npm 发版，这些继续属于项目边界而非未完成工作。
## 相关材料（按需）

- 浏览器体验：本地 `/vendor web` loopback；统一用 agent-browser 验收
- 实现落点：`packages/pi-vendor/src/web/client/`、`models/model-view.ts`、`models/state.ts`
