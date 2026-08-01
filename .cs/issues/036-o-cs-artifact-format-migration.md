---
kind: issue
title: "迁移 CodeStable 产物到当前实体格式"
type: chore
status: open
created: 2026-08-01
epic: ""
---

# 迁移 CodeStable 产物到当前实体格式

## 目标

现行 `.cs/` 只使用当前 CodeStable 的扁平编号、状态命名和实体 frontmatter；历史证据仍留在明确的 legacy archive。

## 范围

- 包含：现行 epic、issue、note、talk 的路径迁移，内部引用更新，缺失 frontmatter 补齐，Vision 基础入口补齐。
- 不包含：重写 legacy archive 的历史证据内容；把已关闭实体自动整理进 `done/`；重新解释已经关闭事项的产品结论。

## 归属

- 独立 issue。
- 相关 spec：`.cs/spec/index.md`

## 背景与证据

旧实体仍使用日期目录和 `closed-` / `superseded-` 前缀；当前契约要求各树独立递增的 `NNN-o|x-名称`，note/talk 使用 `NNN-名称`，无日期目录。

## 操作方案

按原路径的时间顺序为每棵树独立编号，使用 `git mv` 保留历史，机械更新仓库内引用。关闭/废弃历史统一为 `x`，原 `superseded_by` 继续保留为补充元数据。

## 质量目标

- 可维护性 / 可分析性：现行实体必须能仅凭路径与 frontmatter 判断类型和状态；以结构检查和旧路径零命中验证。
- 信息完整性：迁移不得丢失实体正文或打断内部引用；以实体数量、Git rename 和引用存在性检查验证。

## 验证

- current-tree validator：37 issues、3 epics、6 notes、3 talks 全部满足独立编号与路径 contract。
- issue / epic 的 `o|x` marker 与 frontmatter `status` 一致；所有 issue 必需字段齐全；4 个 FF 使用 `-ff-`、`type: ff` 与四段正文。
- current `.cs/` 中 date-based issue/epic 路径与旧 `open-/closed-/superseded-` entity references 零命中；legacy archive 原结构保留。
- Markdown numbered-path references resolve；`git diff --check` 通过；Git 识别原实体为 rename。
- 独立 CS reviewer 发现的 Vision 未确认内容、stale epic contract、stale active note、closed-epic writeback 与旧 identifier 均已修正。

## 执行记录

- 已迁移 3 个 epic、35 个既有 issue、6 个 note、3 个 talk；本次两个工作项另按新格式创建 issue 036/037。
- 已补最新模板的空 `.cs/vision/index.md`；未把未经 owner 确认的目标内容写入 Vision。
- 已补齐 issue frontmatter，规范 4 个最新 issue 的正文结构，并为 closed epic 补关闭回写 / Vision 判断。
- 已更新仓库内 current-entity 引用与 `.cs/archive/MIGRATION.md`；冻结的 `codestable-legacy/` 不改结构。
- 已修正 active catalog note 与 AI-first epic 中迁移时暴露的过期 Web/oracle 描述，使活文档不再指向删除能力。

## 关闭回写

- project spec：`.cs/spec/index.md`
- notes：`.cs/notes/003-legacy-codestable-archive.md`
