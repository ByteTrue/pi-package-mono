# pi-browser: agent-browser manager

## 定位

`@bytetrue/pi-browser` 是 `agent-browser` 的专职运维与管理扩展（agent-browser manager）。它不自研浏览器引擎、不注册 agent 工具、不拦截 shell 或 CLI 参数，也不替用户执行安装；Agent 按官方 skill 直接调用 `agent-browser`。

本包专注负责：

1. **浏览器选型与配置管理**：默认 Auto 自动发现，用户可在 Settings 中自由点选已安装的 Microsoft Edge、Google Chrome、Chrome for Testing 或自定义路径；管理窗口模式与闲置自动关闭；
2. **登录凭证（Logins）管理**：一等公民的增删改查 UI，开窗登录并保存 Cookie+LocalStorage 到独立状态文件（`<agent dir>/pi-browser/auth/*.json`），各任务按需挂载，彻底摆脱 Profile 进程锁，天然支持多任务并行；
3. **实时观测大屏（Dashboard）**：管理 agent-browser 内置的 4848 端口 WebUI，一键启动、停止、并在系统浏览器中直达实时操作画面流与指令流；
4. **会话监控与清扫（Sessions）**：查看运行中会话，一键清扫后台已死的残留记录文件。

已验证最低 CLI：`agent-browser >= 0.37.1`。

## `/browser` 当前表面

主菜单固定为：**Status / Logins / Dashboard / Configure recommended defaults / Settings / Sessions / Setup commands / Close**。

### Status

只读边框面板展示：

- 已保存的登录态（Logins）数量与目录路径；
- 当前生效的浏览器选择（Auto 自动发现 / Microsoft Edge / Google Chrome 等）；
- 观测大屏状态（运行在 4848 端口 / 已停止）；
- agent-browser CLI 版本与 `>= 0.37.1` 闸；
- 官方 skill 是否存在及路径；
- 当前用户 config 的 `engine/headed/idleTimeout/executablePath`（若残留旧 `profile`/`namespace` 则标记 legacy）；
- 活跃会话数与项目配置覆盖提醒。

### Logins（登录态管理）

第一类菜单，支持登录数据的完整增删改查：

- **列表展示**：列出 `<Pi agent dir>/pi-browser/auth/` 下所有 `.json` 状态文件，展示名称、包含域名、Cookie 数量及文件大小；
- **+ Add new login**：输入名称（支持英文、数字、汉字、连字符、下划线），自动拉起有头测试浏览器供用户在页面上登录，确认后通过 `agent-browser state save` 保存到独立 JSON 文件，并自动关闭临时登录窗口；
- **Sign in / Update**：对已有登录态重新打开有头浏览器并加载现有凭证，供用户刷新登录或追加新站点，确认后重新保存；
- **View details**：查看该登录态涉及的完整域名、Cookie 数量、精确路径，以及复制直接调用命令（`--state` 或 `AGENT_BROWSER_STATE`）；
- **Rename**：就地重命名状态文件，自动防重名碰撞；
- **Delete**：确认后永久删除该登录文件。

### Dashboard（实时观测大屏）

管理本地 4848 端口的 Web 观测控制台：

- 查看当前状态：Running / Stopped；
- **Start dashboard**：后台启动并自动在默认浏览器中打开大屏；
- **Stop dashboard**：停止大屏服务；
- **Open in browser**：大屏已运行时快速在浏览器打开 `http://localhost:4848`。

### Configure recommended defaults

读取 `AGENT_BROWSER_CONFIG` 指向的文件，否则读取 `~/.agent-browser/config.json`。非法 JSON 拒绝覆盖；合法对象保留本包不管理的键。写前备份、原子替换，Unix 权限为 0600。

本包写入：

```json
{
  "engine": "chrome",
  "headed": false,
  "idleTimeout": "10m",
  "screenshotDir": "<agent dir>/pi-browser/artifacts"
}
```

**不写 `profile`、`session`、`namespace`。** 浏览器路径默认留空（Auto），让 agent-browser 自动探测系统浏览器，或由用户在 Settings 里自由指定 Edge/Chrome。

- 旧 config 已有 `headed` / `idleTimeout` 时保留用户选择；首次缺省为 headless + 10 分钟。
- 若发现 `~/.agent-browser/browsers/` 下由 agent-browser 下载的 Chrome for Testing，则写入其最新版本的 `executablePath`。
- 尚未下载时不伪造路径，也不执行下载；旧 config 已有 `executablePath` 时保留它，新 config 则由 agent-browser 按自身规则发现浏览器；Status 明确提示缺少测试浏览器。
- 新 Profile 使用 `profiles/agent-browser`，绝不拿 Chrome for Testing 打开旧的 `profiles/default`（旧目录来自 Playwright/Edge 副本，自动复用有损坏风险）。

### Settings

- Window：headless ↔ visible；只改 `headed`。
- Auto-close：`5m / 10m / 30m / 1h`；只改 `idleTimeout`。
- 配置变化只影响新启动的 browser session；当前存活 session 不被后台重启。

显式 idle timeout 对 visible 浏览器也生效；这是 LLM 忘记 `close` 时的首要自动收尾机制。原生默认一小时且 headed 可豁免，不能依赖原生默认。

### Sessions

所有管理命令显式带受管 config 路径，因此菜单总是处理该 config 中的 `pi-browser` namespace，不受当前项目 `agent-browser.json` 干扰。这是本包管理自己会话的确定性，不是限制 Agent。

- `agent-browser --config <path> session list --json`：列会话；
- 每个会话再以 `session info --json` 展示 running/stale、页面数与 daemon pid；
- 单个 `close`：关闭其 daemon 和所拥有的 Chrome 进程树，持久 Profile 留在磁盘；
- `close --all --json`：关闭受管 namespace 的所有会话；
- `doctor --offline --quick --json`：只做离线快速诊断并自动清陈旧 pid/socket/version sidecar，不带 `--fix`，因此不会安装或重装浏览器。

Pi `session_start` 只提示仍存活的会话；`/reload` 与无 UI 场景跳过。不会启动时擅自关闭：任务会话可能属于其它进行中的任务，10 分钟 idle timeout 才是自动关闭边界。

### CLI 解析（Windows 必须）

`pi.exec` 以 `shell: false` spawn。Windows 上 npm 全局安装的 `agent-browser` 实际是 `.cmd` 垫片，不经 shell 无法拉起，裸调用必然失败（exit 1、无输出，0.3.0 曾因此误报 not found）。所有版本探测与 session 命令统一经 `resolveAgentBrowserCommand()` 解析：按 PATH 可执行文件 → `~/.agent-browser` 独立布局 → npm 全局根的顺序取**原生平台二进制**（`bin/agent-browser-<platform>-<arch>.exe`），其次经当前 node 运行包内 `bin/agent-browser.js`；仅返回 existsSync 命中且可直接 spawn 的目标，Windows 上永不返回无扩展名 sh 垫片。全部找不到时诚实报缺失并提示安装命令。

Windows 上，agent-browser 0.37.1 把自有 Chrome 进程放入 Job Object；daemon 退出或被杀时整棵 Chrome 进程树跟随结束。外部 attach 的浏览器不归它所有，也不在本包清理承诺内。

### Setup commands

Setup 只在只读面板打印命令，**没有确认执行、没有 `pi.exec` 安装分支**：

```bash
npm install -g agent-browser
agent-browser install
npx skills add vercel-labs/agent-browser -a pi -y -g
```

并给出一次性登录流程：

```bash
agent-browser --headed open about:blank
# 登录完成后
agent-browser close
```

用户必须自行在终端执行。`agent-browser install` 在本 Windows 环境曾出现“获取 Chrome for Testing 版本元数据超时”，而 curl 可访问同一地址；因此本包不得把打印命令说成安装成功，也不在扩展中私造下载 fallback。

## 配置优先级与明确边界

agent-browser 自身优先级从低到高为：

1. `~/.agent-browser/config.json`；
2. 当前项目 `agent-browser.json`；
3. `AGENT_BROWSER_*` 环境变量；
4. CLI 参数。

本包遵循用户 2026-09-15 锁定的产品边界：**只协助，不锁死**。

- 不注册 browser custom tool；
- 不覆盖或拦截 Pi 的 Bash/PowerShell；
- 不拒绝 `--profile`、`--session`、`--namespace`、`--config`、`--args` 等参数；
- 不净化环境变量；
- 不承诺项目配置或 Agent 显式参数不能覆盖用户默认值；
- 不替用户安装 CLI、Chrome for Testing 或 skill。

稳定的默认体验来自配置中的持久 `profile` 与 namespace；session 由任务自取，若调用者主动覆盖 profile/namespace，agent-browser 按自己的正常优先级工作。

## 路径

| 内容 | 位置 |
| --- | --- |
| agent dir | `PI_CODING_AGENT_DIR` → `PI_AGENT_HOME` → `~/.pi/agent` |
| agent-browser 用户 config | `AGENT_BROWSER_CONFIG` → `~/.agent-browser/config.json` |
| 新持久 Profile | `<agent dir>/pi-browser/profiles/agent-browser/` |
| 截图等产物 | `<agent dir>/pi-browser/artifacts/` |
| Chrome for Testing 缓存 | `~/.agent-browser/browsers/` |
| 官方 skill | `<agent dir>/skills/agent-browser/`（兼容探测旧 `~/.agents/skills/agent-browser/`） |
| 旧 Playwright 副本 | `<agent dir>/pi-browser/profiles/default/`（不再使用，不自动删除） |

## 已移除的旧模型

以下不再属于当前产品：

- `playwright-cli` 安装、配置与 session 管理；
- `~/.playwright/cli.config.json`；
- Target 浏览器 × Profile 选择；
- 直连真实 Edge/Chrome Profile；
- Cookies / Local Storage / IndexedDB 导入、重导、冒烟和 scratch config；
- import state 与旧副本清空菜单；
- 手动登录会被重导覆盖的双轨体验。

旧磁盘数据不在升级时静默删除。新旧 Profile 分路，避免新引擎破坏历史数据。

## 验证

```bash
npm --workspace @bytetrue/pi-browser test
npm --workspace @bytetrue/pi-browser run typecheck
npm --workspace @bytetrue/pi-browser pack --dry-run
git diff --check
```

真实 CLI 回归应确认：生成 config 后无 `session` 键；Chrome argv 使用 `profiles/agent-browser`；关闭再打开后 localStorage 仍在；后台 daemon 收到显式 `10m` timeout；单个 close、close all、doctor quick 均只处理该 namespace；Setup 页面只显示三条准确命令且不会执行任何安装。

## 证据

- 实现：`packages/pi-browser/src/`
- 用户文档：`packages/pi-browser/README.md`
- 本轮替换：`codestable/epics/005-o-browser-direct-profile-target/issues/003-x-agent-browser-core-replacement.md`
- 旧模型历史与反证：`codestable/epics/005-o-browser-direct-profile-target/issues/001-x-m0-real-profile-pierce.md`、`002-x-target-decouple-and-gates.md`
