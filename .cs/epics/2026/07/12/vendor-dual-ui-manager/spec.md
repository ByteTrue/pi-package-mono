---
kind: epic
title: pi-vendor 双界面管理器
status: closed
created: 2026-07-12
---

# pi-vendor 双界面管理器

## 这个 Epic 要改变什么

把 `@bytetrue/pi-vendor` 从“字段中心多层 TUI”改成：

- **TUI**：任务导向高频路径（加模型 / 加供应商 / 打开 Web）
- **Web**：一次性本地 browser modal 做完整 provider + model 管理
- **共享 core**：配置事务、模型发现/enrich、密钥与校验语义只实现一次

## 为什么现在做

旧 TUI 路径深、噪音字段多；完整管理又塞不进终端表单。产品决策已确认双界面与一次性 modal，需要跨模块分批交付。

## 关联 Project Spec

- `.cs/spec/pi-vendor/index.md`：本 epic 的稳定能力与边界已毕业到此
- `.cs/spec/index.md`：monorepo 能力地图中的 vendor 条目

## 当前方案

（关闭时状态：已交付）

1. Config core：document/mutation + Pi oracle + revision 条件原子提交  
2. Web modal runtime：loopback server、token/CSP、opaque SecretRef、Save/Cancel 生命周期  
3. Model source core：catalog/enrich/discover 安全边界与 closed DTO  
4. TUI quick workflows：固定根菜单与状态机  
5. Web provider/model workflows：表单 + Raw JSON 单 draft  
6. Hardening：pack-smoke、CI、文档与跨表面回归  

安全默认：opaque keep-value、127.0.0.1、随机端口与 bearer、strict JSON、冲突默认 reject。

## 需求变化

- `/vendor` 首屏改为任务入口，不再先进完整字段表单  
- 新增 `/vendor web` 与完整 Web CRUD / 发现 / Raw JSON  
- 保存后 `ModelRegistry.refresh()` + `getError()`  
- known secret 默认不进浏览器  

## 架构考量

- 双 UI 单语义，避免两套规则  
- Pi 公开 API 作兼容 oracle，不复制 schema  
- 乐观 revision 而非跨进程锁  
- 浏览器关 tab 不可靠 → Pi Esc 为明确回收路径  

## 统一语言

见 project spec `pi-vendor` 层；本 epic 引入并已毕业：revision、SecretRef、MutationResult、ConfigCoreError、ConflictPolicy、opaque keep-value、first-terminal-action-wins。

## 当前推进

### 可推进范围

- 无（epic 已关闭）

### Issues

- [x] `.cs/issues/2026/07/12/closed-vendor-config-core.md`
- [x] `.cs/issues/2026/07/12/closed-vendor-web-modal-runtime.md`
- [x] `.cs/issues/2026/07/12/closed-vendor-model-source-core.md`
- [x] `.cs/issues/2026/07/12/closed-vendor-tui-quick-workflows.md`
- [x] `.cs/issues/2026/07/12/closed-vendor-web-provider-workflows.md`
- [x] `.cs/issues/2026/07/12/closed-vendor-web-model-workflows.md`
- [x] `.cs/issues/2026/07/12/closed-vendor-dual-ui-hardening.md`

### 暂停或废弃

- 部分 UX polish / 更完整手工浏览器证据：owner 接受“可用即关”，移出本 epic

### 剩余阻碍

- 无阻塞关闭项

## 暂不推进范围

- npm 发版（关闭时未做，非能力缺口）  
- 远程管理、daemon、鼠标 TUI、auth.json  

## 未确认问题

- 无（关闭时已清空）

## 关闭条件

- 七个 feature 均 accepted  
- 自动化 typecheck/test/pack-smoke 绿  
- owner 确认可用并关闭 roadmap（2026-07-14 `docs(cs): close vendor-dual-ui-manager roadmap`）

## 合并回 Project Spec 的候选

- 已合并：双 UI 能力、三子系统、密钥与 revision 语义、边界与不做项 → `.cs/spec/pi-vendor/index.md` 与根能力地图

## 关闭回写

- 状态：`closed`
- 合并位置：`.cs/spec/pi-vendor/index.md`、`.cs/spec/index.md`
- 保留材料：旧 design/review/qa/goal-protocol 全量在 `.cs/archive/codestable-legacy/roadmap|features/`

## 相关材料（按需）

- 讨论：`.cs/talks/2026-07-12-vendor-dual-ui-manager.md`
- 旧 roadmap 正文：`archive/codestable-legacy/roadmap/vendor-dual-ui-manager/vendor-dual-ui-manager-roadmap.md`
- 包 README：`packages/pi-vendor/README.md`
