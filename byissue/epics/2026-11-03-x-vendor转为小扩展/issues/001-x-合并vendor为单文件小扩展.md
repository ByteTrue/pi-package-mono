---
kind: issue
title: "合并 vendor 为单文件小扩展"
type: feature
created: 2026-11-03
---

# 合并 vendor 为单文件小扩展

## 范围

将原 pi-vendor 的 TUI 与配置核心打成 single-file small-extension，同时内嵌原提示词为 `/vendor-ai` 命令，并由安装器在扩展旁带上 bundled scripts；迁移核心/prompt-command/CLI 测试与开发声明，更新安装器和文档，撤销 Satchel vendor Skill。

## 验证

- 单文件只导入 Node builtins 与 Pi 宿主包，无 repo-relative imports。
- strict typecheck、迁移核心/prompt-command/CLI 测试、全 workspace 回归和安装器/README gates 通过。
- 本机 Satchel vendor Skill 移除，小扩展安装后 `/vendor` 可加载；非 TUI 降级实测，完整 TUI 边界明确。

## 执行记录

已完成 `small-extensions/pi-vendor/pi-vendor.ts` 单文件实现：保留 `/vendor` 完整 TUI、catalog/discovery、models.json SHA-256 optimistic lock 与 model registry refresh。原提示词内嵌在 `pi-vendor.ts` 并注册 `/vendor-ai`；`vendor.mjs`/`vendor-shared.js` 作为相对资源安装到 `~/.pi/agent/extensions/pi-vendor/scripts/`，不使用原生 Skill。

关键实现：

- 生产模块打成单文件；`types/` 声明只用于 strict 开发测试，安装器只取 `.ts`。
- 静态 runtime imports 仅 Node builtins；Pi TUI 与 bash operations 通过现有宿主定位逻辑动态加载，解决裸 `~/.pi/agent/extensions/pi-vendor.ts` 无 node_modules 的解析问题。
- 16 个核心测试文件迁移到单文件导出，另保留 CLI 测试并新增 `/vendor-ai` 测试。catalog loader 改为显式测试注入，保留 strict 类型与原测试语义。
- 安装器、README、AGENTS、现行 Spec 均加入 pi-vendor；release workflow 仍无 vendor npm tag。
- Satchel vendor Skill、本机注册和 Skill CI 检查已移除，Satchel Go test/vet/actionlint 通过。

验证：

- pi-vendor strict typecheck 通过，17 文件 / 205 测试全部通过；包含 `/vendor-ai` 提示词与符号链接入口回归。
- 全 workspace typecheck/test 通过（background 42、subagent 92、其他 small ext 81、vendor 204）；README/installer gates 和 actionlint 通过。
- 全局安装的单文件无 repo-relative imports；独立加载并查询官方 catalog 返回 `kimi-for-coding`。
- 直接调用注册的 `/vendor` 在非 TUI 下返回明确降级错误，未写 models.json。
- 使用 expect/pseudo-terminal 实际打开 `/vendor`，看到 **Manage providers and models / Add provider / Add model** 菜单后 Esc；TUI 主入口实测通过。
- 隔离 Pi 配置中以 `--no-skills` 实际调用 `/vendor-ai`：Agent 收到内嵌提示词，执行 `~/.pi/agent/extensions/pi-vendor/scripts/vendor.mjs` 并返回 `kimi-for-coding`；models.json 未改变。脚本 main-entry 改用 realpath，修复 macOS `/tmp` 符号链接下不执行的问题。

最终 review 发现 `/vendor-ai` 占位符被二次替换导致路径重复；已改为仅对完整占位符做一次 POSIX shell quoting，并增加精确 `node '<script>' catalog` 断言。生成命令已人工检查，17 文件 / 205 测试复跑通过，最终独立复核 **PASS / No issues found**。Issue 保持 open，尚未提交或推送。

## 关闭结论

`pi-vendor` 已合并为 `small-extensions/pi-vendor/pi-vendor.ts`（含 `/vendor` TUI、`/vendor-ai` 提示词命令、models.json 乐观锁事务）及相对目录 `scripts/vendor.mjs`，205 项测试与独立复核全部通过，经用户授权关闭。
