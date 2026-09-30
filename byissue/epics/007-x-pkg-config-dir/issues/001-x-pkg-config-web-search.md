---
kind: issue
title: "pi-web-search 配置迁到 <pkg-config 根>，建立约定参考实现"
type: refactor
status: closed
created: 2026-09-30
closed: 2026-09-30
---

# pi-web-search 配置迁到 `<pkg-config 根>`，建立约定参考实现

> **读者：** 接手配置统一的人——这个包是四个里最简单的迁移（整份文件搬家），也是约定的参考实现；后面三个包照它的形状做。

## 目标与范围

包含：`packages/pi-web-search/src/config.ts` 的路径解析与迁移；`config-file.test.ts` / `live.e2e.test.ts` / `tools.ts` 的路径断言；README 的配置位置段落。

不包含：配置 schema、任何 provider 行为、`PI_CONFIG_DIR` 的废弃（它继续作为**老位置定位**变量保留）。

## 落成的形状

- 新位置：`<pkg-config 根>/pi-web-search/config.json`，其中 `<pkg-config 根>` = `$PI_PKG_CFG_DIR`（trim 后非空）或 `<agent dir>/pi-pkg-cfg`，`<agent dir>` = `$PI_CODING_AGENT_DIR`（trim 后非空）或 `~/.pi/agent`。
- 老位置：`($PI_CONFIG_DIR 或 ~/.pi)/byte-pi-web/config.json`。`$PI_CONFIG_DIR` 从此**只**用于定位老文件，不再影响写入位置。
- 三处行为：
  1. **读**：新文件存在就用它；否则老文件存在且能解析成 JSON 时，把它整份**逐字节**原子复制到新位置，再用新位置的值；老文件坏 JSON 时报告 invalid 并指向老路径（不复制垃圾）。
  2. **写**：一律写新位置（原子 temp+rename、`0600`）。调用方都是先读后整体写，所以不需要额外 seed；若新位置建不出来（只读 FS），`writeConfig` 继续返回 `false`，不抛。
  3. **标**：生效值来自老路径时，`getConfigPath()` 返回老路径并在状态输出中标注 `legacy (read-only fallback)`——`/web` 状态行与「Failed to save ... to <path>」错误文案都走它。
- `const CONFIG_PATH` 这个 import 时求值的模块级常量要改成函数（路径现在依赖运行时的文件存在性判断），`vi.resetModules() + vi.stubEnv` 的测试写法保留。

## 验证方式（计划）

- `npm --workspace @bytetrue/pi-web-search test`（含新增：新位置优先、老文件整份搬过来后逐字节相等、老文件仍在原位、坏 JSON 不覆盖、`$PI_PKG_CFG_DIR` 优先于 agent dir、无 env 时落 `~/.pi/agent/pi-pkg-cfg`）。
- `npm --workspace @bytetrue/pi-web-search typecheck`。
- 真机：把 `~/.pi/byte-pi-web/config.json`（含 tavily key）走一遍迁移，确认新文件内容一致、旧文件未动、`/web` 状态行显示新路径。

## 执行记录

**落成的形状与设计一致**，三处行为都在 `packages/pi-web-search/src/config.ts`：

- 新增 `PKG_CONFIG_DIRNAME/PKG_DIRNAME/PKG_FILENAME/LEGACY_DIRNAME`、`agentDir()`、`pkgConfigRoot()`、`newConfigPath()`、`legacyConfigPath()`；入口是 `configLocation(): WebConfigLocation`（`{path, legacy}`）。
- 读：`configLocation()` 先看新文件；否则读老文件——坏 JSON **不搬运**（就地报 invalid，`{legacy:true}` 指向老路径）；能解析才 `mkdirSync(dir, {recursive:true, mode:0o700})` + temp `0600` + `renameSync` 逐字节搬。
- 写：`getWritableConfigPath()` 恒返回新路径，`writeConfig()` 不碰老文件。
- 标：`describeConfigPath()` 在 legacy 时输出 `<path> (legacy (read-only fallback))`。
- 调用方：`packages/pi-web-search/src/tools.ts:14-17` import 换成 `describeConfigPath/getWritableConfigPath`；`:209` 的状态行与五处 save 失败通知（`:246,:274,:314,:378,:392`）分别改用二者。原 `getConfigPath` 的 import 已从 `tools.ts` 删除。

**与设计的两点偏差：**

1. 计划里「`/web --show` 显示 legacy 标注」原本打算用坏 JSON 触发，实际被 `tools.ts:327` 的 invalid-config guard 提前拦截并报 `Could not parse ... Fix or remove the config file before using /web.`，拿不到标注 —— 测试改为**让新根建不出来**（在 `pi-pkg-cfg` 位置放一个普通文件使 `mkdirSync` 失败）来触发真正的回退路径。
2. `isFile()` 用 `statSync(path).isFile()` 而非 `existsSync`：后者对目录也为真。

## 验证

- `npm --workspace @bytetrue/pi-web-search test` —— **12 passed + 1 skipped files / 115 passed + 9 skipped tests**。`config-file.test.ts` 整份重写，覆盖：新根读写且老文件不被创建、`$PI_PKG_CFG_DIR` 未设时回落 `<agent dir>/pi-pkg-cfg`、`PI_CODING_AGENT_DIR` 也未设时回落 `~/.pi/agent/pi-pkg-cfg`、老文件**逐字节**复制且原件保留、新文件存在即忽略老文件、坏 JSON 老文件就地报 invalid 不复制（新文件不出现）、missing/valid 区分、malformed/schema-invalid、两条 `/web` 菜单选择断言落盘 JSON、proxy 掩码两条、invalid-config guard 不泄露 token。
- `npm run typecheck --workspaces --if-present` —— exit 0。
- 真机：`~/.pi/byte-pi-web/config.json`（132B，含 tavily 明文 key）→ `~/.pi/agent/pi-pkg-cfg/pi-web-search/config.json`，`sha256` 双方均为 `5769d8491375a3cc7e9f7a10b0d75262b3ce39ce0bef9f386dc7a206956ed519`（逐字节相同）；RPC 跑 `/web --show` 输出 `config file: /Users/zijie/.pi/agent/pi-pkg-cfg/pi-web-search/config.json`、`provider chain: tavily -> exa-free`、key 掩码 `tvly...ddN4`；老文件 sha256 全程未变。
- 降级：发布版 `pi-web-search@0.4.1`（`~/.pi/agent/npm/node_modules/@bytetrue/`）在隔离沙箱里 `/web --show` 仍指向 `~/.pi/byte-pi-web/config.json`。

## 关闭结论

- **判断**：`<pkg-config 根>` 的定义与三处行为（读回退 / 只写新位置 / legacy 标注）已落成参考实现，后三个包照此形状做完；本 issue 无遗留。
- **验证**：包测试 12 passed + 1 skipped files / 115 passed + 9 skipped（9 skipped 为既有 live E2E 网络依赖，本次 diff 未碰）；typecheck exit 0；真机老→新 `sha256 5769d849...` 两端一致、老文件全程未变；发布版 0.4.1 降级仍读老路径。
- **回写**：约定本体在 `byissue/decisions/004-pkg-config-dir.md`；落点描述在 `byissue/spec/index.md` 架构落点表与 `byissue/spec/pi-web-search/index.md`（issue 005 已改）。
- **遗留**：无。
