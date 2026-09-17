---
kind: issue
title: "用 agent-browser 替换 Playwright 核心，回到单一专用 Profile"
type: refactor
status: closed
created: 2026-09-15
---

# 用 agent-browser 替换 Playwright 核心，回到单一专用 Profile

> **读者：** 跨会话接手的人——这不是再增加一种 Target，而是撤掉原来的 Playwright/真实 Profile/导入模型，换成一个 Pi 专用的 Chrome for Testing Profile。

## 做成以后是什么样

`/browser` 只协助用户准备和维护 `agent-browser`：展示安装 CLI、下载 Chrome for Testing、安装官方 skill 的命令；把同一个持久 Profile、固定 session/namespace、窗口模式和闲置回收时间写入用户级 `agent-browser` 配置；查看并关闭遗留会话。Agent 仍按官方 skill 直接使用 CLI。

默认配置的可观察结果：

- 所有普通 `agent-browser` 调用都复用 `<agent dir>/pi-browser/profiles/agent-browser`；用户在可见窗口登录一次，关闭再开仍是同一份登录态。
- session 与 namespace 均为 `pi-browser`，遗留进程优先复用而不是重复抢 Profile。
- 显式 `idleTimeout: "10m"`；可见窗口也会在十分钟无操作后关闭，不依赖 LLM 记得执行 `close`。
- `/browser → Sessions` 能列出这个 namespace 的会话，单个关闭、全部关闭，并通过 `doctor --offline --quick` 清理陈旧的 pid/socket 记录。
- `/browser → Setup` 只显示命令，绝不替用户执行安装。

**范围包含：** agent-browser 配置、CLI/skill 探测、Setup 命令面板、Status、Settings、Sessions、启动遗留提醒、README/spec/测试迁移。

**明确不包含：** 注册 agent 工具；拦截 Bash；拒绝 CLI 参数；锁死或净化环境变量；替用户安装 CLI/skill/浏览器；连接日常 Edge/Chrome Profile；迁移或导入旧浏览器登录数据。

## 为什么现在做

真实 Edge 的 `Default`、`Profile 1` 等仍共享同一个 user-data-dir 根锁，不能提供进程隔离。此前依赖提示词阻止 LLM 覆盖目标也不可靠。用户已明确选择 agent-browser 的独立测试浏览器模型，同时把产品边界锁为“协助配置与清理”，不做强制执行层。

Windows 穿刺已确认 agent-browser 0.37.1：显式 Profile 路径会成为独立 `--user-data-dir`；关闭再打开后 localStorage 仍存在；进程 argv 使用指定测试浏览器与指定目录。原生 `agent-browser install` 在本机曾因版本元数据请求超时失败，因此 Setup 必须只诚实展示官方命令和状态，不宣称安装成功，也不代跑或自造下载器。

## 方案与实现安排

1. 新 profile 使用 `profiles/agent-browser`，不复用旧 `profiles/default`，避免 Chrome for Testing 打开由 Edge/Playwright 生成的旧副本。
2. 用户级配置默认位于 `~/.agent-browser/config.json`（尊重 `AGENT_BROWSER_CONFIG`）；原子写入并备份，保留本包不管理的未知键。
3. 本包管理 `profile/session/namespace/engine/headed/idleTimeout/screenshotDir`；探测到 agent-browser 自有 Chrome for Testing 后可显示其路径，不因缺失而伪造可执行路径。
4. Setup 面板原样显示：`npm install -g agent-browser`、`agent-browser install`、`npx skills add vercel-labs/agent-browser -a pi -y -g`，另给一次性登录命令；没有确认框、没有 `pi.exec` 安装路径。
5. Sessions 的所有管理命令显式使用受管 config，避免当前项目的 `agent-browser.json` 把菜单切到另一 namespace；这只是保证本包管理自己创建的会话，不限制 Agent 的 CLI 自由。
6. 删除目标选择、真实 Profile、导入、旧 state、Playwright scratch config 与对应测试；磁盘上的旧 Profile 不自动删除。

## 验证

- 单测：配置合并/备份/非法 JSON；固定 Profile 与十分钟 idle timeout；Settings 只改目标键；Setup handler 不执行命令；session list/info/close/doctor 的成功、异常和脏输出；启动提醒。
- 集成：用 agent-browser 0.37.1 读取生成配置，打开独立 Profile，确认 session info、Profile argv、关闭与重开持久化；验证显式 timeout 被后台进程接收。
- 全包：`npm --workspace @bytetrue/pi-browser test`、`typecheck`、`pack --dry-run`、`git diff --check`。

## 执行进展（2026-09-15）

已完成代码替换：`/browser` 现在只有 Status、Configure、Settings、Sessions、Setup；Setup 的实现路径没有任何安装 `pi.exec`；配置固定新 Profile/session/namespace，并默认写显式 `idleTimeout: "10m"`；session 管理显式加载受管 config；旧 Target、真实档案、导入、state 与 Playwright scratch config 源码和测试均已删除。README、包元数据、project spec 与 Epic spec 已切到新真相。

验证证据：

- 包单测：7 个测试文件、31 项全过；包含 Setup 不执行命令、准确 `-a pi -y -g` 文案、配置安全、Chrome for Testing 探测、session list/info/close/doctor 与“list 本身失败仍可 doctor 清理”的回归。
- TypeScript 类型检查通过；npm `pack --dry-run` 只包含 README、package.json 和 7 个运行时源文件，不带旧实现或测试；`git diff --check` 通过。
- Windows 真实 `agent-browser 0.37.1`：用同一配置启动 headed Chrome，`session info --json` 返回 namespace `pi-browser-integration`、session `pi-browser`、daemon pid 与一页；把显式 timeout 缩到 3 秒后，静置 6 秒 `session list --json` 已为空，证明 visible 浏览器不再享受默认豁免；自动关闭后重开同一 Profile，localStorage 值 `persisted` 仍在；`close --all --json` 关闭 1 个会话；`doctor --offline --quick --json` 成功且 fail=0。
- 全仓测试除一个与本包无关的既有 Windows 路径问题外均通过：`pi-background-terminal` 测试把 `/tmp/bt-path-check.txt` 当成 `C:\\tmp\\...` 读取而目录不存在；同一轮 pi-browser 31 项仍全过。本 issue 不越界修改该包。
- Impeccable UI 机械检查对 `browser-command.ts` 返回空问题集。

临时集成 Profile、测试 namespace 与本地 agent-browser 安装目录在收尾时删除；不会改动用户真实 Edge/Chrome Profile，也不会发布包。

## 关闭时

- project spec 已整体改写为 agent-browser 协助层；旧目标三元组、登录态导入和 Playwright 会话语义已移出当前真相。
- Epic 005 已标明“直连真实 Profile”被本 issue 的独立专用 Profile 模型取代，不再继续活档案穿刺。
- 遗留：旧 `<agent dir>/pi-browser/profiles/default` 只保留在磁盘，不自动迁移或删除；由未来单独的数据清理决策处理。

## 发布记录（2026-09-15）

- 版本：`0.2.0` → `0.3.0`（核心引擎替换，用户可见行为变更，minor）。
- 提交：`8fa6fdc`（feat(pi-browser)!）；tag `pi-browser-v0.3.0` 触发 release.yml（Trusted Publishing OIDC）。
- registry 确认：`npm view @bytetrue/pi-browser dist-tags.latest` = `0.3.0`。
- 全仓 typecheck 与 543 项测试（含本 issue 31 项）在发布前全绿；GitHub run 页面因本机网络代理拦截 api.github.com 未逐条核对，以 registry 为准。
