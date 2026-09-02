# Project Spec

## 这个项目是什么

`pi-package-mono` 是个人用的 [pi coding agent](https://pi.dev) 扩展 monorepo。多数包以 TypeScript 源码通过 jiti 加载；`pi-image-gen` 因 bundled Skill CLI 与 extension 共用同一 core，发布时构建 `dist`。当前有六个能力包：

1. **网络检索与抓取**（`@bytetrue/pi-web-search`）：给 agent 提供 `web_search` / `web_fetch`。
2. **自定义模型供应商管理**（`@bytetrue/pi-vendor`）：AI Skill 负责日常 `models.json` CRUD；随 Skill 按需执行的脚本提供 catalog/discovery/lint/key entry；`/vendor` 只承担零模型冷启动。
3. **图像生成**（`@bytetrue/pi-image-gen`）：`/image-gen` 在 TUI 内完整配置，Agent 仅在需要时加载 Skill 并调用 bundled CLI；不注册常驻生成 tool。
4. **背景终端**（`@bytetrue/pi-background-terminal`）：三个独立工具——后台跑命令、查看、停止。不覆盖 `bash`。
5. **让非视觉模型看图**（`@bytetrue/pi-vision`）：`image_ask` 把本地图片交给用户已配置的视觉模型；`/vision auto on` 可让 text-only 主模型在首轮调用前获得附件批量分析；`read` 撞上非视觉降级时给出引导。
6. **轻量子智能体调度**（`@bytetrue/pi-subagent`）：单工具 `subagent`，支持单任务/并行/串联链式运行子任务，带实时 TUI 差分卡片与 Token/费用统计。

仓库用 **npm workspaces**（`packages/*`），不是 pnpm workspace。

## 当前方向

- `pi-vendor` 已转为 **AI-first**：随包 Skill 做日常 provider/model CRUD，bundled script 按需提供 catalog/discovery/lint/key entry，TUI 缩为一次一个 provider/model 的冷启动路径；旧 Web 产品面已被明确 supersede 并删除。
- `pi-web-search` 保留高频 `web_search` / `web_fetch` 与完整 `/web` 配置面；一次搜索只联系一个 provider，失败后显式重试，fetch 固定走 SSRF-safe generic transport。
- `pi-image-gen` 是低频 Skill + bundled CLI；`/image-gen` 继续在 TUI 内闭合 built-in/custom 首次配置，所有配置仍写 Pi `settings.json` 的 `pi-image-gen` 节。
- `pi-background-terminal` 保持三个必填参数工具：`background_run(command)` 立即返回并把输出落盘，`background_status(id)` 查看单个任务，`background_kill(id)` 静默停止；`/background` 提供用户菜单。自然完成自动唤醒 Agent，session 结束清理进程树、输出流与文件，`/reload` 保留任务。它不覆盖 `bash`，不提供 timeout、PTY、原生 addon 或 Web UI。
- **`pi-vision`**：解决“主力模型没有视觉能力却需要按图工作”的诉求。`image_ask` 保留模型主动提出精确问题的路径；0.2.0 新增 opt-in 附件预分析，把 `before_agent_start.images` 在首轮主模型调用前批量交给所选视觉模型。自动模式默认关闭，不处理 TUI 粘贴后形成的路径文本，并受 project trust、数量/总字节与 60 秒 deadline 约束。
- 近期优先：五个扩展的维护、回归与按需发版。

## 能力地图

- **搜网页 / 抓页面** → 读 [`pi-web-search/`](pi-web-search/index.md)
- **管理自定义 provider / model** → 读 [`pi-vendor/`](pi-vendor/index.md)
- **生成图像** → 读 [`pi-image-gen/`](pi-image-gen/index.md) 与 `packages/pi-image-gen/README.md`
- **后台跑命令** → 读 [`pi-background-terminal/`](pi-background-terminal/index.md)；三个独立工具，不影响内建 `bash`
- **让非视觉模型看图** → 读 [`pi-vision/`](pi-vision/index.md)；`image_ask` 精确问图 + opt-in 附件预分析 + `/vision` 配置
- **本地开发与测试** → 根 `README.md`；包级脚本用 `npm --workspace <name> ...`
- **历史审计与旧流程证据** → [`codestable/archive/codestable-legacy/`](../archive/codestable-legacy/)（只读档案，不是当前真相）

## 使用路径

- **给 pi 装本地扩展**：`pi install /abs/path/to/packages/<pkg>` 或 `pi -e ...` 试跑。
- **改搜索行为或安全边界**：先读 web-search 子 spec，再改 `packages/pi-web-search`；验证 `npm --workspace @bytetrue/pi-web-search test`。
- **改 image-gen 配置/Skill/CLI**：先读 image-gen 子 spec；保持 TUI 配置闭环、`settings.json` 存储与无常驻 Agent tool。
- **改 models.json 管理语义**：先读 vendor 子 spec；日常行为由 package Skill + bundled script 定义，冷启动行为在 TUI，配置事务与模型来源语义仍在共享 core。
- **改 background terminal**：先读 background-terminal 子 spec，再改 `packages/pi-background-terminal`；至少验证 typecheck、test、pack dry-run 与真实 Pi 回归。
- **发 background terminal npm 版**：bump `packages/pi-background-terminal/package.json` 版本后，push tag `pi-background-terminal-v<version>`；GitHub Actions `release.yml` 走 npm Trusted Publishing 自动发布。
- **发 pi-vision npm 版**：bump `packages/pi-vision/package.json` 版本后，push tag `pi-vision-v<version>`；同一 OIDC workflow 自动发布。
- **查“以前为什么这么定”**：closed epic/issue 在 `codestable/epics/`、`codestable/issues/`；完整旧 design/review 在 archive。

## 架构落点

| 包 | 支撑路径 | 配置位置 |
|---|---|---|
| `@bytetrue/pi-web-search` | agent 工具 `web_search`/`web_fetch`、`/web` | `~/.pi/byte-pi-web/config.json`（可用 `PI_CONFIG_DIR`） |
| `@bytetrue/pi-vendor` | Skill `pi-vendor`、按需脚本 `vendor.mjs`、冷启动命令 `/vendor` | `$PI_CODING_AGENT_DIR/models.json` 或 `~/.pi/agent/models.json` |
| `@bytetrue/pi-image-gen` | `/image-gen`、按需 Skill `pi-image-gen`、bundled CLI；零常驻 Agent tool | `~/.pi/agent/settings.json`、active agent dir 或可信 `<cwd>/.pi/settings.json` 的 `pi-image-gen` 节 |
| `@bytetrue/pi-background-terminal` | 工具 `background_run`/`background_status`/`background_kill` + 用户菜单 `/background`（不覆盖 `bash`） | 无独立持久配置；任务元数据在当前 Pi session 内存，输出落盘在 `$TMPDIR/pi-background-terminal/` |
| `@bytetrue/pi-vision` | 工具 `image_ask`、命令 `/vision`、`before_agent_start` / `tool_result` hooks | `settings.json` 的 `pi-vision.model` 与 `pi-vision.autoAnalyzeAttachments`（`/vision` 写全局层；可信 project 可覆盖） |
| `@bytetrue/pi-subagent` | 工具 `subagent`（单任务、并行、链式执行 + TUI 差分卡片） | 无独立持久配置；按需读取 `.pi/agents/*.md` 或单次参数覆盖 |

六包互不依赖；共同约定是：原子写 + 合理文件权限、不污染进程全局 fetch、失败不静默毁掉用户配置，以及局部能力不偷渡成 Pi core 依赖。

## 统一语言

- **workspace 包**：`packages/*` 下的 npm package；脚本用 `npm --workspace`。
- **project spec**：当前仍然成立的项目真相（本树）。
- **epic**：有边界的大变化活规格；关闭后结论毕业到 project spec。
- **issue**：一次可关闭的行动（feature / bug / chore / explore）。
- **archive / legacy**：旧 `.codestable` 全量迁入的只读证据，不当作活状态机。

## 阅读路径

- 新人理解仓库：本页 → 五个包的 README / 子 spec → 根 README
- 改 web-search：[`pi-web-search/index.md`](pi-web-search/index.md)
- 改 pi-vendor：[`pi-vendor/index.md`](pi-vendor/index.md)
- 改 pi-image-gen：[`pi-image-gen/index.md`](pi-image-gen/index.md)
- 改 background terminal：[`pi-background-terminal/index.md`](pi-background-terminal/index.md)
- 改 pi-vision：[`pi-vision/index.md`](pi-vision/index.md)
- 追溯已被取代的 dual-UI / Web 决策：closed epic [`codestable/epics/001-x-vendor-dual-ui-manager/spec.md`](../epics/001-x-vendor-dual-ui-manager/spec.md) 与 [`codestable/epics/002-x-vendor-web-productization/spec.md`](../epics/002-x-vendor-web-productization/spec.md)
- 追溯当前 AI-first 转向：epic [`codestable/epics/003-x-vendor-ai-first/spec.md`](../epics/003-x-vendor-ai-first/spec.md)

## 当前边界

**做**

- 维护五个扩展，并按需回归与发版
- 安全/正确性回归（SSRF、密钥权限、配置损坏保护、revision 冲突）
- 以 package-only 方式提供后台执行：三个独立且只含必填参数的 Agent 工具、输出落盘、session-scoped cleanup、自然完成自动通知、`/background` 用户菜单，全程不覆盖任何 Pi 原生工具
- 用新 CodeStable（`codestable/`）承载真相、epic、issue、notes

**不做**

- 不把 monorepo 变成通用 agent 平台或插件市场
- 不把旧 `.codestable` 流程工具当现行协议
- 不为 TUI 自研终端鼠标协议；不为 vendor 做常驻 daemon / 远程管理面板
- 不为 background terminal 依赖 tmux、PTY、core 改造或跨 Pi 退出持久化
- 不在未授权时 push、发布、改用户本机配置

## 架构考量

- **默认源码直装，单一例外**：多数扩展以 TS 源 + jiti 加载；`pi-image-gen` 构建 `dist`，让 extension 与 bundled Skill CLI 共享同一生产 core，不复制 provider 实现。
- **Worktree extension 隔离**：新 worktree 默认没有 `node_modules`，且 Pi 对 local package 按绝对路径判 identity；repo 不提交 `.pi/settings.json` 自动加载 workspace package，避免启动期缺依赖及与用户级来源重复注册 tools。`byspace.json` 在 worktree 创建后异步执行 `npm ci` 做开发环境准备；测试当前 worktree 源码前须等 setup 完成，再停用同名全局来源并隔离加载。
- **包隔离**：proxy、fetch dispatcher 不改全局，避免多扩展互踩。
- **background terminal 走 package-only**：复用 Pi 官方的 `createLocalBashOperations` 与内建 `read`，不重新实现 shell backend 或分页读取；不覆盖任何 Pi 原生工具，不把能力偷渡成 tmux 或 Pi core 依赖。
- **配置 fail-closed 写路径**：运行时可读可 soft-fail；交互写配置必须先证明基底有效。
- **真相分层**：稳定结论进 project spec；一次执行进 issue；大变更线进 epic；旧流水与 gate JSON 进 archive。

## 证据索引（按需）

- 根 `package.json` workspaces、`npm test`
- BySpace worktree 准备：`byspace.json`
- 本地 package / worktree 加载边界：`codestable/notes/005-pi-local-package-loading.md`
- `packages/pi-web-search`、`packages/pi-vendor`、`packages/pi-image-gen`、`packages/pi-background-terminal`、`packages/pi-vision`
- 已删除的 pi-ask-user 历史：`codestable/issues/043-x-ff-ask-user-question.md`、`codestable/issues/047-x-ff-remove-pi-ask-user.md`
- 图像生成 fork 许可及归因：`packages/pi-image-gen/LICENSE`、`packages/pi-image-gen/NOTICE`
- background terminal 历史重写：`codestable/issues/025-x-background-terminal-package.md`（第一版 PTY）、`codestable/issues/037-x-background-terminal-tool-selection.md`（第二版文案调优）、`codestable/issues/038-x-background-terminal-bash-override-redesign.md`（第二版覆盖 bash）；当前独立工具：`codestable/issues/039-x-background-terminal-standalone-tools.md`；不限时、清理与用户菜单：`codestable/issues/042-x-background-terminal-menu-lifecycle.md`
- Pi 本地包加载坑点：`codestable/notes/005-pi-local-package-loading.md`
- 自动发布工作流：`.github/workflows/release.yml`
- 迁移映射：`codestable/archive/MIGRATION.md`
- 旧体系全量：`codestable/archive/codestable-legacy/`
