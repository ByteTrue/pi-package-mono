---
kind: epic
title: "pi-image-gen 的 provider 与模型管理面"
status: draft
created: 2026-09-27
---

# pi-image-gen 的 provider 与模型管理面

> **读者：** 在这条有界变化里对齐的人——相对现状要改什么、现在怎么理解方案、哪些能推、哪些还悬着、关了合回哪里。

## 要改变什么

`/image-gen` 目前只有「一次性配好」的形状，没有「日常管着」的形状：provider 与模型都没有独立的浏览、修改与删除入口，`defaultModel` 一个字符串同时编码供应商路由和远端模型 id。本 Epic 把它补成以 Provider 为一级、模型为二级的管理面，并让数据结构支撑得起增删查改。

不来自 Vision（`byissue/vision/index.md` 无图像生成条目）；来源是 2026-09-27 的使用反馈与代码核对，关联 `byissue/spec/pi-image-gen/index.md`。

## 为何现在做

上新模型只想换 model id，却要重走 baseUrl → credential → headers → 探测 → 模型 → 输出目录的完整向导。快改 `byissue/issues/099-x-ff-image-gen-change-default-model.md` 加了 `Change default model` 短路径，止住了最高频的那条，但把整体缺口摆明了：provider 与模型都缺管理面。继续往向导上叠快捷入口，会让 `config-command` 长成第二套配置语义。

## 已确定（相对现状的取舍）

- 菜单按 Provider 两级浏览重组：`Manage providers` → 单个 provider 详情（当前默认路由、改 baseUrl/key/headers、模型列表 CRUD、删除）。`Configure image model` 收窄为「添加新供应商」，现有七步向导原样复用，不重写。
- 数据结构原计划「先补 CRUD、形状不动」（方案 a）起步，Issue 001 证明 a 撑不住两级管理面（双容器语义、路由编码进字符串、catch-all 靠字段缺失表达、built-in 清单不可持久化），已按许可升级到方案 c。
- **允许破坏性变更，前提是迁移到位**——用户 2026-09-27 明确的取向。迁移必须读旧写新、一次性、失败不静默毁掉用户配置，且在迁移成功前不覆盖旧文件。
- 不与 `pi-vendor` 合并 provider 概念：那边管 LLM 的 `models.json`，这边是生图 wire 协议；六包互不依赖。
- **数据形状定为方案 c**（Issue 001 结论）：单容器 `providers`（built-in 与 custom 同权）+ 显式 `default: {provider, model}` + `version: 2`。`models` 退化为"已知模型 + alias"清单，不再参与路由判定，因此 **catch-all 概念退役**；built-in 无行时仍按模板与标准 env 解析。`tombstone` 语义原样保留。完整形状、迁移策略与有意放弃的三条便利见 `issues/001-x-provider-model-data-shape.md`。
- **迁移为一次性硬迁移**：读旧写新，旧文件另存 `settings.json.v1.bak`，不写派生的 `defaultModel` 镜像字段；单向迁移、降级回滚靠 `.bak`。`loadImageGenSettings()` 签名不变，迁移对调用方不可见。
- **删除 provider 定稿**（Issue 003）：允许删除当前默认路由所属的 provider，并一并清空 `default`——悬空路由会让每次生成撞解析错误，而「必须先切走」是人为的顺序依赖，「没有路由」本就是系统能干净处理的状态。built-in 无 settings row 时删除只通知不写盘（删行 ≠ 停用，标准 env 变量仍生效）；`providers` 删空则去掉该 key。

## 仍在变化

- Epic 内三个 issue 均已关闭、验证齐、用户在真实 TUI 验收通过（2026-09-27）。剩下只有一条待用户决定：**本 Epic 是否整体关闭**（关闭需把筛选后的结论毕业进 Project Spec——相关事实已在本次回写中进入 `byissue/spec/pi-image-gen/index.md`）。

## 必须守住

- 读写仍只针对 `<config dir>/pi-image-gen/settings.json` 单一专用文件；原子写 + `0600`；交互写入 fail-closed；runtime 读 fail-soft。
- 任何菜单项、确认摘要、错误与日志都不得出现 literal key、解析后的 env 值或 credential header 值。
- extension 与 Skill CLI 继续共用同一 core；不新增常驻 Agent tool、不新增 wire protocol、不提供 CLI model override。
- 管理面只在 `ctx.mode === 'tui'` 下可用。
- 每条 CRUD 与迁移纹路都要有测试证明：旧配置读进来仍解析成同样的 route。

## 统一语言

- **provider**：五家 built-in（openai / gemini / dashscope / ark / openrouter）或任意 custom 一家，携带 api 协议、baseUrl、credential、headers。
- **route**：解析后的实际调用参数，即 `resolveProviderRoute` 的产物。
- **model entry**：provider 下的一个远端模型条目，可带 alias。
- **default route**：`default: {provider, model}`，系统里唯一的路由真相。
- **declared list**：provider 行的 `models` 清单，供选择器与文件名使用；v1 的 catch-all（靠"没有 models"表达放开）随路由显式化退役。
- **tombstone**：`apiKey: ""` / `headers: {}`，显式阻断下层与标准 env fallback。

## 质量候选（尚非承诺）

- **易用性**：换 key、删供应商、给已有供应商加模型各 ≤3 步且不重走完整向导。来源：本次反馈。证明：真实 TUI 手测 + 交互路径测试。
- **迁移正确性**：0.4.0 起任意历史配置升级后 route 逐字段不变。来源：`spec` 的存储收敛史（066）。证明：真实旧配置样例参数化测试。
- **安全性**：新菜单面不新增凭据暴露面。来源：`spec`「绝不泄露凭据」。证明：断言 notify 与错误文本。
- **可测试性**：CRUD 与迁移可脱离真实 `$HOME` 在 `config-command` / `settings` 层验证。

## 推进视图

- `issues/001-x-provider-model-data-shape.md` — 数据形状与迁移方案定稿。已关闭。
- `issues/002-x-v2-settings-and-migration.md` — v2 形状、一次性迁移与 core 重切。已关闭。
- `issues/003-x-manage-providers-surface.md` — `Manage providers` 两级管理面与 provider/模型 CRUD。已关闭。
- 发布：三个 issue 的交付以 `@bytetrue/pi-image-gen@0.5.0` 发布于 2026-09-27（tag `pi-image-gen-v0.5.0`，GitHub Actions OIDC publish，含 provenance）。磁盘形状破坏性变更随 minor 号发布，读取时自动迁移。
- 暂不推进：与 `pi-vendor` 的任何整合；CLI model override；新增生图协议。
- 关闭条件：管理面覆盖 provider 与 model 的增删查改，迁移经真实旧配置验证，且 `npm --workspace @bytetrue/pi-image-gen test / typecheck / build` 与 pack smoke 全绿。**三条均满足。**
- 合并候选：`byissue/spec/pi-image-gen/index.md` 的「它负责什么」与「配置边界」已按 v2 + 两级管理面重写；「它不负责什么」与「关键考量」经核对仍然成立，未改。
- 关闭时检查 Vision：若本 Epic 改变了「image-gen 是低频 Skill + TUI 闭环」的目标定位，由用户决定是否进 Vision。
