# pi-browser

## 定位

`@bytetrue/pi-browser` 是 `agent-browser` 的 Pi 配置与会话清理助手。它不自研浏览器引擎、不注册 agent 工具、不拦截 shell 或 CLI 参数，也不替用户执行安装；Agent 按官方 skill 直接调用 `agent-browser`。

本包只负责三件事：

1. 把 Chrome for Testing 指向一个 Pi 专用、长期复用的持久 Profile；
2. 修改用户级 agent-browser 配置（窗口模式、闲置自动关闭等）；
3. 查看、关闭遗留会话，并清理陈旧 pid/socket 记录。

核心模型是**一套独立测试浏览器 + 一个独立 user-data-dir**，不是 Edge/Chrome 同一 user-data-dir 下的 `Default` / `Profile 1`。后者仍共享总进程锁，不能提供用户要的隔离。

已验证最低 CLI：`agent-browser >= 0.37.1`。该版本在 Windows 上的持久 Profile、session JSON、显式 idle timeout 与 Job Object 进程树收尾均有实测依据。

## `/browser` 当前表面

主菜单固定为：**Status / Configure recommended defaults / Settings / Sessions / Setup commands / Close**。

### Status

只读边框面板展示：

- Pi 专用 Profile 路径及是否已创建；
- `agent-browser install` 下载的 Chrome for Testing 精确路径，未找到时明确提示；
- agent-browser CLI 版本与 `>= 0.37.1` 闸；
- 官方 skill 是否存在及路径；
- 当前用户 config 的 `profile/session/namespace/engine/headed/idleTimeout/executablePath`；
- 受管 namespace 中的活跃会话数；
- 当前项目是否存在会覆盖用户默认值的 `agent-browser.json`；
- 旧 Playwright Profile 是否仍留在磁盘（只告知，不复用或删除）。

### Configure recommended defaults

读取 `AGENT_BROWSER_CONFIG` 指向的文件，否则读取 `~/.agent-browser/config.json`。非法 JSON 拒绝覆盖；合法对象保留本包不管理的键。写前备份、原子替换，Unix 权限为 0600。

本包写入：

```json
{
  "engine": "chrome",
  "profile": "<agent dir>/pi-browser/profiles/agent-browser",
  "session": "pi-browser",
  "namespace": "pi-browser",
  "headed": false,
  "idleTimeout": "10m",
  "screenshotDir": "<agent dir>/pi-browser/artifacts"
}
```

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

Pi `session_start` 只提示仍存活的受管会话；`/reload` 与无 UI 场景跳过。不会启动时擅自关闭，因为同一固定 session 可供后续任务继续复用，10 分钟 idle timeout 才是自动关闭边界。

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

稳定的默认体验来自配置中的持久 `profile` 与固定 session/namespace；若调用者主动覆盖，agent-browser 按自己的正常优先级工作。

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

真实 CLI 回归应确认：生成 config 后 `session info --json` 显示固定 session/namespace；Chrome argv 使用 `profiles/agent-browser`；关闭再打开后 localStorage 仍在；后台 daemon 收到显式 `10m` timeout；单个 close、close all、doctor quick 均只处理受管 namespace；Setup 页面只显示三条准确命令且不会执行任何安装。

## 证据

- 实现：`packages/pi-browser/src/`
- 用户文档：`packages/pi-browser/README.md`
- 本轮替换：`codestable/epics/005-o-browser-direct-profile-target/issues/003-x-agent-browser-core-replacement.md`
- 旧模型历史与反证：`codestable/epics/005-o-browser-direct-profile-target/issues/001-x-m0-real-profile-pierce.md`、`002-x-target-decouple-and-gates.md`
