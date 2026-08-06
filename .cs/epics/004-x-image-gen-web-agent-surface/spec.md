---
kind: epic
title: 收缩 image-gen 与 web 的常驻 Agent 面
status: closed
created: 2026-08-06
---

# 收缩 image-gen 与 web 的常驻 Agent 面

## 这个 Epic 要改变什么

在不牺牲“安装后可在 Pi TUI 内完成配置”的前提下，收缩两个包的常驻 Agent 面：

1. `@bytetrue/pi-image-gen`：低频生成能力从常驻 `image_generate` tool 改为 package Skill + bundled CLI；`/image-gen` 继续作为人类配置入口，并在一次流程内完成可用模型配置。
2. `@bytetrue/pi-web-search`：高频 `web_search` / `web_fetch` tools 与 `/web` 保留；删除重复的常驻 prompt metadata 和自定义 renderer，搜索供应商重试改为显式选择，fetch 始终走 package 的 SSRF-safe generic transport，全部 search provider 使用 bounded response reader。

`pi-vendor`、`pi-background-terminal`、`pi-vision` 不在本 Epic 范围内。

## 为什么现在做

`pi-ask-user` 的删除触发了 Pi 设计哲学审计。owner 随后明确了不能被“少代码”覆盖的产品前提：

- 用户安装 package 后没有义务翻 GitHub 文档或手改配置才能使用；面向用户的复杂配置必须在 Pi TUI 内闭环。
- `pi-image-gen` 配置继续存放在 Pi `settings.json` 的 `pi-image-gen` 节，保留 global / project layered semantics。
- 图片生成低频，常驻 tool schema 不值；Web 搜索/抓取高频，且 typed result、SSRF、abort、预算与落盘截断足以支撑常驻 tools。

因此这不是“把所有 extension 改成 CLI”，而是按频率与宿主能力分别选择最小充分形态。

## 稳定产品约束

### 共同

- TUI 是安装后的自描述配置入口；Skill/CLI 只能替代 Agent tool，不能替代人类配置面。
- 不在未授权时修改用户真实配置；测试只使用临时 `PI_CODING_AGENT_DIR` / `PI_CONFIG_DIR`。
- 密钥不得出现在 CLI stdout/stderr、TUI 摘要、错误或测试日志中。

### pi-image-gen

终态：

```text
人类：/image-gen TUI ──atomic 0600──> settings.json["pi-image-gen"]
Agent：pi-image-gen Skill ──bash──> bundled image-gen CLI ──> generate core
```

- package 注册 `/image-gen`，不注册 Agent tool。
- package 分发 `skills/pi-image-gen/SKILL.md` 与 `skills/pi-image-gen/scripts/image-gen.mjs`；完整 Skill 只在生成/编辑图片时按需加载。
- CLI 以 stdin JSON 接收 `{prompt,image?,n?,size?,filename?,outputDir?}`，使用 settings 的固定 `defaultModel`，stdout 只输出可展示的 markdown 路径；错误走 stderr + 非零退出。
- `/image-gen` 至少提供：配置 built-in model、配置 custom provider/model、设置输出目录、查看当前有效配置；built-in/custom 流程都能在一次运行内写出可生成的 `defaultModel`、route、credential、headers 与 output directory。literal key 必须遮罩输入；也支持 `$ENV_VAR` 引用和无 key route。
- 写入目标可选 active global settings 或 trusted project settings；Esc/取消零写入； malformed settings fail closed；写入保留其它 top-level keys 与同节未修改字段，随机临时文件 + atomic rename + `0600`。
- runtime/CLI 只有在 Pi 当前 session 明确认可信时才合并 `<cwd>/.pi/settings.json`。extension 用 package-scoped、绑定 canonical cwd 的环境标记把 `ctx.isProjectTrusted()` 传给 bash 子进程；未匹配时 CLI 忽略 project 层。这样 project route/headers 不能偷用 global/env credential。
- 移除 `@amaster.ai/pi-shared` 与 `typebox` runtime/peer 使用；保留真实 wire adapters、图片输入、输出落盘与现有 Apache-2.0 归因。

### pi-web-search

- `web_search` schema 增加可选 `provider`；省略时用 `/web` 选定 provider，显式提供时只尝试该 provider。不存在隐式跨 provider fallback，也不再保留 `autoFallback` 配置。
- provider 失败信息列出其它当前可调用的 search provider 名称，但不自动发送 query。
- `web_fetch` 无论当前 search provider 是什么，都只调用 `fetchViaGenericHtml`；search provider 与 fetch transport 解耦。
- 两工具删除 `promptSnippet`、`promptGuidelines`、`renderCall`、`renderResult`；能力、边界与输出约定集中在 tool description / schema / result。
- `/web` 保留 provider、key、base URL、proxy 的完整配置能力。
- 所有 provider 的成功与错误 body 都通过 shared bounded reader；超限取消 stream。搜索 provider body 使用独立 2 MiB 上限，generic fetch 继续使用既有 10 MiB decoded 上限。

## 重要接口的两个方案

### image-gen project trust 传递

A. CLI 自己读取 `trust.json`：无法表达 session-only trust 和 CLI override，判定会与运行中的 Pi 分叉。

B. extension 在 `session_start` 把 `ctx.isProjectTrusted()` 写入绑定 canonical cwd 的 package-scoped env，bash/CLI 只在 cwd 精确匹配时启用 project 层。

选择 **B**。它复用 Pi 的权威判定，不暴露密钥；CLI 在 Pi 外运行时默认只读 active global 层。

### web provider 重试

A. 保留 `autoFallback`，只把默认改 false：仍保留隐式多供应商行为与配置/测试面，Agent 也无法在单次重试中选 provider。

B. 删除 fallback orchestration，给 `web_search` 增加可选 `provider`。

选择 **B**。一次 tool call 只联系一个 provider；省略时使用 `/web` 当前配置。

## 质量目标

### 交互能力

- 条件：用户只安装 package、不读 README、不手改 JSON。
- 目标：可在 `/image-gen` 与 `/web` 内完成首次可用配置，取消不产生写入，错误给出可修复动作。
- 来源：owner 明确决定。
- 证据：scripted command-context tests + isolated real Pi smoke。

### 信息安全性

- 条件：cwd 含未受信任 `.pi/settings.json`，或上游返回恶意/超大 body。
- 目标：image-gen 不读取该 project route/headers，不能把 global/env key 发往其端点；Web provider 超预算即取消；任何错误/输出不复现 key。
- 来源：审计发现。
- 证据：trust provenance tests、credential non-echo tests、stream cancel budget tests。

### 功能适宜性

- 条件：Agent 按 Skill 生成/编辑图片，或调用 Web tools。
- 目标：image CLI 覆盖原 tool 参数与落盘结果；Web 一次搜索只命中指定 provider，fetch 始终使用 generic transport。
- 来源：本 Epic 目标。
- 证据：CLI integration tests、tool registration/routing tests。

### 可维护性

- 条件：TUI、CLI 与 tests 使用 image generation 配置/核心。
- 目标：配置读取/写入、model resolution 与 generate core 各只有一个生产来源；Skill wrapper 不复制 provider 行为。
- 来源：实现经济性与模块设计。
- 证据：source inspection、pack smoke、独立 review。

## 执行结果

1. `pi-image-gen` 已转为 Skill + bundled CLI；`/image-gen` 保留完整 built-in/custom TUI 配置，配置仍写 Pi `settings.json`；常驻 `image_generate` tool 已移除。
2. `pi-web-search` 保留 `/web`、`web_search`、`web_fetch`；一次搜索只联系一个 provider，fetch 固定 generic transport，所有 provider body 有界。
3. `pi-ask-user` 的独立删除记录在 issue 047；vendor/background/vision 未进入本 Epic。

## 暂不推进范围

- 修改 `pi-vendor`、`pi-background-terminal`、`pi-vision`
- image provider/model 自动 discovery
- 新增 image provider wire protocol
- Web provider 删除或新增
- Web 配置迁移到 `settings.json`
- npm 发布、push

## 关闭条件与证据

- `pi-image-gen` package 在真实 Pi 中发现 `/image-gen` 与 `pi-image-gen` Skill，且 `pi.getAllTools()` 不含 `image_generate`。
- 隔离环境里 TUI scripted flows 写入可被 CLI 消费的 global/project settings；untrusted project 覆盖测试证明不会改变 effective route/credential。
- packed tarball 包含 extension、Skill、wrapper 与 CLI dist；解包后的 CLI 可执行。
- Web tool definitions 没有 prompt metadata/custom renderers；显式 provider、generic fetch 和所有 provider body budget tests 通过。
- 两包与根 workspace 的 test/typecheck/pack checks 通过；独立 reviewer 无 blocker/important。

## 关闭证据

- 全仓：`488 passed`，Web live E2E `9 skipped`；五个 workspace typecheck 全通过；`git diff --check` 通过。
- image-gen pack smoke：63 files；packed production install、zero-tool extension load、Skill wrapper/CLI 执行全部通过。
- web pack dry-run：21 files，77,023 bytes，含 `src/index.ts`。
- 真实 Pi 隔离安装 + RPC smoke：发现 `/image-gen`、`/web`、`skill:pi-image-gen`；工具集合含 `web_search` / `web_fetch` 且不含 `image_generate`；无 extension error。
- 独立 reviewer 最终 gate：`PASS`，0 blocker / 0 important；过程中发现的 credential echo、keyless tombstone、malformed settings、proxy userinfo 与 routing prefix 冲突均已加回归。
- 未 push、未发布、未修改用户真实配置；live provider E2E 未运行。

## 相关材料

- 对话决策：本 Epic 创建前的 `pi-ask-user` / Ponytail 审计讨论
- Project Spec：`.cs/spec/index.md`、`.cs/spec/pi-web-search/index.md`
- Pi docs：`docs/extensions.md`、`docs/tui.md`、`docs/skills.md`、`docs/packages.md`
