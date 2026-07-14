# Project Spec

## 这个项目是什么

`pi-package-mono` 是个人用的 [pi coding agent](https://pi.dev) 扩展 monorepo。每个包以 TypeScript 源码通过 jiti 加载，不需要先 build 再安装。当前有两个已发布能力：

1. **网络检索与抓取**（`@bytetrue/pi-web-search`）：给 agent 提供 `web_search` / `web_fetch`。
2. **自定义模型供应商管理**（`@bytetrue/pi-vendor`）：用 TUI 快捷流 + 一次性本地 Web 管理器维护 `models.json`。

仓库用 **npm workspaces**（`packages/*`），不是 pnpm workspace。

## 当前方向

- 双界面 `pi-vendor` 主线已交付并关闭；剩余 UX polish 不在当前主线内。
- `pi-web-search` 已完成安全与预算类 hardening（SSRF、body 预算、proxy 隔离、无效配置保护等）。
- 近期优先：按需发版、修回归、补文档；不为“流程完整”重开已毕业能力。

## 能力地图

- **搜网页 / 抓页面** → 读 [`pi-web-search/`](pi-web-search/index.md)
- **管理自定义 provider / model** → 读 [`pi-vendor/`](pi-vendor/index.md)
- **本地开发与测试** → 根 `README.md`；包级脚本用 `npm --workspace <name> ...`
- **历史审计与旧流程证据** → [`.cs/archive/codestable-legacy/`](../archive/codestable-legacy/)（只读档案，不是当前真相）

## 使用路径

- **给 pi 装本地扩展**：`pi install /abs/path/to/packages/<pkg>` 或 `pi -e ...` 试跑。
- **改搜索行为或安全边界**：先读 web-search 子 spec，再改 `packages/pi-web-search`；验证 `npm --workspace @bytetrue/pi-web-search test`。
- **改 models.json 管理体验**：先读 vendor 子 spec；共享语义在 config / model-source / web-modal 三层，不要只改 TUI 或只改 Web。
- **查“以前为什么这么定”**：closed epic/issue 在 `.cs/epics/`、`.cs/issues/`；完整旧 design/review 在 archive。

## 架构落点

| 包 | 支撑路径 | 配置位置 |
|---|---|---|
| `@bytetrue/pi-web-search` | agent 工具 `web_search`/`web_fetch`、`/web` | `~/.pi/byte-pi-web/config.json`（可用 `PI_CONFIG_DIR`） |
| `@bytetrue/pi-vendor` | 命令 `/vendor`、`/vendor web` | `$PI_CODING_AGENT_DIR/models.json` 或 `~/.pi/agent/models.json` |

两包互不依赖；共同约定是：原子写 + 合理文件权限、不污染进程全局 fetch、失败不静默毁掉用户配置。

## 统一语言

- **workspace 包**：`packages/*` 下的 npm package；脚本用 `npm --workspace`。
- **project spec**：当前仍然成立的项目真相（本树）。
- **epic**：有边界的大变化活规格；关闭后结论毕业到 project spec。
- **issue**：一次可关闭的行动（feature / bug / chore / explore）。
- **archive / legacy**：旧 `.codestable` 全量迁入的只读证据，不当作活状态机。

## 阅读路径

- 新人理解仓库：本页 → 两个子包 index → 根与包 README
- 改 web-search：[`pi-web-search/index.md`](pi-web-search/index.md)
- 改 pi-vendor：[`pi-vendor/index.md`](pi-vendor/index.md)
- 追溯 dual-UI 决策：closed epic [`.cs/epics/2026/07/12/vendor-dual-ui-manager/spec.md`](../epics/2026/07/12/vendor-dual-ui-manager/spec.md)

## 当前边界

**做**

- 发布与维护上述两个 pi 扩展
- 安全/正确性回归（SSRF、密钥权限、配置损坏保护、revision 冲突）
- 用新 CodeStable（`.cs/`）承载真相、epic、issue、notes

**不做**

- 不把 monorepo 变成通用 agent 平台或插件市场
- 不把旧 `.codestable` 流程工具当现行协议
- 不为 TUI 自研终端鼠标协议；不为 vendor 做常驻 daemon / 远程管理面板
- 不在未授权时 push、发布、改用户本机配置

## 架构考量

- **源码直装**：扩展以 TS 源 + jiti 加载，减少发布构建面；vendor Web 静态资源是例外（`build:web` / `prepack`）。
- **包隔离**：proxy、fetch dispatcher 不改全局，避免多扩展互踩。
- **配置 fail-closed 写路径**：运行时可读可 soft-fail；交互写配置必须先证明基底有效。
- **真相分层**：稳定结论进 project spec；一次执行进 issue；大变更线进 epic；旧流水与 gate JSON 进 archive。

## 证据索引（按需）

- 根 `package.json` workspaces、`npm test`
- `packages/pi-web-search`、`packages/pi-vendor`
- 迁移映射：`.cs/archive/MIGRATION.md`
- 旧体系全量：`.cs/archive/codestable-legacy/`
