# FF: 配置 BySpace worktree 准备

## Context

repo 已移除 `.pi/settings.json` 的 workspace extension 自动加载，Pi 启动不再依赖新 worktree 的 npm dependencies。用户仍希望 BySpace 在创建 worktree 后自动准备开发环境。

## Goal

让 BySpace 为新 worktree 自动安装 lockfile 对应的 workspace dependencies。

## Change

新增 repo 根 `byspace.json`：

```json
{
  "worktree": {
    "setup": "npm ci"
  }
}
```

不复制 `.env`、不启动 service、无 teardown：当前 monorepo 没有这些准备需求。

## Evidence

- 配置通过 JSON 解析与 BySpace 0.2.1 schema/loader 验证。
- `npm ci` 已在实际 BySpace worktree `snappy-blowfish` 成功安装 201 packages。
- 配置语义明确为 session 创建后的异步准备；Pi extension 启动不依赖 setup 完成。

## Closure

Closed. 新 BySpace worktree 会自动开始 `npm ci`；使用本地 workspace extension 前仍须等待 setup 完成并保持 package 单来源。
