# Pi 本地 package 路径与去重

## 结论

项目级 `.pi/settings.json` 里的本地 package 路径是**相对 `.pi/` 目录**解析的，所以 workspace 包要写成 `../packages/<name>`，不要写 `./packages/<name>`。Pi 对 local package 按解析后的绝对路径判 identity，主 checkout 与 git worktree 因而是两个来源；它们与全局同名包同时加载会造成 extension/tool 冲突。做本地包开发时只保留一个来源生效，本 repo 不再提交自动加载 workspace package 的 `.pi/settings.json`。

## 触发场景

- 在 repo 里用 `.pi/settings.json` 加载 `packages/*` 本地包
- `/reload` 后扩展没加载、路径报错或提示找不到模块
- 工具名冲突（例如全局与本地同时注册同名 tool）

## 细节

- `.pi/settings.json` 位于 `.pi/` 下，所以：
  - 正确：`"../packages/pi-background-terminal"`
  - 错误：`"./packages/pi-background-terminal"`
- 若全局已装 `npm:@bytetrue/pi-web-search`、`npm:@bytetrue/pi-vendor` 等，再额外在项目里启用同名本地路径包，Pi 会把两份 extension 都加载，导致 `Tool "..." conflicts with ...`。
- local package 的 identity 是解析后的绝对路径。同一 repo 的主 checkout 与 git worktree 路径不同，因此也不会去重；需要测试本地 extension 时，先停用全局同名来源，再显式加载当前 checkout。
- 新 worktree 默认没有 `node_modules`。需要测试当前 worktree 的本地 TS extension 时，先在该 worktree 执行 `npm ci`，再停用同名全局来源并显式隔离加载；不要把主 checkout 的 `node_modules` 软链过去，也不要让 package 偷用 Pi 或其他 workspace 的传递依赖。
- BySpace 0.2.1 的 `worktree.setup` 在 agent session 创建后异步运行，不是 extension 启动前置 gate，不能依赖它修复启动期 import。

## 相关位置

- 用户级 `~/.pi/agent/settings.json` / `pi config`（正常启动只保留一个 package 来源）
- `npm ci`（测试当前 worktree 源码前显式执行）
- `.cs/issues/2026/07/23/closed-background-terminal-package.md`
- `.cs/spec/pi-background-terminal/index.md`
