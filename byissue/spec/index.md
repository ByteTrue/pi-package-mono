# Project Spec

## 这个项目是什么

`pi-package-mono` 是个人用的 [Pi coding agent](https://pi.dev) 扩展 monorepo。当前源码树保留 **两个独立 npm 包** 与一组 small-extensions；包以 TypeScript 源码通过 jiti 加载，没有 package build step。

1. **背景终端**（`@bytetrue/pi-background-terminal`）：纯后台执行——`background_run` 立即返回 task id，退出时 followUp 唤醒（含退出码与末行）；`timeout` 默认 600s 总寿命硬杀，dev server 可传更大值。内建 `bash`/`powershell` 不被覆盖，前台 timeout 安全网属于 small-extension `pi-bash-timeout`。
2. **轻量子智能体调度**（`@bytetrue/pi-subagent`）：`subagent` / `subagent_status` / `subagent_stop` 在隔离子进程会话里运行任务；纯后台，结果以新消息送达，并行靠同一条消息里的多个调用。

`small-extensions/` 是不发布 npm 的单文件扩展集合，当前包括 `pi-bash-timeout`、`pi-goal`、`pi-ask-user`、`pi-context-guard`、`pi-vendor`；它们只在 root workspaces 中以便 CI 做 typecheck/test。

图像生成、识图与 Web 访问已迁移到 [Satchel](https://github.com/ByteTrue/satchel)。`pi-vendor` 因拥有 Pi 的 `models.json` 与 `/vendor` TUI，改为本仓 `small-extensions/pi-vendor`。四个旧 npm 版本继续可用，但原 package 源码、CI 和 release tag 已退役；历史 Epic/Issue 保留。

仓库使用 **npm workspaces**（`packages/*`、`small-extensions/*`），不是 pnpm workspace。

## 当前方向

- 维护 background terminal、subagent 与 small-extensions 的独立性、回归和按需发版。
- 高频 Agent 工具保持小而显式；用户菜单负责 `/background`、`/subagent` 的配置与状态闭环。
- 小扩展維持不发 npm、直接复制进 `~/.pi/agent/extensions/` 即可运行（无需 `npm install`），因此不依赖第三方 npm 包或未随同安装的仓库文件（`node:*` 内置模块始终可用）。
- 已迁移能力只在 Satchel 继续演化，避免两个仓库的协议与配置实现漂移。

## 能力地图

- **后台任务** → 读 [`pi-background-terminal/`](pi-background-terminal/index.md) 与 `packages/pi-background-terminal/README.md`
- **子智能体** → 读 [`pi-subagent/`](pi-subagent/index.md) 与 `packages/pi-subagent/README.md`
- **前台 shell 300s 安全网** → 读 [`pi-bash-timeout/`](pi-bash-timeout/index.md)
- **长任务自驱动** → 读 [`pi-goal/`](pi-goal/index.md)
- **vendor TUI、提示词命令与 models.json 事务** → 读 [`pi-vendor/`](pi-vendor/index.md) 与 `small-extensions/pi-vendor/README.md`
- **小扩展安装与开发** → 根 `README.md`、`small-extensions/`、`scripts/install-small-extension.mjs`
- **历史决策与已迁移能力** → `byissue/epics/`、`byissue/issues/`、`byissue/decisions/`

## 架构落点

| 包 | 支撑路径 | 配置位置 |
|---|---|---|
| `@bytetrue/pi-background-terminal` | 独立工具 `background_run` / `background_status` / `background_kill`，用户菜单 `/background` | 无独立持久配置；任务元数据在当前 Pi session 内存，输出落盘在 `$TMPDIR/pi-background-terminal/` |
| `@bytetrue/pi-subagent` | 工具 `subagent` / `subagent_status` / `subagent_stop` | `<pkg-config 根>/pi-subagent/settings.json` 的 `defaultModel` / `defaultThinking` / `agents[角色]` / `env`；可信项目层 `<project>/.pi/pi-pkg-cfg/pi-subagent/settings.json`；角色文档按需读取 `.pi/agents/*.md` 与 `<agent dir>/agents/*.md` |

包之间不依赖；共同约定是原子写、合理文件权限、不污染进程全局 fetch、失败不静默毁掉用户配置，以及局部能力不偷渡成 Pi core 依赖。

## 使用与发布路径

- **本地扩展开发**：`pi install /abs/path/to/packages/<pkg>` 或 `pi -e ...` 试跑。
- **改 background terminal**：先读其子 Spec；至少验证 typecheck、test、pack dry-run 与真实 Pi 回归。
- **改 subagent**：先读其子 Spec；验证 typecheck/test 与工具 schema、后台通知路径。
- **发 npm 版**：仅保留 `pi-background-terminal-v<version>` 与 `pi-subagent-v<version>` 两类 tag，由 `.github/workflows/release.yml` 通过 npm Trusted Publishing 发布。
- **安装 small-extension**：`scripts/install-small-extension.mjs` 从 GitHub raw 安装单文件；installer 列表与目录由 CI gate 保持一致。

## 统一语言

- **workspace 包**：`packages/*` 下的 npm package；脚本用 `npm --workspace`。
- **small-extension**：`small-extensions/*` 下的私有单文件扩展，不发布 npm。
- **project spec**：当前仍成立的项目真相（本树）。
- **epic**：有边界的大变化活规格；关闭后结论毕业到 project spec。
- **issue**：一次可关闭的行动（feature / bug / chore / explore）。
- **pkg-config 根**：`$PI_PKG_CFG_DIR` 或 `<agent dir>/pi-pkg-cfg`；本仓包私有配置的唯一写入位置。
- **legacy 回退**：迁移前的位置只读、只回退、永不搬迁；新文件一存在老位置即不再参与读取。生效值来自老路径时，状态输出与报错写明 `legacy (read-only fallback): <path>`。

## 当前边界

**做**

- 维护两个包与 small-extensions，并按需回归和发版。
- 安全/正确性回归（密钥权限、配置损坏保护、revision 冲突、后台生命周期）。
- 以 package-only 方式提供后台执行与子智能体，不覆盖 Pi 原生工具。
- 用 ByIssue（`byissue/`）承载真相、epic、issue、notes。

**不做**

- 不恢复 image-gen/vision/web-search 的普通 package，也不把 vendor 迁往 Satchel，除非有新的明确决策。
- 不把 monorepo 变成通用 Agent 平台或插件市场。
- 不为 background terminal 依赖 tmux、PTY、core 改造或跨 Pi 退出持久化。
- 小扩展不得添加 npm 发布配置，也不得静态 import 第三方 npm 包或未随安装器复制的仓库文件。
- 不在未授权时 push、发布、改用户本机配置。

## 架构考量

- **源码直装**：两个包均以 TS 源 + jiti 加载，无构建产物需要同步。
- **Worktree extension 隔离**：新 worktree 默认没有 `node_modules`；`.pi/settings.json` 由 `pi-dev-setup` 在 `npm ci` 后生成且不跟踪，避免启动期缺依赖及与全局同名包重复注册。
- **包隔离**：proxy、fetch dispatcher 不改全局，避免多扩展互踩。
- **配置 fail-closed 写路径**：运行时可读可 soft-fail；交互写配置必须先证明基底有效。
- **项目级 Pi 配置由 Skill 生成**：`.agents/skills/pi-dev-setup/setup.mjs` 扫描当前包生成 `.pi/settings.json` 并复制小扩展；产物漂移靠重跑而非手改。
- **真相分层**：稳定结论进 project spec；一次执行进 issue；大变更线进 epic；旧流水与 gate JSON 进 archive。

## 证据索引（按需）

- 根 `package.json` workspaces、`npm test`、`.github/workflows/ci.yml`
- 当前包：`packages/pi-background-terminal`、`packages/pi-subagent`
- 本地 package / worktree 加载边界：`byissue/notes/005-pi-local-package-loading.md`
- background terminal 历史：`byissue/issues/039-x-background-terminal-standalone-tools.md`、`byissue/issues/042-x-background-terminal-menu-lifecycle.md`
- 自动发布工作流：`.github/workflows/release.yml`
- 旧体系与已迁移能力的完整历史：`byissue/archive/`、`byissue/epics/`、`byissue/issues/`
