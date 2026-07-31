# FF: Worktree 中 extension 缺依赖与重复加载

## Context

BySpace 新建 `snappy-blowfish` git worktree 后立即启动 Pi RPC。repo 的 `.pi/settings.json` 自动加载该 worktree 中的 `pi-background-terminal` TS 源，但新 worktree 没有 `node_modules`，首个 runtime import `ws` 报 `Cannot find module`。手动安装依赖后继续复现，又暴露出用户级主 checkout package 与项目级 worktree package因绝对路径不同而同时加载，五个 `pty_*` tool 冲突。

## Goal

确保新 worktree 的 Pi 正常启动不依赖该 worktree 预先安装 npm dependencies，并且只加载一个 `pi-background-terminal` 来源。

## Change

- 删除 repo 的 `.pi/settings.json` 本地 package 自动加载；正常启动由用户级 package 来源提供。
- 删除 `.gitignore` 中对 `.pi/settings.json` 的反向例外，防止本地开发配置被误提交并恢复冲突。
- 测试当前 checkout 的 extension 时，先显式 `npm ci`，再停用同名全局来源并隔离加载。
- 未新增 BySpace setup hook：0.2.1 的 setup 在 agent session 创建后异步执行，不能作为 extension 启动前置 gate。
- 未改 package dependency：`ws` 与 `@lydell/node-pty` 原本已正确列在 `dependencies` 和 lockfile 中。

## Evidence

- 原始 worktree：root/package 均无 `node_modules`，Pi 报 `Cannot find module 'ws'`。
- 在原始 worktree执行 `npm ci`：成功安装 201 packages。
- 继续正常启动可复现主 checkout 与 worktree 两个 local package 的五项 `pty_*` tool conflict。
- 忽略项目级 autoload、仅用户级来源启动：Pi RPC `get_state` 成功，0 extension errors，stderr 为空。
- 当前 worktree extension 在 `npm ci` 后隔离加载：Pi RPC `get_state` 成功，0 extension errors，stderr 为空。
- `require.resolve` 从当前 worktree package 成功解析 `ws` 与 `@lydell/node-pty`。
- 全 workspace typecheck 与 tests 通过。

## Closure

Closed. 这是 worktree package source 与启动时机问题，不是缺少 dependency 声明或版本冲突。
