# pi-browser

## 定位

`@bytetrue/pi-browser` 让 Pi 具备"驱动一个已登录浏览器"的能力，但**不自研引擎、不注册 agent 工具**：它把官方 `@playwright/cli` 与官方 skill 准备好，把日常浏览器（Edge/Chrome）的登录态导入一个由本包维护的持久 profile（以下简称**副本**），并在 `~/.playwright/cli.config.json` 里把它设为默认**目标**。随后 agent 通过官方 skill 直接使用 `playwright-cli`。

目标可以是副本，也可以是用户日常的**真实 profile**（选择与导入已解耦）；但 M0 实测活档案直连不稳定且会写用户数据，所以**默认与受支持的路径始空副本**，真实 profile 是需逐次知情同意的可选项（缘起与数据：`epics/005-o-browser-direct-profile-target/`）。

Peer：`@earendil-works/pi-coding-agent >=0.80.4`、`@earendil-works/pi-tui >=0.84.3`（只读面板组件）。npm `latest`：0.1.1（当前未发版的改动：菜单重组、Target 解耦、带边框面板、Manual sign-in——见 issues/080、081 与 Epic 005 / issue 002）。

## 当前表面

`/browser` 是唯一入口（无 agent tool、无随包 skill），主菜单：**Status / Target: X / Data / Sessions / Settings / Setup / Close**。

- **Status**：带边框的只读 overlay 面板（`ctx.ui.custom()` + `Container`/`DynamicBorder`，与 Pi 内置对话框同款边框，Esc/Enter/q 关闭，非 editor）。展示：当前 Target 及其种类（`copy, owned by pi-browser` / `YOUR REAL PROFILE`）、锁持有者、副本路径与是否有数据、上次导入来源与体积、CLI config 各项（channel / userDataDir / profile / headless / mock keychain）、`playwright-cli` 版本与最低版本闸（`>= 0.1.19`）、官方 skill、artifacts 路径。
- **Target: X**：选择 playwright-cli 驱动哪个浏览器×profile——**只改 config，不写任何浏览器数据**（单测断言选中真 profile 时 `playwright-cli` 未被调用）。列表为副本在前 + 所有检测到的真实 profile（当前项标 `— current`）。选真实 profile：若该档案正被占用→报错指名占用者且不弹同意窗；否则需**知情同意**（confirm 写明：agent 以你身份操作、写你的 history/cookies、可能被同步推到其他设备、需完全关闭该浏览器、大档案启动可能失败）。非 `Default` profile 经 `launchOptions.args` 的 `--profile-directory=<X>` 指定。
- **Data**：二级菜单（Import / Re-import / Manual sign-in / Clear）。**目的地永远是副本，且导入不改变当前 Target**（首次无 config 时默认落到副本）。
- **Setup**：检测 CLI 与 skill，逐条 confirm 后执行官方命令——`npm install -g @playwright/cli@latest`、`playwright-cli install --skills=agents -g`（装到 `~/.agents/skills/playwright-cli`，Pi 直接可读）。成功只发一行 toast（CLI 输出最后一行），失败才展开完整输出（只读面板、Esc 关闭）。
- **Import login data**：选源浏览器（Edge/Chrome）→ 选 profile → 展示数据项与预估体积后 confirm（写明写入的是副本、会覆盖副本现有内容、不改变 Target）→ 导入 → 写 state → 冒烟 → 汇总。**导入前重算目的地硬闸**（不依赖菜单顺序）。
- **Re-import**：复用 state 记录的上次来源一键重导。
- **Manual sign-in (opens a window)**：为无法导入的站点（Google 等）手动登录。**永远开在副本上**，用独立 scratch config `sign-in.config.json`——绝不沿用 live config，否则用户选了真实 profile 之后，那个档案会被后台悄悄开窗。先查副本存在、未被占用，确认后 `playwright-cli -s=pi-browser-login --config=<sign-in.config.json> open --headed about:blank`；**流程阻塞在一个 input 提示上：用户在窗口里登录，完成后回 Pi 按 Enter，由我们主动 `close` 释放 profile**（中途 Esc 也走同一次 close）。为何必须我们关：实测 0.1.19 下用户手关窗口不会退进程（主进程与 SingletonLock 存活、`list` 仍报该会话），会硬挡住下一次导入和 agent 会话。菜单/confirm/toast 均注明重导会覆盖手动登录；close 失败则提示去 Sessions 兜底。
- **Clear imported data**：二次确认后删除 managed profile 内容并清空 state（CLI config 保留）。
- **Sessions**：列出全部 workspace 的 CLI 会话；本 workspace 的可单独 close/detach；`Close all sessions` 只作用当前 workspace；存在其他 workspace 会话时才出现 `Force kill all sessions (all workspaces)`。`pi-browser-login` 会话额外标 `— sign-in window`，作为 Manual sign-in 被中途打断时的兜底入口。
- **Settings**：切换 headless ↔ headed（只改 `launchOptions.headless`，原子写+备份，其余键不动）；标题注明"换浏览器或 profile 走 Target"。config 尚未生成时提示先选 Target。

## 工作方式

### 登录态导入（核心机制：让浏览器自己解密）

1. **发现**：扫描 Edge/Chrome 的 user data 目录，读 `Local State → profile.info_cache` 取显示名；缺 Local State 时回落 `Default`。
2. **稳定快照**：逐项拷贝 `Cookies`（Chromium 96+ 的 `Network/Cookies` 优先，回落旧路径）、`Local Storage`、`Session Storage`、`IndexedDB` 到临时目录；每次拷贝前后比对源文件指纹（size/mtime/ino），不一致即重试（最多 5 次）；leveldb 目录额外要求每个 `CURRENT` 指向的 MANIFEST 存在。源持续变化时报错并提示"关闭源浏览器或稍后再试"。
3. **原子替换**：先把现有 managed profile 拷成 staging、叠加快照（**按文件覆盖**：cookies 是 SQLite、storage 是 leveldb，无法字段级合并），再 rename 切换；失败回滚，成功后删除旧副本。目标目录 0700、Cookies 0600。**推论**：在 managed profile 里手动登录的站点，会在下一次导入时被源浏览器的同名文件整体替掉。
4. **config 与 state**：目标三元组（见下表）写入全局 `~/.playwright/cli.config.json`（写前备份、原子写 0600、保留用户未知键、非法 JSON 拒绝覆盖）；`state.json` 记录来源与时间。导入本身**不改变当前 Target**（仅当尚无 config 时默认落到副本）。
5. **冒烟**：写一份**独立的** `<pkg>/smoke.config.json` 指向副本，再 `playwright-cli -s=pi-browser-check --config=<smoke> open about:blank` → close。**不得复用 live config**：当前 Target 可能是用户真实 profile，而启动它会改写其数据（M0 实测：180s 超时前已改写 111 个文件）。

导入可在源浏览器运行时进行（快照机制处理并发写）；副本被占用（SingletonLock 的 pid 存活）时拒绝导入。**目的地硬闸**：`assertImportDestination` 只允许目的地等于本包副本目录，真实档案及其子目录一律拒。

### 目标三元组与配置键

目标 = `(channel, userDataDir, profileDirectory?)`；`profileDirectory` 非 `Default` 时向 `launchOptions.args` 注入 `--profile-directory=<X>`（实测有效）。

| 键 | 作用 |
| --- | --- |
| `browser.browserName: "chromium"` | 没有它，`launchOptions.channel` 被忽略，Playwright 会去启动 Chrome |
| `browser.launchOptions.channel` | 必须与 profile 所属浏览器同族（Edge → `msedge`），否则 macOS Keychain 项不匹配、cookie 解不开 |
| `browser.userDataDir` | 副本：`<agent dir>/pi-browser/profiles/<name>`；真实 profile：用户日常的 user data dir |
| `browser.launchOptions.ignoreDefaultArgs: ["--use-mock-keychain"]` | Playwright 默认带 mock keychain（假钥匙串），导入的 cookie 会解密失败并被静默丢弃。**适用范围已修正**：它是 **Playwright 直接 launch（非 persistent）** 路径的必需项；playwright-cli 的 persistent-profile 路径实际 argv 不含此 flag（playwright-core 有两个开关列表），对它是 noop——仍保留写入以防上游改列表。旧文档把四条无条件说成“缺一不可”属表述过广。 |

另有 `outputDir = <agent dir>/pi-browser/artifacts`；`launchOptions.headless` 也是本包管理的键（默认 true；保留已有值，Settings 切换只动这一个键，运行中会话不受影响——launchOptions 在会话创建时读取）。

### 会话生命周期

- CLI 会话没有 idle 超时；浏览器由 CLI 启动并挂在 managed profile 上。
- **同一 managed profile 同时只允许一个存活会话**：第二个 `open` 失败（`Browser is already in use … use --isolated`），而 `--isolated` 等于放弃导入的登录态——遗留会话会直接挡住新会话。
- `close-all` 只作用当前 workspace；`kill-all` 全局；跨 workspace 的 `-s=<name> close` 是 no-op。
- **用户手关浏览器窗口 ≠ 释放会话**（实测 0.1.19）：关掉 headed 窗口最后一个页面后，浏览器主进程树仍存活（仅少了页面相关进程）、`SingletonLock` 仍在、`list` 仍报 `headed=True`；只有 `close` 会真正拆除（实测：close 后进程归零、锁消失、list 为空）。因此 Manual sign-in 自带收尾，不依赖用户去 Sessions。
- Pi `session_start` 只**提示**遗留会话（跳过 `/reload` 与无 UI 场景），不自动清理。

## 路径与配置

| 内容 | 位置 |
| --- | --- |
| agent dir | `PI_CODING_AGENT_DIR` → `PI_AGENT_HOME` → `~/.pi/agent` |
| managed profile | `<agent dir>/pi-browser/profiles/default/`（user-data-dir，内含 `Default/`） |
| 包状态 | `<agent dir>/pi-browser/state.json`（0600） |
| CLI 产物 | `<agent dir>/pi-browser/artifacts/` |
| 全局 CLI config | `~/.playwright/cli.config.json`（可由 `PLAYWRIGHT_MCP_CONFIG` 覆盖） |
| 官方 skill | `~/.agents/skills/playwright-cli/`（由官方 CLI 安装） |

## 明确不做

- 不内置 Playwright CLI 或官方 skill（只代跑官方安装命令）；
- 不实现 extension attach / CDP attach；
- 不自研 cookie 解密（不做 AES / Keychain 读取）——由目标浏览器自己解密；
- 不注册 agent 工具、不覆盖 Pi 原生工具；
- 不复制 History / Bookmarks / 密码（Login Data）/ Web Data；
- 不自动清理会话（只提示 + 手动菜单）；
- **绝不为便利而启动用户的真实 profile**：冒烟测试与 Manual sign-in 都写独立 scratch config 指向副本，不复用 live config；选中真实 profile 需逐次知情同意，占用中直接拒。
- 不做"保住手动登录"的双层机制（vault + 重导后 replay）或 Cookies 行级合并——2026-09-14 用户决定：成本不值，**接受重导后手动登录失效**（详见 note 008 的实测依据）。如果未来要重评，从那条 note 接着走。
- v1 单 profile、不并发多浏览器。

## 已知限制

- 登录态是**快照**：会过期；Google 一类 source-bound 域名导入后可能失效；掉登录走 Re-import。
- 重导是**整文件覆盖**，不是合并：managed profile 里的手动登录（Manual sign-in）会被下一次导入冲掉，需重新手动登录。**这是 2026-09-14 明确接受的取舍**（做过避免它的技术调研，结论是成本不值，见 note 008），不是一次待修的缺陷；菜单与 confirm 均已写明。
- 只支持 macOS/Windows/Linux 的 Edge 与 Chrome——即 Playwright 有 channel 的浏览器（2026-09-14 决策：菜单只列 Playwright channel 选项；Brave/Arc 等其他 Chromium 不支持，不走 executablePath）。CLI `--browser` 虽列 firefox/webkit，但登录态导入管线是 Chromium 专用（Local State/leveldb/Keychain 配对），Firefox/WebKit 明确不支持。
- 会话清单跨 workspace 可见，但关闭能力受 workspace 边界限制（`kill-all` 兜底）。
- 目标选真实 profile 属**可选项、不保证可用**：M0 实测日常档案（Default 2.7G）直连 180s 启动超时，且失败前已改写 111 个文件（含 `Cookies`/`Preferences`/`Secure Preferences`）；同档案的 /tmp 副本却秒开、登录态可用。根因未定（Epic 005 未确认项），所以默认与受支持路径始终是副本。

## 验证

```bash
npm --workspace @bytetrue/pi-browser test
npm --workspace @bytetrue/pi-browser run typecheck
npm --workspace @bytetrue/pi-browser pack --dry-run
```

真实 Pi 回归还应确认：主菜单六项（Status / Target / Data / Sessions / Settings / Setup）；**选中真实 profile 时只改 config、不起浏览器不写数据**，且占用中会直接报错不弹同意窗；知情同意文案含“以你身份操作 / 会同步”；Target 为真 profile 且非 Default 时 config 带 `--profile-directory`；Status 能标出 `copy, owned by pi-browser` 或 `YOUR REAL PROFILE` 与锁持有者；副本路线：导入后在任意目录、无 env 直接 `playwright-cli open <需鉴权页面>` 是登录态；冒烟与 Manual sign-in 使用的是 `smoke.config.json` / `sign-in.config.json`（不抢 live config 的目标）；Manual sign-in 起可见窗口 → 登录 → 按 Enter → 窗口关闭且紧接着的 Import / agent `open` 不再被 profile 占用挡住；`/reload` 后 Data 四项可用；有遗留会话时启动提示出现、无则不打扰；Settings 切换 headless 后 config 实际变化且 Status 同步；重导不清掉已设的 headless。

## 证据

- README：`packages/pi-browser/README.md`
- 当前实现：`packages/pi-browser/src/`
- 包事项（M1–M4 执行记录、真机穿刺、CLI 会话语义实测）：`codestable/issues/done/074-x-browser-package.md`
- Settings 菜单与浏览器范围决策（只支持 Playwright channel 浏览器，Brave/Arc 撤除）：`codestable/issues/075-x-browser-settings-and-v2-browsers.md`
- /browser 二级菜单重组 + Browser 切换入口 + 只读 Status 面板：`codestable/issues/080-x-ff-browser-menu-regroup.md`
- Manual sign-in 窗口入口 + Status 面板加边框：`codestable/issues/081-x-ff-browser-manual-signin-and-bordered-panel.md`
- 目标模型重构（选择与导入解耦、真实 profile 降为需同意的可选项、三条硬闸）与全部实测数据：`codestable/epics/005-o-browser-direct-profile-target/`（`spec.md` + `issues/001-x-m0-real-profile-pierce.md` + `issues/002-x-target-decouple-and-gates.md`）、`codestable/talks/006-browser-direct-profile-target.md`
- 发布：`.github/workflows/release.yml`（tag `pi-browser-v*`）；Trusted Publisher 已配置，0.1.1 已发布
