---
doc_type: brainstorm
slug: vendor-dual-ui-manager
created: 2026-07-12
status: active
summary: 重新设计 pi-vendor，形成轻量高频 TUI 与一次性本地 Web 完整管理器的双界面
tags: [pi-vendor, tui, web-ui, models-json, ux]
---

# pi-vendor 双界面交互重构

> 创意空间 | 2026-07-12 | 下一步：cs-epic

## 出发点

当前 `/vendor` 不只是“给已有供应商添加模型”路径过长：新增供应商、编辑供应商、添加与管理模型都被字段式多层菜单割裂，常用动作需要穿过大量低频配置项。目标是重新审视整个交互流程，而不是继续在现有菜单上局部打补丁。

期望最终形成两层体验：TUI 承担简单、高频、轻量的任务流；Web 页面承担完整的供应商与模型管理能力。

## 聊过的方向

- **继续增强现有 TUI**：动态隐藏未配置字段能够减少噪音，但不能解决整体流程以字段为中心、任务路径过深的问题。
- **为 TUI 增加鼠标操作**：Pi TUI 当前没有一等鼠标事件与命中测试 API，自行开启终端鼠标协议并解析坐标会形成脆弱的终端特定实现，因此不作为主要方向。
- **本地 Web 管理器**：采用构建后的纯静态前端和轻量 `node:http` server。Plannotator 的 Pi 扩展已验证“预构建 HTML + 随机本地端口 + 浏览器 modal + 操作结束关闭 server”的形态可行。
- **前后端边界**：浏览器负责表单、搜索、过滤、内存 draft、字段显隐和变更预览；Node 侧复用配置、catalog、enrichment 与写入逻辑，负责读取本地资源、解析凭证、请求上游 `/models`、校验、冲突检测和原子写入，避免 TUI 与 Web 各自实现一套业务语义。
- **Web 字段呈现**：常用字段始终显示；可选字段仅在已配置时显示，并通过 `Add setting…` 显式添加；保留 Raw JSON 作为高级逃生口。严格只显示已有字段会让新增可选能力过于隐蔽，始终铺开全部字段又会重现当前菜单噪音。

## 当前倾向

倾向把这项能力拆成共享领域层、TUI 快捷任务流、Web 完整管理器三个相互依赖的部分：

1. 先让 `models-json`、official catalog、model enrichment、配置校验与写入成为两套 UI 可复用的纯 Node 能力。
2. `/vendor` 改为任务导向的轻量入口，至少提供快速添加模型、快速添加供应商和打开完整 Web 管理器；完整字段编辑不再堆在 TUI 主流程。
3. Web 页面以 provider 列表、provider 详情、models 表格和最终一次保存为主，页面持有整次 modal 的内存 draft。

建议同时支持 `/vendor web` 直接打开完整管理器，但具体命令入口和快捷动作清单留给 roadmap/design 确认。

## 已敲定的点

- Web 管理器采用**一次性浏览器 modal**：启动本地 server、加载配置快照、Save/Cancel 后关闭，不做常驻 daemon。
- Web 前端产物采用纯静态文件；运行时只需要轻量本地 server，不需要数据库、WebSocket 或持久后台服务。
- TUI 保留简单高频逻辑，Web 承担完整管理能力。
- Web 表单采用“常用字段始终显示；已配置的可选字段显示；缺失可选字段通过 `Add setting…` 添加；保留 Raw JSON”的策略。

## 遗留问题 & 下一步

- 明确 TUI 第一版保留哪些快捷动作，以及新增供应商最短向导的必填字段。
- 明确 Web v1 的完整能力边界：provider/model 的新增、重命名、删除、复制、上游发现、官方 catalog 匹配、Raw JSON 和预览分别做到什么程度。
- 设计配置快照 revision、冲突返回与未知字段无损 round-trip，避免覆盖手工或其他进程的并发修改。
- 决定现有 literal API key 是否原样进入浏览器 draft，或以 opaque/keep-value 方式避免默认暴露。
- 设计一次性 modal 的取消与异常关闭路径：浏览器 Save/Cancel、TUI Esc、超时和 Pi session shutdown。
- 确认保存后是否直接刷新 `ctx.modelRegistry`，消除当前要求用户再打开 `/model` 的步骤。
- 确认静态前端采用原生 HTML/CSS/JS 还是仅在复杂度确有需要时引入构建期 UI 库；不增加无必要的运行时框架。
