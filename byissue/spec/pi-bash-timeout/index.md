# pi-bash-timeout（small extension）

## 定位

`small-extensions/pi-bash-timeout` 是一个可选的事件钩子小扩展：给 Pi 内建 `bash`/`powershell` 前台工具补 300s 默认超时、钳制显式超大值，并在超时被杀瞬间追加引导块。不注册任何工具、不接管执行——`tool_call` + `tool_result` 两个事件钩子是它的全部表面。

**发行形态：small extension，非 npm 包**（BYTE-10，2026-10-10 成员拍板）。单个 `.ts` 文件即全部运行时（`pi-bash-timeout.ts`，零运行时导入——运行时守卫直接比较 `event.toolName`，type-only import 加载即消失；jiti 直跑 TypeScript）。安装走仓库脚本（`scripts/install-small-extension.sh` / `.ps1`）：从 GitHub raw（main 分支）下载文件，复制进 `~/.pi/agent/extensions/`；零参数、幂等覆盖、失败非零退出。更新 = 重跑脚本；无版本锚点、无缓存、无 `--ref`（成员定稿，作废清单：持久缓存目录、`pi install <本地路径>`、Windows 手动 clone 指引）。

目录内 `package.json` 为 `private: true`、永不发布——存在仅为根 workspaces（`small-extensions/*`）把 typecheck/test 纳入 CI；`files` 字段只列单文件 + README。测试不进用户机器。

由 `@bytetrue/pi-background-terminal` 0.11.x 的 `bash-default-timeout.ts` 拆出（BYTE-10）：外部用户（GitHub #3）的架构检查静态扫描已安装包全部源码（含未使用文件与禁用分支），要求**安装包内物理不含前台超时 hook 源码**的发行形式——运行时开关、no-op 回调、同包备用入口都过不了。不装这个文件，`pi-background-terminal`（0.12+）源码里就没有这个 hook；装了它也不会引入任何后台工具。

Peer：`@earendil-works/pi-coding-agent >=0.80.5`（CI typecheck peer）。决策链（hook 语义，历史）：065（注入）→ 099（钳制 + tool_result 引导）→ 102（600s 收紧 300s）→ **BYTE-10（拆出；先 npm 拆包方案A，后按成员决策改为 small-extension 形态，语义不变）**。

## 当前表面

- `tool_call`（bash/powershell）：无 timeout（含 `0`、负数、NaN、±Infinity——`isUsableTimeout` 判缺省）注入 300s；显式 >300s 钳到 300（闭区间：恰好 300 原值放行）。
- `tool_result`：仅 `isError` 且错误文本匹配 `Command timed out after \d+ seconds`（Pi core bash.js 的措辞，core 改版则引导静默失效、cap 本身不受影响）时，追加一条引导块：300s 上限、长命令走 `background_run`、挂起先查因再重试；回传 details/isError/usage（agent-session 对 hook 结果是替换不是合并，漏传会丢截断信息与 full-output 路径）。
- `SHELL_TIMEOUT_SECONDS = 300` 单一事实源，steering 文案插值常量防漂移（099/102 教训）。
- `isUsableTimeout`：finite、positive、真数字才算存在；`0` 视为缺省（Node 惯例 0=无限，恰是本 hook 要防的）。与 `pi-background-terminal` 的 `background_run` 寿命守卫同语义。

## 与 pi-background-terminal 的关系

- **自带拷贝，严禁跨包依赖**（仓库铁律，现为包与 small-extension 之间）：`SHELL_TIMEOUT_SECONDS` / `isUsableTimeout` 两边各持一份小拷贝（本扩展 `pi-bash-timeout.ts`、对方 `src/shell-timeout.ts`），改语义须两边同步——刻意的重复，换取两物可独立安装/卸载。small-extension 必须零运行时导入，拷贝是形态要求。
- 组合安装：`pi-background-terminal`（0.12+）+ 本扩展 = 0.11.x 的完整行为。
- 仅装本扩展：bash/powershell 有 300s 兜底，但无 `background_run` 逃生口——引导文案提到的 `background_run` 不存在时只是无效建议，不报错（README 已注明建议同装）。
- 仅装 `pi-background-terminal`：无 300s 兜底（这正是 GitHub #3 要的形态）。

## 明确不做

- 注册/覆盖/以任何形式接管任何内建工具（`pi-bash-timeout.test.ts` 断言零工具、零命令、仅两个事件订阅）；
- 运行时开关或 no-op 回调（外部检查者要求物理分离，开关无意义——装或不装就是开关）；
- npm 发布、版本化、tag、`--ref` 固定、持久缓存（成员定稿作废清单）；
- 跨包依赖 `@bytetrue/pi-background-terminal`；
- 可配置上限（300s 为暂定值，2026-10-01 用户口径：先观察，若合法慢命令频繁被硬杀再议；逃生口是 `background_run` 的更长寿命）。

## 实现地图

```text
small-extensions/pi-bash-timeout/
  pi-bash-timeout.ts           单文件运行时：SHELL_TIMEOUT_SECONDS + isUsableTimeout + tool_call/tool_result 钩子 + 默认导出 registerBashTimeout
  pi-bash-timeout.test.ts      CI-only：完整 hook 测试套件（13 用例，含包契约断言）
  package.json                 private，永不发布；仅为 workspaces 收编 CI
  README.md                    安装（双平台脚本）、卸载、机制、边界
scripts/install-small-extension.sh    macOS/Linux 安装脚本（raw 下载 → ~/.pi/agent/extensions/）
scripts/install-small-extension.ps1   Windows 安装脚本（同逻辑）
```

## 验证

```bash
npm --workspace pi-bash-timeout test
npm --workspace pi-bash-timeout run typecheck
npm --workspace pi-bash-timeout pack --dry-run   # 元数据反验：private，永不发布
```

真实 Pi 回归还应确认：bash 无 timeout 调用被注入 300s；>300s 显式值被钳；超时错误后出现引导块；删除扩展文件后 bash 恢复原生（无默认超时）。

## 证据

- README：`small-extensions/pi-bash-timeout/README.md`（+ `small-extensions/README.md` 约定）
- 拆出动因与原 hook 语义：`byissue/spec/pi-background-terminal/index.md`（065/099/102 决策链与历史 issue 记录）
- 安装脚本：`scripts/install-small-extension.sh` / `scripts/install-small-extension.ps1`
