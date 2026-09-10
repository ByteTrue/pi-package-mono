---
kind: issue
title: "统一 pi-image-gen 配置流与智能模型探测"
type: feature
status: closed
created: 2026-09-05
closed: 2026-09-10
---

# 统一 pi-image-gen 配置流与智能模型探测

## 目标

重构 `/image-gen` TUI 配置向导：
1. 消除顶级割裂的“内置厂商”与“自定义厂商”双轨分支，提供单一平滑的统一配置入口。
2. 预设厂商作为模板智能预填（Base URL、默认环境变量、协议类型），同时允许自定义厂商/中转站。
3. 增加轻量安全的模型发现（Model Discovery）机制：在配好 Key 和 URL 后，自动探测端点（OpenAI / OpenRouter / Gemini 等兼容 `/models` 端点）可用模型列表，并优先高亮生图模型；探测失败或不支持时平滑降级为手动输入和推荐列表。

## 已确认边界

- 保持配置兼容：`defaultModel`、`providers` 与 `customProviders` 的结构保持运行时读取和解析兼容；存储位置后经用户决策迁至专用文件（见执行记录）。
- 探测失败零副作用：模型拉取有严格短超时（默认 5s）与异常捕获，失败时不报错阻断，自动降级为推荐列表或直接输入。
- 绝不泄露凭据：探测请求过程与错误提示中绝不泄露 API Key。
- TUI 保持安装即可用：无需手写 JSON 即可完成全部配置。

## 质量目标

- 易用性/交互能力：消除用户的“内置 vs 自定义”选择困惑；中转站和代理服务可自动列出可用生图模型。
- 可靠性/容错性：网络超时或远端无 `/models` 接口时无缝回退，绝不导致配置向导卡死或崩溃。
- 兼容性：兼容已有配置；保持原子写入与 0600 权限保护。
- 可测试性：单测覆盖统一配置流、模型探测、生图模型过滤及降级逻辑。

## 执行记录

- 新增 `packages/pi-image-gen/src/discovery.ts`：实现 `discoverRemoteModels` 和 `isLikelyImageModel`，支持 OpenAI / OpenRouter / Gemini 兼容端点的模型自动拉取、生图模型高亮排序、严格 5s 超时与 fail-soft 静默降级。
- 重构 `packages/pi-image-gen/src/config-command.ts`：
  - 合并原有分裂的顶级菜单为单一 `Configure image model` 入口；
  - 预设厂商作为模板智能预填默认 Base URL、协议及标准环境变量，并保留直接选择 Custom Provider 的平滑通道；
  - 接入模型自动探测：在输入 Base URL 与凭证后，自动向端点探测可用模型列表；若拉取成功则优先展示生图候选模型；若探测失败或不支持则平滑降级为内置推荐列表或手动输入；
  - 保持向下兼容旧版菜单项和原有 `settings.json` 结构。
- 完善测试：
  - 新增 `discovery.test.ts` 覆盖关键词识别、OpenAI 协议解析、Gemini 协议解析及异常降级；
  - 扩充 `config-command.test.ts` 覆盖统一配置流程、Custom 预设分支和基于 Discovery 探测结果的模型选择。
- 验证通过：
  - `npm --workspace @bytetrue/pi-image-gen test`（12 个测试文件 91 个测试全部通过）；
  - `npm --workspace @bytetrue/pi-image-gen run typecheck` & `build`；
  - `node packages/pi-image-gen/scripts/pack-smoke.mjs`（打 smoke 包验证完整通过）；
  - 全仓库 `npm test` 通过。
- 2026-09-06 存储收敛（用户决策）：
  - 配置从 Pi 分层 `settings.json` 迁至专用文件 `~/.pi/agent/pi-image-gen/settings.json`（随 `PI_CODING_AGENT_DIR` / `PI_AGENT_HOME` 重定向），顶层即配置本体；不再读写 Pi 的 settings.json。
  - 包表面收敛为一命令 + 一技能：删除 `session_start` 钩子、`PI_IMAGE_GEN_TRUSTED_CWD` trust env 与全局/项目 scope 选择（项目层不存在后 trust 传递失去意义）；`/image-gen` TUI 少一步询问，CLI `--list` 显示配置文件路径。
  - 测试同步重写（settings 套件覆盖专用路径/原子性/墓碑/损坏拒绝）；91 测试 + typecheck + build + pack-smoke 通过；本机实际配置已迁移并经真实 `--list` 验证。
  - README 更新为专用文件说明；废弃“项目层受信才生效”的 IMPORTANT 注记。

## 关闭结论

- **关闭判断**：目标达成，范围未暗扩——实现过程反而按用户决策两次收窄表面：单一 `Configure image model` 入口替代双轨菜单；存储收敛为专用文件后删除 `session_start` 钩子、`PI_IMAGE_GEN_TRUSTED_CWD` 与 scope 选择。
- **验证摘要**：91 tests + typecheck + build + pack-smoke 全绿；本机真实配置已迁移并经 `--list` 验证。易用性（统一入口与 Custom 通道）由 config-command 套件覆盖；容错性（5s 探测超时与异常降级）由 discovery 套件覆盖；兼容性以“包只读写专用文件、不再读取 Pi `settings.json`”落地，边界已如实写入 spec。
- **回写位置**：统一配置流、专用文件路径、tombstone、fail-soft/fail-closed、五协议与 custom id 冲突边界均已在 `codestable/spec/pi-image-gen/index.md`；本关闭在其证据索引补记本 issue。
- **遗留**：无。

