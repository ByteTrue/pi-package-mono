---
kind: issue
title: "pi-browser：浏览器能力安装与登录态导入（基于官方 playwright-cli）"
type: feature
status: closed
created: 2026-09-13
---

# pi-browser：浏览器能力安装与登录态导入（基于官方 playwright-cli）

## 做成以后是什么样

Pi 里装一个包，用户跑 `/browser` 就能：装好官方 `@playwright/cli` 与官方 skill；把日常 Edge 的登录态导入到一个由我们维护的持久 profile；之后 agent 按官方 skill 直接跑 `playwright-cli open/goto/snapshot/...`，默认落到这个已登录的 profile 上——不依赖 extension、不产生 tab group、不需要专用 profile 手工登录。

**范围：** 包含：新包 `@bytetrue/pi-browser` = `/browser` 菜单（Status / Setup / Import / Re-import / Clear / Sessions）+ 导入流水线（浏览器与 profile 检测、稳定快照、写入我们 profile、写全局 CLI config、冒烟验证）+ 状态文件。

**不包含：**
- extension attach / CDP attach；
- 自己解密 cookie（不做 AES / Keychain 读取）；
- 内置 CLI 或官方 skill 本体（只替用户跑官方安装命令）；
- 多 profile 并发与切换（v1 单默认 profile，数据结构留扩展位）；
- 复制 History / Bookmarks / 密码（Login Data）/ Web Data；
- 自动 kill 非本包的 CLI 会话。

**归属：** 根 `issues/`（独立 issue）。相关 spec：`byissue/spec/index.md`（能力地图与架构落点新增一行，关闭时回写）。

## 为什么现在做

用户当前用 Playwright MCP + extension 驱动浏览器，两个痛点：

1. extension 每连一个客户端就在浏览器里建一个 `Playwright · <client>` tab group，非干净退出就残留（截图里已积累一大堆）；
2. 更早的 CLI（自带浏览器）模式会留下僵尸浏览器进程。

真实诉求是"复用日常浏览器的登录态"，extension 只是达成它的手段。已验证不用 extension 也能满足：**把日常 profile 的 cookie 数据导入我们自己的 profile，让 Edge 自己解密**。

延伸诉求：复用成熟工具而不是自研引擎——官方 `playwright-cli` 已是给 coding agent 设计的 CLI，官方 skill 也已能直接装给 Pi 用，本包只做 setup、配置与登录态管理。

## 现状怎么工作（已实测）

- agent 从官方 skill（`playwright-cli install --skills=agents -g` → `~/.agents/skills/playwright-cli`，Pi 会读 `~/.agents/skills/` 与 `~/.pi/agent/skills/`）获知命令；直接跑 `playwright-cli`。
- CLI 读全局 `~/.playwright/cli.config.json`（支持 project `.playwright/cli.config.json` + global 两级；`--config` 只对建会话命令有效，`tab-list`/`detach` 等后续命令不接受）。
- **配置四件套（缺一不可，均已实测）**：
  - `browser.browserName: "chromium"`：没有它，`launchOptions.channel` 被忽略、会去启动 Chrome；
  - `browser.launchOptions.channel: "msedge"`：运行浏览器必须与导入来源同族（macOS Keychain 项不同会解不开）；
  - `browser.userDataDir: <我们的 profile>`；
  - `browser.launchOptions.ignoreDefaultArgs: ["--use-mock-keychain"]`：Playwright 默认带 `--use-mock-keychain`（假钥匙串），导入的 cookie 会解密失败并被静默丢弃——这是首次 PoC 失败的根因。
- PoC（2026-09-13，来源 Edge `Default`，探针 GitHub）：导入后 `playwright-cli open https://github.com` 直接是登录态（`find ByteTrue` 26 处匹配、@ByteTrue 头像链接、仓库 Star 状态可见）；`close/detach` 干净、无残留进程。本机当前已按此配方落地：profile `<agent dir>/pi-browser/profiles/default`（0700，约 25MB，自 PoC 路径迁入）+ 全局 config。
- 事实补充：
  - Cookies 路径双形态：Chromium 96+ 在 `Network/Cookies`，旧版在 profile 根 `Cookies`（本机 Edge 151 用旧路径）；
  - `google.com` 类 source-bound 域名移植后会被判无效（参考 stablyai/orca 的实现，他们把 Google 列为不可移植并跳过其 source-bound cookie）；
  - CLI 会话无 idle 超时（`cli-client/session.js`），浏览器由 CLI 启动 → 僵尸风险要靠显式清理兜底；
  - 参考实现：`stablyai/orca`（MIT）的 `src/main/browser/browser-cookie-*.ts`——他们必须自己解密是因为目标浏览器是自建 Electron 分区；我们的目标是 Edge 本身，因此可以整库复制、让浏览器自己解密，复杂度低一个数量级。

## 动哪些、验哪些

- 必须改（新增）：`packages/pi-browser/`（extension + tests + README + package.json/tsconfig）；`.github/workflows/release.yml` 加 tag 分支；根 README 表格加一行。不改任何现有包。
- 运行时写用户机器（非仓库）：`~/.playwright/cli.config.json`（我们管理、写前备份）、`<agent dir>/pi-browser/profiles/default/`（0700）、`<agent dir>/pi-browser/state.json`（0600）、`<agent dir>/pi-browser/artifacts/`（outputDir，0700）。`<agent dir>` = `PI_CODING_AGENT_DIR || PI_AGENT_HOME || ~/.pi/agent`（对齐 pi-image-gen 的 `activeConfigDir` 约定）。
- 需要验：headed 模式下的 Keychain 解密（PoC 只验了 headless）；Edge 运行中拷 leveldb（Local Storage / IndexedDB）的一致性；`~/.agents/skills` 被 Pi 识别（需重启 Pi）；全局 config 合并/备份分支；旧版 playwright-cli 对配置键的兼容闸。
- 仍未知：Brave/Arc 等无 Playwright channel 的浏览器是否值得 v2 支持（executablePath 路线）；"登录态抽查"是否值得做成正式功能（v1 只做启动冒烟）。

## 方案与实现安排

包只注册一个 `/browser` 命令，零常驻 agent tool、零运行时依赖（Node 内建 + Pi API）：

```text
src/index.ts            注册 /browser；session_start 只提示遗留 CLI 会话数（不自动清）
src/browser-command.ts  菜单编排（ui.select 循环，Esc 取消；模式对齐 /background）
src/paths.ts            agent dir / profiles / state / artifacts 路径解析
src/env.ts              检测 CLI、skill 与版本；安装引导（pi.exec 跑官方命令，每条先 confirm 并显示原文）
src/import/detect.ts    源浏览器与 profile 枚举（macOS: ~/Library/Application Support/<Vendor>/Local State → profile.info_cache）
src/import/snapshot.ts  稳定快照：Cookies 双路径解析；拷贝 + 前后 stat（inode/size/mtime/ctime）一致校验 + 5 次重试；Local Storage/IndexedDB 同法
src/import/apply.ts     先写 <profile>.importing-<ts>/ 再整目录切换；0700/0600；旧 Cookies 备份 Cookies.bak-<ts>
src/import/verify.ts    冒烟：playwright-cli -s=pi-browser-check open about:blank → close
src/config.ts           全局 config 读 → 合并四件套 + outputDir → 备份 .bak-<ts> → 原子写（0600）；非法 JSON 拒绝覆盖
src/state.ts            来源浏览器、profile 名、导入时间、计数、上次选项
```

菜单：Status（profile/来源/时间/CLI 版本/skill 状态/遗留会话数）、Setup（安装或更新 CLI、安装官方 skill，逐条 confirm）、Import login data（选浏览器 → 选 profile → 预览体积 → 导入 → 摘要）、Re-import（上次来源一键重导）、Clear imported data（清空 profile 内容，二次 confirm）、Sessions（list / close-all）。

导入数据流：detect → 用户选择 → snapshot 到临时目录 → apply（临时 → 切换）→ config → state → verify 冒烟 → 摘要。摘要固定两句提醒：google 一类 source-bound 域名导入后可能被判失效（预期）；掉登录走 Re-import；需要人看浏览器时用 `open --headed`。

质量目标：
- **信息安全性与保密性**：profile/artifacts 0700、config/state 0600、原子写；摘要与日志不输出 cookie 值；覆盖类动作二次确认。
- **可靠性**：稳定快照 + 重试；导入失败不破坏现有 profile（临时目录 → 切换）；config 写前备份、非法 JSON 拒写。
- **交互能力**：每步可取消；长动作前告知范围与体积。
- **兼容性**：启动做 playwright-cli 最低版本检查（低于实测支持四件套的版本给升级引导）；peer `@earendil-works/pi-coding-agent >=0.80.4`（对齐现有包）。

实现顺序（风险先通）：
1. **M1** 骨架 + paths/config/env/status——用包内实现重跑"配置正确性"（含已有 config 的合并/备份分支）。
2. **M2** 导入流水线。穿刺点：**Edge 运行中拷 leveldb 的一致性**——用依赖 localStorage 的站点验证；不通则降级为"提示先关闭源浏览器再导"。
3. **M3** verify 冒烟 + 摘要文案 + 启动遗留会话提示 + Sessions 菜单。
4. **M4** 回归与发布接线：单测（profile 解析、config 合并、路径解析、快照重试用 stat 桩）、`npm --workspace @bytetrue/pi-browser test/typecheck`、pack dry-run、真机全链路；release.yml tag 分支、根 README；关闭时回写 spec。

## 验证

- 单测：detect（Local State 夹具）、snapshot（用 stat 桩驱动重试与失败路径）、config（合并 / 备份 / 非法 JSON 拒绝）、paths。
- 真机主链路：`/browser` 全菜单走查；导入后无 env、任意 cwd 跑 `playwright-cli open https://github.com` 验证登录态；再走一次 Re-import；Clear 后确认 profile 清空、config 行为符合设计。
- 负面路径：源浏览器运行中导入、IndexedDB 缺失、playwright-cli 未安装、config 已存在且含用户自定义字段。

## 已确认（2026-09-13，用户全选推荐）

1. 包名 `@bytetrue/pi-browser`。
2. 目录约定 `<agent dir>/pi-browser/profiles/<name>`；本机 PoC profile 已自 `~/.pi/agent/browser-profiles/default` 迁入该约定，全局 config 同步更新。
3. IndexedDB 默认随 Cookies / Local Storage 一起导入（本机约 40MB）。
4. 会话清理 v1：`/browser → Sessions` 手动 list / close-all + `session_start` 提示遗留会话；不自动清理。
5. `google.com` 这类不可移植域名不跳过，只在导入摘要提示可能失效。

## 执行记录

### M1（2026-09-13）

新增 `packages/pi-browser`（extension 骨架，零运行时依赖，对外只有 `/browser` 一个命令；对 pi 包仅 `import type`）：

- `src/paths.ts`：agent dir / profiles / artifacts / state / CLI config / 官方 skill 路径解析（`PI_CODING_AGENT_DIR || PI_AGENT_HOME || ~/.pi/agent`；`PLAYWRIGHT_MCP_CONFIG` 可覆盖 CLI config 路径）。
- `src/config.ts`：全局 config 读 / 合并 / 备份 / 原子写（0600）。合并四件套（`browserName`、`userDataDir`、`launchOptions.channel`、`launchOptions.headless`）+ 保底 `args` 与 `ignoreDefaultArgs` 并集；保留用户未知键；`ignoreDefaultArgs: true` 原样保留；非对象形状或非法 JSON 一律拒绝覆盖。
- `src/env.ts`：`playwright-cli` 探测 + 最低版本闸（`>= 0.1.19`，三态 missing/outdated/ready）、官方 skill 检测、两条安装命令常量（`npm install -g @playwright/cli@latest`、`playwright-cli install --skills=agents -g`）。
- `src/state.ts`：`state.json` 读写（0600、原子；缺失/损坏/异版本视为空）。
- `src/browser-command.ts`：`/browser` 菜单。Status 已实现（profile/config/CLI/skill/artifacts + 上次导入 + config 是否指向我们的 profile）；Setup 已实现（逐条 confirm 后执行官方安装命令并展示输出）；Import / Re-import / Clear / Sessions 为占位，明确提示属 M2/M3。
- `src/index.ts`：注册命令。

验证：

- `npm --workspace @bytetrue/pi-browser run typecheck` 通过；
- `npm --workspace @bytetrue/pi-browser test` → 6 文件 28 测试全过（paths / env / config / state / command / entry）；
- 全仓库 `npm run typecheck --workspaces` 与 `npm test` 通过（exit 0，含新包）；
- `npm install` 已同步 workspace 与 lockfile（CI `npm ci` 可用）；
- 待人工验证：Pi `/reload` 后 `/browser → Status / Setup` 真机走查（本会话无法驱动 TUI）。原计划的 `pi -p` 加载冒烟因本机 provider 全部不可用（`no_available_providers`）未跑成，与包无关；包对 Pi 只有 type import，加载风险面很小。

偏差：无（相对 M1 设计）。附带改动：本机 `.pi/settings.json`（gitignored）加入 `../packages/pi-browser` 便于 `/reload` 测试。

### M1 真机验收与 UX 修正（2026-09-13）

用户在本机 Pi 里跑通：

- `/browser → Status`：渲染正确（profile 存在、config 的 channel/userDataDir/headless/mock keychain 各字段、skill 缺失提示）。
- `/browser → Setup`：执行了两条官方安装命令并成功——`playwright-cli` 0.1.19 装到 mise node lts 全局 bin；官方 skill 装到 `~/.agents/skills/playwright-cli`（含 `references/`）。机器侧复核：`which playwright-cli`、`playwright-cli --version`、`~/.agents/skills` 均符合预期。

用户反馈与修正：

- **问题**：安装成功后把命令输出整段塞进 `ctx.ui.editor`，"命令返回放在输入框里感觉怪怪的"。
- **修正**：成功时只用 `notify` 显示 CLI 自己的最后一行（去掉 ANSI 后取最后一个非空行，兜底为 "<命令> finished."），不再打开 editor；只有失败时才展开输出，并把标题改为 "Install output — read only, press Esc to close"。Status 在 CLI 未就绪时新增 "run Setup to install or update it." 提示；probe 的 missing 详情从仅 "exit code 1" 改为带 "is playwright-cli on PATH?" 的说明。
- 测试补充：成功路径断言不打开 editor；新增失败路径用例（notify error + editor 标题含 "read only"）。29 测试全过；全仓 typecheck / test exit 0。

### M2（2026-09-13）

新增导入流水线 `src/import/`：

- `detect.ts`：源浏览器与 profile 枚举（Edge/Chrome 的 user data 根 + `Local State → profile.info_cache` 显示名；缺 Local State 回落 Default；列了但目录不存在的 profile 跳过；Default 排最前）。
- `snapshot.ts`：`resolveCookiesPath` 双路径（Network/Cookies 优先、旧路径回落）；规划 cookies / local-storage / session-storage / indexeddb；稳定快照 = 逐项拷贝 + 前后指纹（size/mtime/ino）比对 + 最多 5 次重试；leveldb 目录额外校验每个 `CURRENT` 指向的 MANIFEST 存在；`CopyOps` 接缝让重试与失败路径可注入测试。源持续变化时给出"关闭源浏览器或稍后再试"的指引。
- `apply.ts`：`isProfileInUse`（用 lstat 识别悬空 SingletonLock symlink，pid 不存活视为陈旧锁）；`buildStagingProfile`（现 profile 拷贝 + 快照叠加，0700/0600）+ `swapIntoPlace`（rename 切换、失败回滚、成功后删旧副本）；`clearProfileData`。
- `pipeline.ts`：detect→snapshot→stage→swap 编排；产出 `BrowserImportSummary`（sourceBrowserId/Label、sourceProfile/Dir、importedAt、bytesCopied）；失败不破坏现有 profile，临时目录 finally 清理。
- `verify.ts`：导入后冒烟（`playwright-cli -s=pi-browser-check open about:blank` → close）。
- 菜单接线：**Import login data**（选浏览器 → 选 profile → 展示数据项与体积并 confirm → 导入 → 写 config → 写 state → 冒烟 → 汇总 notify）、**Re-import**（复用 state 记录来源）、**Clear imported data**（二次确认并清 state）。Status 的 Last import 显示来源与体积。

测试：52 个全过（新增 detect 4 / snapshot 7 / apply 6 / pipeline 3；命令层补 import-no-browser 与 clear 两个流程用例）。

**真机穿刺（源 = 本机 Edge Default，Edge 正在运行）：**

- 4 项共 43.5 MB（cookies 294 KB / local storage 4.1 MB / session storage 997 KB / indexeddb 38 MB），一次通过、无重试；
- Cookies 行数：源 468 = scratch 目标 468 = managed 目标 468；
- 目标 profile 正常启动；bilibili（重存储站点）console error = 0，leveldb 拷贝未造成损坏；
- 登录态：`/settings/profile` 在 scratch 与 managed 两个 profile 上均保持登录（ByteTrue 可见）；
- **教训**：用首页快照判断登录不可靠（首屏未含头像节点时出现假阴性）；登录态验证要用需要鉴权的页面。

偏差：无（相对 M2 设计）。

### M3（2026-09-13）

新增会话可见性与清理：

- `sessions.ts`：解析 `playwright-cli list --all --json`；`collectSessionViews` 用一次 `list --json`（当前 workspace）把会话标成 local / other workspace；`closeCliSession`（attached → detach，否则 close）、`closeCliSessions`（close-all）、`killAllCliSessions`（kill-all）；`notifyLeftoverSessions` 只提示不清理。
- `index.ts`：`session_start` 钩子（跳过 `reload`、无 UI 时跳过）后台调用 `notifyLeftoverSessions`，有遗留会话时发 warning 提示并指引 `/browser → Sessions`。
- `/browser → Sessions` 菜单：列全部会话（其他 workspace 的标注 "— other workspace"）；本地会话可单独 close/detach；`Close all sessions`（当前 workspace，confirm）；仅当存在其他 workspace 会话时出现 `Force kill all sessions (all workspaces)`（confirm 说明影响面）。

CLI 会话语义（本次实测确认，关闭时应进 spec）：

- `close-all` **只在当前 workspace 生效**；`kill-all` 全局（能清掉其他 workspace 的会话）；
- 在其他 workspace 执行 `-s=<name> close` 是 no-op，只报 "Browser '<name>' is not open."；
- **同一 managed profile 同时只能有一个存活会话**：第二个 `open` 直接失败 `Browser is already in use for <profile>, use --isolated …`。含义：agent 应复用会话或先关；遗留会话会挡住新会话——这正是启动提示与 Sessions 菜单存在的理由（`--isolated` 不能用，它等于放弃导入的登录态）。

验证：

- 单测 64 个全过（sessions 10 / command 11，新增 local-foreign 划分、kill-all、foreign 警告用例）；全仓 typecheck / test exit 0。
- 真机：`pi --mode rpc` 启动时实测收到 `{"type":"extension_ui_request","method":"notify","message":"1 playwright-cli session(s) are still open (leftover-probe). Use /browser → Sessions…","notifyType":"warning"}`（先手动留了一个会话，验证后清理）。
- 真机 CLI 语义：两只会话并发被 profile 占用挡住（错误信息见上）；close-all 作用域与 kill-all 全局均按实测记录。

偏差：无。原设计只写 "Sessions 菜单（list/close-all）"；因实测到跨 workspace 语义，菜单增加了 local/foreign 划分与 kill-all 兜底。

### M4（2026-09-13）

- 包 README 重写：`/browser` 的入口、导入原理、三件套配置表、预期与限制（快照会过期 / 同一 profile 一次一个会话）、安装与管理文件清单。
- 根 README：简介改为 "Six focused extensions"、能力表新增 pi-browser 行、安装命令、TUI 命令列表、新增一条"setup-only 包不注册 agent 工具"的说明、仓库地图。
- `.github/workflows/release.yml`：tag 列表与 case 分支加入 `pi-browser-v*`（OIDC 发布路径就绪）。
- `.github/workflows/ci.yml`：加入 `npm --workspace @bytetrue/pi-browser pack --dry-run`。
- `package.json` 的 `files` 收敛为 `src/**` + README（排除测试）。

验证：

- `pack --dry-run` 内容正确（仅 src 与 README，无测试文件）；
- 全仓 typecheck / test exit 0（pi-browser 11 文件 64 测试）；
- 真实 Pi 加载检查：`pi --mode rpc` 启动无扩展加载错误；无遗留会话时不发提示（空态正确）。

遗留（发布时）：npmjs 侧需为 `@bytetrue/pi-browser` 配置与其它包一致的 Trusted Publisher，之后推 `pi-browser-v<version>` tag 才会发布。

## 关闭回写

- project spec：`byissue/spec/index.md`（包清单改七个、能力地图、使用路径、架构落点、当前边界、证据索引均新增 pi-browser）
- 新建 `byissue/spec/pi-browser/index.md`（定位 / `/browser` 表面 / 导入机制 / 配置四件套 / 会话语义 / 路径 / 明确不做 / 已知限制 / 验证 / 证据）
- 根 `README.md`：能力表新增行、安装命令、TUI 命令列表、setup-only 说明、仓库地图
- 包 `README.md`：`packages/pi-browser/README.md`
- 不新建 notes：本事项的知识（配置四件套、导入机制、会话语义）已直接进 spec

## 关闭结论

- **关闭判断**：目标达成且范围未暗扩。M1–M4 全部完成；唯一范围调整来自 M1 真机反馈（安装输出不塞 editor，已实现并补测试）。
- **质量证据**：64 个单测（paths / env / config / state / command / index / detect / snapshot / apply / pipeline / sessions）；全仓 typecheck 与 test exit 0；pack dry-run 内容正确（仅 src + README）；真实 Pi 加载无错误、空态不打扰。
- **真机验收**：导入 43.7 MB（Edge Default：cookies / local storage / session storage / indexeddb），cookies 行数源=目标=468；`/settings/profile` 保持登录；bilibili console error 0（leveldb 拷贝无损）；`pi --mode rpc` 实测启动遗留会话提示；配置写入产生一次备份后转为规范形式（后续导入不再重复备份）。
- **发布状态**：仓库内 0.1.0 就绪，`pi-browser-v*` tag 与 release.yml 已接线；npmjs Trusted Publisher 待配置，尚未发布。
- **发布与 TP 握手验证**：0.1.0 由用户本机手动首发（2026-09-13，2FA 完成）。首次 tag `pi-browser-v0.1.1` 触发的发布被 npm 拒绝（`403 OIDC permission denied`，provenance 已签名——当时 Trusted Publisher 尚未配置）。用户在 npmjs 配置 TP（`ByteTrue/pi-package-mono` / `release.yml` / 权限 `npm publish`、Environment 留空）后，本包与远端 main 合并（issue 改号 068→074）并重推 tag，`release.yml` 成功执行：`+ @bytetrue/pi-browser@0.1.1`，provenance 已签名入 transpareer/log，registry `latest = 0.1.1`。此后发版 = bump 版本 + 推 `pi-browser-v<version>` tag。
- **遗留**：Brave/Arc 等无 Playwright channel 的浏览器支持（v2）；导入后的"登录态抽查"功能。
