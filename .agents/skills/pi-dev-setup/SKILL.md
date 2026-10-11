---
name: pi-dev-setup
description: >
  为本仓库开发者做 Pi 项目级开发配置：把 packages/ 下所有扩展包按本地路径加载、
  屏蔽全局已安装的同名 npm 包，并把 small-extensions/ 的单文件扩展复制进项目
  .pi/extensions/。触发：开发调试本仓库扩展、pi-dev-setup、配置项目级 Pi、
  新 worktree 初始化 Pi 环境、全局装了同名包导致工具重复注册。
---

# pi-dev-setup

把本仓库（pi-package-mono）的开发者 Pi 环境一键配置到**项目级**，让本仓库源码
优先于全局安装。

## 它解决什么

- 新 worktree / 新克隆没有 `.pi/settings.json`：扩展包要么不加载，要么与全局
  npm 安装的同名包（`@bytetrue/*`）重复注册工具。
- 手写配置易错：本地路径条目与 npm 屏蔽条目必须成对出现，漏一个就撞工具重名。

## 怎么用

```bash
node .agents/skills/pi-dev-setup/setup.mjs
```

幂等：重复执行覆盖重建 `.pi/settings.json` 与 `.pi/extensions/` 下的副本，永远是
当前仓库状态。执行后重启或 /reload Pi。

## 它做什么（固定行为，无选项）

1. 扫描 `packages/*/package.json`，取有 `pi` 字段的包：
   - 写入项目级 `.pi/settings.json` 的 `packages`：本地相对路径条目
     （`../packages/<name>` 语义——按脚本所在仓库根解析的路径）；
   - 追加对应 npm 包的屏蔽条目（`source: "npm:@bytetrue/<name>"`，
     `autoload: false`，四类资源全 `!**`），使全局安装的同名包让位于本地源码。
2. 复制 `small-extensions/*/` 下每个单文件扩展的 `.ts`（package.json `files`
   列出的主文件）到 `.pi/extensions/`。
3. 输出做了什么的清单；不碰用户级 `~/.pi/agent/` 下的任何东西。

## 边界

- 只写项目内：`.pi/settings.json`、`.pi/extensions/`。
- 不提交产物：`.pi/` 整体在 .gitignore（`.agents/skills/` 才是跟踪的沉淀）。
- 不做版本管理、不做清理全局包、不做 npx 链接——那不是这个 Skill 的职责。
