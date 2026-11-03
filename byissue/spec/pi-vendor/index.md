# pi-vendor

## 当前形态

`pi-vendor` 是 **Pi 专用 small-extension**，位于 `small-extensions/pi-vendor/`。安装器提供单文件 `pi-vendor.ts`（`/vendor` TUI、内嵌 `/vendor-ai` 提示词命令与配置事务），并把 `vendor.mjs`、`vendor-shared.js` 安装到 `~/.pi/agent/extensions/pi-vendor/scripts/`。它不是 Satchel Skill，也不依赖原生 Skill 发现，不是 npm 发布包。

原 `@bytetrue/pi-vendor` npm 包的提示词内嵌在扩展中，`vendor.mjs` CLI 作为相对资源保留；package release 路径退役。旧 npm 版本仍可使用，但新开发只在 small-extension 上进行。

## 为什么不是普通小工具或 Satchel 能力

- 它直接拥有 Pi 的 `$PI_CODING_AGENT_DIR/models.json`（默认 `~/.pi/agent/models.json`）读写、revision 校验和保存后的 `modelRegistry.refresh()`。
- `/vendor` 必须在 Pi interactive TUI 中运行，非交互模式只给出直接编辑文件的提示。
- 完整 TUI 使用 `@earendil-works/pi-tui` 的分页选择组件；配置与 catalog 定位需要 Node builtins。

由于 `~/.pi/agent/extensions/` 下没有独立的 `node_modules`，`pi-vendor.ts` 仅直接导入 `node:*` 内置模块，并通过定位当前运行的 Pi 安装目录按需加载宿主内置的 `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-tui`，无需 `npm install` 即可直接放入 `extensions/` 使用。

## 文件与事务边界

- 入口只注册 `/vendor` 与 `/vendor-ai`，不注册 Agent tools 或生命周期 hooks。`/vendor-ai` 通过 `registerCommand + sendUserMessage` 把内嵌提示词和用户参数发给 Agent，并在提示词中写入 bundled script 的实际绝对路径。
- 配置写走 `readModelsSnapshot` / `commitModelsSnapshot` 的 SHA-256 optimistic lock；并发变化必须报 `config_changed`，不能覆盖。
- 原子写、合理权限、坏配置 fail closed；保存后刷新 model registry 并报告 Pi 的兼容性错误。
- Provider/model 编辑保持窄修改，不整份改写无关字段。
- catalog/discovery、API/baseURL、模型默认参数和凭据配置沿用原 TUI 流程。
- 凭据不进入 Agent 对话或状态输出；非交互 secret 输入不由 Agent 代跑。

## 单文件与类型

`pi-vendor.ts` 是原生产模块的单文件 bundle，包含提示词文本，运行时不依赖原 package 目录。脚本只引用同目录 `vendor-shared.js`。`types/` 下的声明只用于 strict typecheck 和测试，不由安装器分发。测试从 package self-reference 导入单文件实现，同时用声明保留类型安全；prompt command 与 bundled CLI 也有独立测试。

## 验证

```bash
npm --workspace pi-vendor run typecheck
npm --workspace pi-vendor test
node scripts/check-small-extension-installer.mjs
```

核心测试覆盖配置事务、模型来源、catalog/discovery、TUI flows、prompt command 与 bundled CLI。真实 `/vendor` 交互测试、`/vendor-ai` 实际调用与非 TUI 降级分开记录；不把非交互 smoke 说成完整 TUI 验收。
