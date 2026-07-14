# pi-vendor 双界面交互重构 talk

## 原始想法

`/vendor` 不只是“给已有供应商加模型”太长：新增、编辑、模型管理都被多层字段菜单割裂。希望整体重做交互，而不是局部打补丁。

## 真问题

如何在不引入 daemon/远程面板的前提下，同时提供：

1. 终端里的高频短路径  
2. 完整管理能力  

并保证两套 UI 共用配置与模型语义。

## 术语

- **一次性 browser modal**：启动本地 server → 编辑 draft → Save/Cancel 关 server  
- **任务导向 TUI**：按“加模型/加供应商”组织，而非字段表  
- **共享领域层**：config / catalog / enrich / validate 纯 Node 服务  

## 已确认决策

- Web = 一次性 modal + 纯静态前端 + 轻量 `node:http`（非 daemon）  
- TUI 保留高频；完整管理进 Web  
- 字段策略：常用始终显示；可选已配置才显示 + `Add setting…`；保留 Raw JSON  
- 后续 owner 确认 **opaque keep-value** 与 7 份 child design 统一批准  

## 约束

- 不做 TUI 自研鼠标协议  
- 不监听非 loopback  
- 不管理 auth.json / OAuth  
- 不拆新 npm 包  

## 影响面、风险与取舍

- 影响 `models.json` 写入与 Pi registry 刷新路径  
- 密钥若明文进浏览器会扩大暴露面 → 选 opaque refs  
- 双 UI 若分叉语义会长期双倍 bug → 强制 shared core  

## 分歧

- （关闭时）无未决产品分歧；UX polish 是否继续另开线由后续 talk/issue 决定  

## 初步出口草案

- 出口：**已完成** → epic `vendor-dual-ui-manager`（closed）  
- 历史 brainstorm 原文：`.cs/archive/codestable-legacy/brainstorms/vendor-dual-ui-manager/`
