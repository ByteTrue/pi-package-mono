# pi-browser

## 定位

`@bytetrue/pi-browser` 让 Pi 具备"驱动一个已登录浏览器"的能力，但**不自研引擎、不注册 agent 工具**：它把官方 `@playwright/cli` 与官方 skill 准备好，把日常浏览器（Edge/Chrome）的登录态导入一个由本包维护的持久 profile，并在 `~/.playwright/cli.config.json` 里把它设为默认。随后 agent 通过官方 skill 直接使用 `playwright-cli`。

Peer：`@earendil-works/pi-coding-agent >=0.80.4`。npm `latest`：尚未发布（0.1.0 已在仓库就绪）。

## 当前表面

`/browser` 是唯一入口（无 agent tool、无随包 skill）：

- **Status**：profile 是否存在、CLI config 各项（channel / userDataDir 是否指向本包 profile / headless / mock keychain 是否禁用）、`playwright-cli` 版本与最低版本闸（`>= 0.1.19`）、官方 skill 是否安装、上次导入来源与体积、artifacts 路径。
- **Setup**：检测 CLI 与 skill，逐条 confirm 后执行官方命令——`npm install -g @playwright/cli@latest`、`playwright-cli install --skills=agents -g`（装到 `~/.agents/skills/playwright-cli`，Pi 直接可读）。成功只发一行 toast（CLI 输出最后一行），失败才展开完整输出（只读、Esc 关闭）。
- **Import login data**：选源浏览器（Edge/Chrome）→ 选 profile → 展示数据项与预估体积后 confirm → 导入 → 写 config → 写 state → 冒烟 → 汇总。确认文案固定提示"当前 profile 会在新 profile 就绪前保留"与"Google 类 source-bound 登录可能失效"。
- **Re-import**：复用 state 记录的上次来源一键重导。
- **Clear imported data**：二次确认后删除 managed profile 内容并清空 state（CLI config 保留）。
- **Sessions**：列出全部 workspace 的 CLI 会话；本 workspace 的可单独 close/detach；`Close all sessions` 只作用当前 workspace；存在其他 workspace 会话时才出现 `Force kill all sessions (all workspaces)`。

## 工作方式

### 登录态导入（核心机制：让浏览器自己解密）

1. **发现**：扫描 Edge/Chrome 的 user data 目录，读 `Local State → profile.info_cache` 取显示名；缺 Local State 时回落 `Default`。
2. **稳定快照**：逐项拷贝 `Cookies`（Chromium 96+ 的 `Network/Cookies` 优先，回落旧路径）、`Local Storage`、`Session Storage`、`IndexedDB` 到临时目录；每次拷贝前后比对源文件指纹（size/mtime/ino），不一致即重试（最多 5 次）；leveldb 目录额外要求每个 `CURRENT` 指向的 MANIFEST 存在。源持续变化时报错并提示"关闭源浏览器或稍后再试"。
3. **原子替换**：先把现有 managed profile 拷成 staging、叠加快照，再 rename 切换；失败回滚，成功后删除旧副本。目标目录 0700、Cookies 0600。
4. **config 与 state**：四件套写入全局 `~/.playwright/cli.config.json`（写前备份、原子写 0600、保留用户未知键、非法 JSON 拒绝覆盖）；`state.json` 记录来源与时间。
5. **冒烟**：`playwright-cli -s=pi-browser-check open about:blank` → close，证明 config/profile 通路可用。

导入可在源浏览器运行时进行（快照机制处理并发写）；managed profile 被占用（SingletonLock 的 pid 存活）时拒绝导入。

### 配置四件套（缺一不可）

| 键 | 作用 |
| --- | --- |
| `browser.browserName: "chromium"` | 没有它，`launchOptions.channel` 被忽略，Playwright 会去启动 Chrome |
| `browser.launchOptions.channel` | 必须与导入来源同族（Edge → `msedge`），否则 macOS Keychain 项不匹配、cookie 解不开 |
| `browser.userDataDir` | 指向 `<agent dir>/pi-browser/profiles/<name>` |
| `browser.launchOptions.ignoreDefaultArgs: ["--use-mock-keychain"]` | Playwright 默认带 mock keychain（假钥匙串），导入的 cookie 会解密失败并被静默丢弃 |

另有 `outputDir = <agent dir>/pi-browser/artifacts`。

### 会话生命周期

- CLI 会话没有 idle 超时；浏览器由 CLI 启动并挂在 managed profile 上。
- **同一 managed profile 同时只允许一个存活会话**：第二个 `open` 失败（`Browser is already in use … use --isolated`），而 `--isolated` 等于放弃导入的登录态——遗留会话会直接挡住新会话。
- `close-all` 只作用当前 workspace；`kill-all` 全局；跨 workspace 的 `-s=<name> close` 是 no-op。
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
- v1 单 profile、不并发多浏览器。

## 已知限制

- 登录态是**快照**：会过期；Google 一类 source-bound 域名导入后可能失效；掉登录走 Re-import。
- 只覆盖 macOS/Windows/Linux 的 Edge 与 Chrome；其他 Chromium 需要 executablePath，留待 v2。
- 会话清单跨 workspace 可见，但关闭能力受 workspace 边界限制（`kill-all` 兜底）。

## 验证

```bash
npm --workspace @bytetrue/pi-browser test
npm --workspace @bytetrue/pi-browser run typecheck
npm --workspace @bytetrue/pi-browser pack --dry-run
```

真实 Pi 回归还应确认：`/browser` 六个入口；Setup 两条命令；导入后在任意目录、无 env 直接 `playwright-cli open <需鉴权页面>` 是登录态；`/reload` 后 Import / Re-import / Clear 可用；有遗留会话时启动提示出现、无则不打扰。

## 证据

- README：`packages/pi-browser/README.md`
- 当前实现：`packages/pi-browser/src/`
- 包事项（M1–M4 执行记录、真机穿刺、CLI 会话语义实测）：`codestable/issues/done/068-x-browser-package.md`
- 发布：`.github/workflows/release.yml`（tag `pi-browser-v*`）；npm Trusted Publisher 待配置
