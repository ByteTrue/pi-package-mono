# Pi 本地 package 路径与去重

## 结论

项目级 `.pi/settings.json` 里的本地 package 路径是**相对 `.pi/` 目录**解析的，所以 workspace 包要写成 `../packages/<name>`，不要写 `./packages/<name>`。另外，Pi **不会**把项目本地路径包与全局已安装的同名包自动去重；两边同时加载会造成 extension/tool 冲突。做本地包开发时，只保留一个来源生效。

## 触发场景

- 在 repo 里用 `.pi/settings.json` 加载 `packages/*` 本地包
- `/reload` 后扩展没加载、路径报错或提示找不到模块
- 工具名冲突（例如全局与本地同时注册同名 tool）

## 细节

- `.pi/settings.json` 位于 `.pi/` 下，所以：
  - 正确：`"../packages/pi-background-terminal"`
  - 错误：`"./packages/pi-background-terminal"`
- 若全局已装 `npm:@bytetrue/pi-web-search`、`npm:@bytetrue/pi-vendor` 等，再额外在项目里启用同名本地路径包，Pi 会把两份 extension 都加载，导致 `Tool "..." conflicts with ...`。
- 新增 workspace 依赖后要先跑一次 `npm install`，否则本地 TS 源扩展可能在 reload 时缺依赖。

## 相关位置

- `.pi/settings.json`
- `.cs/issues/2026/07/23/closed-background-terminal-package.md`
- `.cs/spec/pi-background-terminal/index.md`
