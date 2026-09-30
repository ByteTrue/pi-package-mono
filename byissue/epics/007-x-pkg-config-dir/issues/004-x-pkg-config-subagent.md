---
kind: issue
title: "pi-subagent 配置从 Pi settings.json 节抽出为独立文件"
type: refactor
status: closed
created: 2026-09-30
closed: 2026-09-30
---

# pi-subagent 配置从 Pi `settings.json` 节抽出为独立文件

> **读者：** 接手配置统一的人——形状与 pi-vision 同源，多出「两个作用域都要写」和「历史 `subagents` 兼容形状」两件事。

## 目标与范围

包含：`packages/pi-subagent/src/settings.ts` 的路径、读写与迁移；`command.ts` 的作用域标签与提示；`index.test.ts` 及 settings 相关测试的隔离方式；README 的模型优先级段落里涉及配置位置的部分。

不包含：agent 文档（`.pi/agents/*.md`、`<agent dir>/agents/*.md`、`~/.pi/agents/*.md`）的扫描——那是内容模板不是包私有配置，明确不搬；角色配置结构、模型优先级链语义；legacy `subagents.agentOverrides` 的兼容读取。

## 落成的形状

- global 层：`<pkg-config 根>/pi-subagent/settings.json`，内容是该包小节去掉外层键，即 `{ "defaultModel"?, "defaultThinking"?, "agents"?: {...} }`。
- project 层：`<project>/.pi/pi-pkg-cfg/pi-subagent/settings.json`，只在用户在 `/subagent` 里显式选 project 作用域时创建；创建前先把老项目节（`<project>/.pi/settings.json` 的 `subagent` 节）整节搬进来再套改动；读取时若新项目文件缺失则只读回退到老项目节（不写用户仓库）。
- 老 global 位置：`<agent dir>/settings.json` 的 `subagent` 节（含 `subagents.agentOverrides` / `subagents.agents` 兼容形状）。
- 读仍是 global → project 覆盖（`defaultModel`/`defaultThinking` 用 `??`，`agents` 对象合并）；project 层继续以 `ctx.isProjectTrusted()` 为闸。
- `updateSubagentSettings` 在写入前做整节迁移（同 pi-vision），并**顺手补齐 `0600`**——它是四个包里唯一没有设 `mode` 的写盘点。
- 标注：生效值来自老路径时，`/subagent` 的 `Global — <path>` / `Project — <path>` 标签标注 `legacy (read-only fallback)`。
- 新文件坏 JSON：写 fail-closed、读 fail-soft（沿用现有 `readJsonFile` 返回 null 的形状）。

## 验证方式（计划）

- `npm --workspace @bytetrue/pi-subagent test` 与 `typecheck`；新增断言：global / project 两层的写入落点、老节整节迁移（`defaultModel` 不丢）、老项目节在新项目文件缺失时仍生效、untrusted 时不读项目层、新文件权限为 `0600`、legacy `subagents` 兼容形状仍能读。
- 真机：`/subagent` 走一遍 global 与 project 两条写入路径，确认文件落点与内容。

## 执行记录

`packages/pi-subagent/src/settings.ts` 整体重写路径与读写层；`parseSubagentSection` 的解析语义、角色配置结构、模型优先级链未动。

- 常量 `SETTINGS_KEY="subagent"`、`PKG_CONFIG_DIRNAME="pi-pkg-cfg"`、`PKG_DIRNAME="pi-subagent"`、`PKG_FILENAME="settings.json"`；`agentDir()`。
- `settingsPathForScope(cwd, scope)`：project → `<cwd>/.pi/pi-pkg-cfg/pi-subagent/settings.json`；global → `$PI_PKG_CFG_DIR` 或 `<agent dir>/pi-pkg-cfg` + `pi-subagent/settings.json`。**只定位写入目标、无副作用。**
- `legacySettingsPath(cwd, scope)`：project → `<cwd>/.pi/settings.json`；global → `<agent dir>/settings.json`。
- `settingsLocationForScope(cwd, scope): SettingsLocation`（做迁移决策）：新文件是 file → 新；老位置 missing → 新；老位置 invalid（坏 JSON / 非对象）→ `{path: legacy, legacy:true}`（读 fail-soft、写 fail-closed）；`parseSubagentSection(...)` 结果为空对象 → 新（不迁移）；**project 层 → legacy（只读，绝不写用户仓库）**；否则 `writeSectionFile(target, toStoredSection(settings), 0o600)` 整节原子写 → 新；写失败 → legacy。
- `describeSettingsPathForScope(cwd, scope)` 在 legacy 时输出 `<path> (legacy (read-only fallback))`。
- `readLocationSettings(location)`：非 valid 读 → `{}`；legacy 层用 `parseSubagentSection(value[SETTINGS_KEY], value)`，新文件层用 `parseSubagentSection(value)`（根对象即节本体）。
- `updateSubagentSettings(cwd, scope, updater)`：先 `readFileStrict(settingsPathForScope(...))`；invalid → 抛 `invalidJsonMessage`；valid → 解析当前节并**保留既有 mode**（`statSync(target).mode & 0o777`）；missing → 读老位置（invalid 则抛，valid 则整节带入，missing 则 `{}`）；最后 `writeSectionFile(targetPath, toStoredSection(updater(current)), mode)` —— **单次原子写**。
- `writeSectionFile`：`mkdirSync(dirname(path),{recursive:true,mode:0o700})` + `${path}.<uuid>.tmp` + `writeFileSync(tmp, JSON.stringify(section,null,2)+"\n", {encoding:"utf-8", mode})` + `renameSync`。
- **顺手补齐 `0600`**（issue 指定的四个包里唯一没设 mode 的写盘点）：新建文件默认 `0o600`，已有文件保留其 mode 不被强制覆盖。已由测试断言（0640 保留用例）。
- `listDiscoveredAgentNames(cwd)` 仅把内联 agent dir 解析换成 `agentDir()`，扫描面不变（`.pi/agents`、`<agent dir>/agents`、`~/.pi/agents` + 内置角色 + settings 里配置过的角色名）。**agent 文档不搬**（按 issue 的范围外条款）。
- 调用方：`command.ts:5,36,37,150` import 换成 `describeSettingsPathForScope`，两条作用域标签自动带 legacy 标注；`showConfig` 新增 `Settings file: <path>` 行。

**与设计的一处偏差（工具行为，非实现选择）**：RPC 模式下 `ctx.ui.custom()` 返回 `undefined`，fuzzy picker 退化为普通 `select`，所以「模型/thinking 选择器」只能用 TUI 验证。

## 验证

- `npm --workspace @bytetrue/pi-subagent test` —— **3 files / 47 tests 全绿**，其中新增 `settings.test.ts` 16 用例：写入落点是自家文件且 Pi `settings.json` 不被创建、新根 0700 / 新文件 0600、**保留既有 0640 mode**、`$PI_PKG_CFG_DIR` 移动 global 根而 project 层仍在项目内、老节整节搬出且 Pi 文件逐字节不变、只改一个值时继承键不丢、legacy `subagents.agentOverrides` 仍可读并迁移成现代形状、新文件存在即忽略老节、老文件坏 JSON 时读不抛而写抛 `/not valid JSON/`、新根建不出来时报 legacy 且读仍取老值、project 层写落在项目内且老项目文件不被创建、legacy 项目节只读回退、显式 project 写入时整节带入、trusted 时 project 覆盖 global 且其它角色合并、untrusted 时 project 层整层跳过。
- `index.test.ts` 两条 settings 用例补了 env 隔离（`withIsolatedConfig` helper，建临时 agent dir，保存/还原 `PI_CODING_AGENT_DIR` 与 `$PI_PKG_CFG_DIR`）。
- `npm run typecheck --workspaces --if-present` —— exit 0。
- 真机 TUI：`/subagent` → `Configure Default Subagent Model & Thinking` → `Global — /Users/zijie/.pi/agent/pi-pkg-cfg/pi-subagent/settings.json` / `Project — /Users/zijie/workspace/projects/pi-package-mono/.pi/pi-pkg-cfg/pi-subagent/settings.json`；沙箱里选 Global 写入 `{"defaultModel":"bytetrueapi/test-model","defaultThinking":"high"}`（0600），沙箱 Pi `settings.json` 只多出 Pi 自己写的 `lastChangelogVersion`。
- **project 作用域真机验证**（预置老项目节 `{subagent:{defaultModel:"legacy/project-model",agents:{reviewer:{thinking:"minimal"}}}}`）：作用域标签显示 `Project — <cwd>/.pi/settings.json (legacy (read-only fallback))`，选择器标题显示 `(Current: legacy/project-model)`（老项目节被读到）；选 Project 后落 `<cwd>/.pi/pi-pkg-cfg/pi-subagent/settings.json` = `{"defaultModel":"bytetrueapi/deepseek-flash","defaultThinking":"medium","agents":{"reviewer":{"thinking":"minimal"}}}` —— **整节搬老项目节**（reviewer 继承）✓；老项目文件逐字节未变 ✓；global 文件未创建 ✓。
- **Q25 整节迁移的真机复现**（隔离 agent dir 预置老 `subagent` 节 `{defaultModel:"bytetrueapi/legacy-model",defaultThinking:"low",agents:{reviewer:{thinking:"max"}}}`）：`/subagent` → `Show Current Configuration` 读出 `Default Thinking: low`、`• reviewer: model=default, thinking=max`，新文件整节搬入。
- 降级：发布版 `pi-subagent@0.9.1` 在隔离沙箱里 `Show Current Configuration` 仍读老 `subagent` 节（`bytetrueapi/legacy-model` / `low` / `reviewer thinking=max`）。

## 关闭结论

- **判断**：pi-subagent 的 `subagent` 节抽出为独立文件（global 可写 + project 只在显式写入时创建），并补齐 `0600`；历史 `subagents` 兼容形状与上游 `env` 字段一并保留。无遗留。
- **验证**：3 files / 54 tests 全绿（含新增 `settings.test.ts` 16 用例，脚本内 hermetic agent dir + `PI_PKG_CFG_DIR` 隔离）；project 作用域真机验证 `Project — <cwd>/.pi/settings.json (legacy (read-only fallback))`、整节搬入、老文件未变、global 未创建；发布版 0.9.1 降级仍读老节。与上游 0.10.0（角色改名、`subagent.env`）合并后 `toStoredSection` 保留 `env` 键。
- **回写**：`byissue/spec/pi-subagent/index.md` 与 `byissue/spec/index.md`（issue 005 已改）。
- **遗留**：无。
