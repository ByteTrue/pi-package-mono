---
kind: issue
title: "pi-image-gen 配置迁到 <pkg-config 根>，v1 迁移与 .v1.bak 落点澄清"
type: refactor
status: closed
created: 2026-09-30
closed: 2026-09-30
---

# pi-image-gen 配置迁到 `<pkg-config 根>`，v1 迁移与 `.v1.bak` 落点澄清

> **读者：** 接手配置统一的人——这个包已经是「专用文件」形状，本 issue 只是把那个文件换个父亲目录，并把 `PI_AGENT_HOME` 降级为「只用来找老文件」。

## 目标与范围

包含：`packages/pi-image-gen/src/settings.ts` 的路径与迁移；`__tests__/settings.test.ts`、`__tests__/config-command.test.ts`、`__tests__/cli.test.ts` 的路径断言；README 的配置位置与迁移段落。

不包含：v2 数据形状、菜单、CLI 参数、`migrate.ts` 的 v1→v2 语义（原样复用）。

## 落成的形状

- 新位置：`<pkg-config 根>/pi-image-gen/settings.json`（`<pkg-config 根>` 定义见 `001-x-pkg-config-web-search.md`）。
- 老位置：`($PI_CODING_AGENT_DIR 或 $PI_AGENT_HOME 或 ~/.pi/agent)/pi-image-gen/settings.json`。`$PI_AGENT_HOME` 从此只参与定位老文件。
- 迁移：新文件缺失且老文件存在且能解析成 JSON 时，把老文件**逐字节**原子复制到新位置，再走既有 `loadSettings` —— 于是 v1→v2 的整份重写与 `.v1.bak` 都发生在**新目录**里，老文件保持原样（它本身就是 v1 的备份，不需要再搬一份）。
- `version > SETTINGS_VERSION` 的拒绝语义不变：新位置读到更高版本仍然 fail-closed。
- `imageGenSettingsPath()` 继续作为唯一路径源，改成同时暴露新/老两个解析结果（`Target:` / `Config file:` 文案要能显示生效路径，并在来自老路径时标注）。
- 附带：`pi-image-gen` 只有 global 层（无项目层），本次不新增项目层。

## 验证方式（计划）

- `npm --workspace @bytetrue/pi-image-gen test` 与 `typecheck`；新增断言：新位置优先、整份搬迁逐字节相等、老文件未动、`PI_AGENT_HOME` 只影响老位置解析、v1 老文件搬到新目录后才生成 `.v1.bak`。
- 真机：`~/.pi/agent/pi-image-gen/settings.json`（当前是 v1 形状 + 明文 key）走一遍，确认落到 `~/.pi/agent/pi-pkg-cfg/pi-image-gen/settings.json`、老文件逐字节未变、`/image-gen` 与 bundled CLI 都能读到。

## 执行记录

**落成的形状与设计一致**，`packages/pi-image-gen/src/settings.ts`：

- `agentDir()`（`$PI_CODING_AGENT_DIR` → `~/.pi/agent`）、`newSettingsPath()`（`$PI_PKG_CFG_DIR` 或 `<agent dir>/pi-pkg-cfg` + `pi-image-gen/settings.json`）、`legacySettingsPath()`（`$PI_CODING_AGENT_DIR` → `$PI_AGENT_HOME` → `~/.pi/agent`，`$PI_AGENT_HOME` 从此**只**参与定位老文件）。
- `settingsLocation(): SettingsLocation` = `{path, legacy}`：新文件是 file 就用它；否则老文件是 file 且 `JSON.parse` 成功时 `mkdirSync(dir,{recursive:true,mode:0o700})` + `${target}.pi-image-gen-<uuid>.tmp`（`mode:0o600, flag:'wx'`）+ `rename`，返回新路径；解析或写失败 → 返回老路径 + `legacy:true`。
- `imageGenSettingsPath()` = `settingsLocation().path`（读）；`writableImageGenSettingsPath()` = `newSettingsPath()`（写）；`describeImageGenSettingsPath()` 在 legacy 时输出 `<path> (legacy (read-only fallback))`。
- `loadImageGenSettings()` / `readImageGenSettingsLayer()` 改读 `settingsLocation().path`；`updateImageGenSettings()` 写 `newSettingsPath()`。
- 调用方：`config-command.ts` 与 `cli.ts:4,137` 的 `imageGenSettingsPath` import 换成 `describeImageGenSettingsPath`，7 处 `Target:` / `Config file:` 输出统一走它。

**顺带确认的好性质（非计划内）**：`settingsLocation()` 先复制、再由 `migrateAndPersist` 走 v1→v2 迁移，所以 `.v1.bak` 落在**新**目录（`<pkg-config 根>/pi-image-gen/settings.json.v1.bak`），与 issue 002 的描述一致，无需额外代码。

**与设计的一处偏差**：`existsSync` 对**目录**也为真，第一版用它判「新文件存在」导致「新根建不出来」的用例行为诡异 → 引入 `isFile()`（`statSync().isFile()`）。

**v2 数据形状、菜单、CLI 参数、`migrate.ts` 的 v1→v2 语义**均未动（在范围外）。

## 验证

- `npm --workspace @bytetrue/pi-image-gen test` —— **12 files / 125 tests 全绿**。`__tests__/settings.test.ts` 新增：v2 文件搬进新根且原件不动、新文件存在即忽略老文件、新根建不出来时回退老位置并断言 `describeImageGenSettingsPath()` 以 `(legacy (read-only fallback))` 结尾、`$PI_PKG_CFG_DIR` 定新根 + `$PI_AGENT_HOME` 只定老文件、坏 JSON 老文件就地报 `not valid settings JSON` 且不复制；v1 迁移用例改断言 `.v1.bak` 在新目录且老位置原件保留；「dedicated versioned file」用例改断言新路径并断言 Pi 的 `settings.json` 仍未被创建。
- `npm run typecheck --workspaces --if-present` —— exit 0。
- 真机：`~/.pi/agent/pi-image-gen/settings.json`（343B，v1 形状，含明文 key）→ `~/.pi/agent/pi-pkg-cfg/pi-image-gen/settings.json`（386B v2：`version:2`、`outputDir`、`providers.img`、`default{provider:"img",model:"gpt-image-2.5"}`），同目录留下 `settings.json.v1.bak`（343B，sha256 `c448d706...` = 老文件逐字节副本）；老文件 `~/.pi/agent/pi-image-gen/settings.json` 与 `~/.pi/agent/settings.json` sha256 均未变。
- 真机 TUI：`/image-gen` → `Show effective configuration` 显示 `Config file: /Users/zijie/.pi/agent/pi-pkg-cfg/pi-image-gen/settings.json`；`Set output directory` 写入 0600 新文件；bundled CLI `node packages/pi-image-gen/skills/pi-image-gen/scripts/image-gen.mjs --list` 显示同一路径。
- 降级：发布版 `pi-image-gen@0.5.0` CLI `--list` 仍指向 `~/.pi/agent/pi-image-gen/settings.json`。**注意**：跑老版本会就地把它重写成 v2 并在老目录生成 `.v1.bak`（事后已用该备份还原，sha256 恢复为 `c448d706...`）——这是老版本自身行为，不是本次改动引入。

## 关闭结论

- **判断**：`<agent dir>/pi-image-gen/settings.json` → `<pkg-config 根>/pi-image-gen/settings.json` 完成，`PI_AGENT_HOME` 降级为「只用来找老文件」；`.v1.bak` 落在新目录。无遗留。
- **验证**：12 files / 125 tests 全绿；真机 343B v1 → 386B v2（`providers.img`、`default{provider:"img",model:"gpt-image-2.5"}`）+ `settings.json.v1.bak` `sha256 c448d706...`；发布版 0.5.0 降级仍读老文件。
- **回写**：`byissue/spec/pi-image-gen/index.md` 与 `byissue/spec/index.md`（issue 005 已改）。
- **遗留**：无。跑老版本会就地重写老文件为新版形状并生成 `.v1.bak`——老版本自身行为，非本次引入。

## 发布记录（2026-09-30）

- 与 issue 001/003/004 一起，随提交 `4dbaba7` 发布：`0.5.0` → `0.6.0`。
- tag `pi-image-gen-v0.6.0` 触发 release.yml 运行 `36689183749` 全绿，provenance `logIndex=3014945531`。
- registry 侧核对：`dist-tags.latest` = `0.6.0`；`gitHead` = `4dbaba7033a0850b338b62156f5b2bfcf3e270c6`；tarball 70 文件 / unpacked 213236 B / `shasum 703ea24092622cea120f35e37eed314dcb70adb9`。
- **发布版真机验证**（解包 tarball 后在隔离沙箱里跑）：`settingsLocation()` = `<agent dir>/pi-pkg-cfg/pi-image-gen/settings.json`；喂一份 v1 老文件（`version:1` + `defaultModel` + `customProviders`）后 `loadImageGenSettings().default` = `{provider:"img",model:"gpt-image-2.5"}`，`updateImageGenSettings` 落成 v2（`providers.img` 保留 `api`/`baseUrl`/`apiKey`）并生成 `settings.json.v1.bak`；老文件 `version` 仍为 1、未被改写。
