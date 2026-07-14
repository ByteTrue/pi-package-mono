---
kind: epic
title: pi-vendor Web 产品化升级
status: draft
created: 2026-07-14
---

# pi-vendor Web 产品化升级

## 这个 Epic 要改变什么

在已关闭的 dual-UI 骨架之上，把 **Web 管理器**做成日常可用的产品面：

- 关键加/改模型能力对齐（并在编辑器内可达）TUI 的 catalog/enrich 路径
- 主任务路径清晰（加模型、编辑、导入、保存）
- 动作层级与文案人话化；布局密度达到可扫完列表的程度

不推翻 config core / SecretRef / revision 安全模型。

## 为什么现在做

dual-UI 已关但 owner 判断成品不可日常使用；能力缺口（如 id→官方模板）与交互简陋叠加，问题面过大，需要一条有边界的活规格分批推进。

## 关联 Project Spec

- `.cs/spec/pi-vendor/index.md`：Web 能力与边界；本 epic 将扩展「Web 日常可用」的完成度描述
- `.cs/spec/index.md`：当前方向
- 讨论：`.cs/talks/2026-07-14-vendor-web-productization.md`
- 前序（已关闭）：`.cs/epics/2026/07/12/vendor-dual-ui-manager/spec.md`

## 当前方案

1. **能力优先**：已完成「按 id 官方填充」；下一步对齐 Add model 三源路径与表单字段。
2. **再收路径/文案**：单一主保存栏、密钥人话、修 dialog 生命周期类问题。
3. **最后密度/布局**：可用宽度、Models 主区，不做视觉大翻新框架。
4. **填充策略（已确认，已实现）**：
   - 新增：默认用 catalog/enrich 结果整表填入模板字段
   - 编辑：用户主动「从官方填充」→ 二次确认后覆盖模板字段
   - **不覆盖** headers 及用户密钥类字段
5. **catalog 运行时来源**：始终使用 active Pi 安装的 catalog；`dev:web` 必须模拟当前 PATH 的 Pi，不能让 workspace peer fixture 决定结果。

## 需求变化

相对当前 project spec / 已交付 dual-UI：

- Web 加/改模型必须能完成 TUI 级「搜 id / 官方模板」而不只靠旁路 catalog 块或手填
- Web 主路径与动作层级达到可日常使用（验收以任务完成而非「有 API」）

## 架构考量

- 复用已有 `/api/catalog`、`/api/enrich` 与 model-source core，优先接线不重造
- 安全边界默认不动；若编辑器填充触及 SecretRef 路径，fail closed 与 exact-path 规则不变
- 双 UI 单语义：填充结果仍是 draft 内 `ProviderModelConfig`，经既有 Save/revision 提交

## 统一语言

- **官方填充**：catalog 选择或 enrich 将官方字段写入编辑器 draft
- **模板字段**：id/name/api/reasoning/context/maxTokens/input/compat/thinkingLevelMap 等非密钥配置
- **用户密钥字段**：headers 及 opaque secret 路径，填充时不覆盖

## 当前推进

### 可推进范围

下一项是 Add model 主路径：将 catalog / custom / import 接成默认入口；其中 discover 接线也在该 issue 内收口。

### Issues

- [x] `.cs/issues/2026/07/14/closed-web-model-editor-official-fill.md`：编辑器 id→官方填充（含 active-Pi catalog 回归修复）
- [ ] `.cs/issues/2026/07/14/open-web-add-model-main-path.md`：Add model 主路径对齐 TUI
- [ ] `.cs/issues/2026/07/14/open-web-model-form-fields.md`：模型表单常用字段
- [ ] `.cs/issues/2026/07/14/open-web-actions-copy.md`：动作栏与文案
- [ ] `.cs/issues/2026/07/14/open-web-layout-density.md`：布局密度

### 暂停或废弃

- 无

### 剩余阻碍

- 无；issue 2 设计时明确 catalog/custom/import 的入口与 discover 失败态。

## 暂不推进范围

- 重写 config core / 远程管理 / daemon
- TUI 大改与本 epic 默认解耦
- npm 发版
- 完整视觉 redesign 或引入运行时 UI 框架

## 未确认问题

- cost 字段映射是否在本 epic 补齐（TUI 侧亦有 skip 记录）——默认本 epic 可不强求 cost，进表单字段 issue 时再定

## 关闭条件

- 首批 5 个 issue 关闭或明确移出
- Web 上：新增/编辑模型可完成官方填充；Add 主路径含 catalog/custom/import；无双份主保存；12+ 模型列表可扫
- owner 确认「可日常用」；安全回归（SecretRef/revision）不回退
- 稳定结论合并回 `.cs/spec/pi-vendor/index.md`

## 合并回 Project Spec 的候选

- Web 日常主路径与官方填充能力
- 填充策略与密钥不覆盖规则
- 动作层级/文案约定（若仍稳定）

## 关闭回写

- 状态：关闭时改为 `closed`
- 合并位置：（关闭时填）
- 保留材料：issue 执行记录与本 epic 过程

## 相关材料（按需）

- Playwright 体验：本地 `/vendor web` loopback（会话临时）
- 实现落点：`packages/pi-vendor/src/web/client/`、`models/model-view.ts`、`models/state.ts`
