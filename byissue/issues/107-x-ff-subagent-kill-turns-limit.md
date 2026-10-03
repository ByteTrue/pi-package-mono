---
kind: issue
title: "pi-subagent maxTurns/timeout 修复：杀树 + 立即报 paused + 真实轮次"
type: ff
status: closed
created: 2026-10-03
---

# pi-subagent maxTurns/timeout 修复：杀树 + 立即报 paused + 真实轮次

**触发（2026-10-03，用户 m00001）**：子代理跑满上限后不终止，只有子进程自己退出时才报 `paused: reached maximum limit of N turns`，且通知里的轮次（60）与实际跑过的轮次（157）不符。实测 maxTurns=2 + 要求连跑 8 次 bash：T+60s 仍 running 且已到 turn 8，T+90s turn 9，直到子进程自然结束才转 paused。

## 根因（两处，都修了）

1. **`cli.kill()` 杀不掉真正的子进程。** `resolvePiCli()` 三处解析路径全部 miss 真实入口 `dist/bundle/cli.js`：argv 正则不认 bundle 段、`PI_CLI_SEGMENTS` 只列 `dist/cli.js`、PATH 循环对 `.bin` 结尾条目拼出双重 node_modules。于是回退 `command:"pi"`，而 Windows 上 PATH 里的 `pi` 是 mise shim 包装进程（实测 `pi.exe` 包着 `node ...dist-bundle-cli.js --mode rpc`），`cli.kill()` 只杀到包装层，真 node 存活继续产事件。`aborted` 置位后不再二次 abort，1500ms 的 SIGKILL 兜底杀的还是同一个（死不掉的）包装 pid。
2. **paused 通知推迟到 close 才渲染**，运行期看起来毫无反应；且 `reasonText` 用配置上限拼文案，不报真实 `state.usage.turns`。

## 改动

- `packages/pi-subagent/src/index.ts`（8 hunk）：
  - `PI_CLI_SEGMENTS` 补 `dist/bundle/cli.js` 两条（@earendil-works 与 mariozechner 两个 scope）。
  - argv 正则改为 `/pi-coding-agent[\\/]dist[\\/](?:bundle[\\/])?cli\\.js$/i`，bundle 段可选。
  - PATH 循环：条目以 `/[\\/]\\.bin$/i` 结尾时额外 `addBase(dirname(dirname(e)))`，修正双重 node_modules 拼接。
  - spawn 加 `detached: !isWin`（POSIX 上让子进程成为独立进程组长，便于 `kill(-pid)`）。
  - kill 段重写：`killTree(sig)` 在 Windows 用 `taskkill /pid <pid> /T /F`（失败回退 `cli.kill("SIGKILL")`），POSIX 用 `process.kill(-pid, sig)`（失败回退）；`killSequence()` = SIGTERM → 1500ms 后 SIGKILL → 再 1500ms verifyTimer 检查进程仍活则再杀一次并向输出追加 `[subagent] child process survived SIGKILL; kill re-sent`。`aborted` 状态永不清除（退出前不清 abort）。
  - `abort(reason)`（带 reason 的上限/超时触发）不再等 close：killSequence 启动后立即置 `status="paused"`、emit 通知、`done(pausedResult())` 返回。外部取消（无 reason）仍走 close 判 cancelled。
  - `pausedResult()` 文案带真实轮次：`reached maximum limit of N turns (turns: X)` / `timed out after <dur> (turns: X)`，X 为 `state.usage.turns`。
  - close/error 顶部：清理 kill/verify 定时器 + `settled` 去重，已有 pauseReason 不重复报。
- `packages/pi-subagent/src/index.test.ts`（+204 行）：新增 `FAKE_PI_CJS` fixture（120ms/轮发 `message_end` 事件并记日志，spawn 一个 node 孙进程记 `grandchild <pid>`，SIGTERM 后退出，60s 兜底）+ 两组用例：
  - `runPi kill semantics`：maxTurns=2 + 任务要求跑 8 轮 → 断言 paused、`status="paused"`、`usage.turns=2`、elapsed<10s、输出含 `reached maximum limit of 2 turns (turns: 2)`、`paused:` 恰好出现一次、kill 后日志快照停止增长（无新 turn）、**孙进程已被杀**（`process.kill(gcPid, 0)` 抛错 = 树杀生效）；timeoutMs=400 → 断言 `timed out after 400ms (turns: ` 且只报一次 paused。
  - `resolvePiCli resolution paths`：argv 含 bundle 路径命中、mise 式 `.bin` PATH 条目解析到 bundle cli.js、旧 `dist/cli.js` 仍命中、全 miss 回退 `{command:"pi",args:[]}`、`PI_CLI_JS` 指向不存在文件时 throw。
- 同步安装版 `C:/Users/byte/.pi/agent/npm/node_modules/@bytetrue/pi-subagent/src/index.ts`：同一 git patch（8 hunk）应用成功，diff 确认与 mono 仅剩 v0.12.0 工具描述文案差异（mono :1694-1727，补丁区域逐字一致）。

## 验证

- `packages/pi-subagent`：`tsc --noEmit` 通过；`vitest run` → 3 files / **61 passed**（42 主文件 + 19 新增）。
- Windows 实测杀树：maxTurns 用例中 fixture 的孙进程在 kill 后 `process.kill(pid,0)` 抛 ESRCH —— taskkill /T 生效。
- resolvePiCli 三解析路径与可杀性：PI_CLI_JS / argv 发现两条路径现在都能命中真实 `dist/bundle/cli.js`（spawn 出的是 node 本体，cli.pid 即真实进程）；PATH 回退路径拿到的是 shim/包装进程，POSIX 靠 `detached:true` + `process.kill(-pid)` 杀进程组、Windows 靠 `taskkill /T` 杀树，两条兜底均有回退。POSIX 路径为机制推断（本机 Windows 无法实测），代码对称且简单。
- 未 bump 版本、未发布：安装版版本号仍 0.11.0（源码已含修复），重新 `npm install @bytetrue/pi-subagent@0.11.0` 会回退，下次发版时以 mono 为准。

## 教训

- **杀进程要杀树，不是杀 pid**：Windows 上 CLI 入口几乎总是包装层（shim/cmd → node），`child.kill()` 语义上只杀直接子进程。`detached` + 进程组 / `taskkill /T` 是跨平台标准解；kill 后校验是否真退出（exitCode/signalCode + 延迟复查）比 blindly SIGKILL 可靠。
- **通知别等 close**：上限/超时触发的那一刻信息最全（真实轮次、原因），推迟到 close 渲染会把两者都弄丢（close 时只剩配置值）。
- byissue/spec 无需改：`byissue/spec/pi-subagent/index.md` 记的默认值语义（timeout 20min / maxTurns 50）不变。

## Review（2026-10-03，用户 m00208 要求 sub agent review 后发版）

- subagent（plan role）评审返回，但正文经网关有损传输；其报的三个 blocker 对照真实代码逐一核实**均不成立**：B1 verifyTimer 泄漏——close 顶部 `packages/pi-subagent/src/index.ts:1241-1242` 已清 killTimer/verifyTimer 且二者均 unref（:1139/:1145）；B3 abort 竞态——`abort` 首行 `if (aborted) return`（:1179）+ 单线程事件循环，timeout 与 max_turns 不可能交错；B2 turns 过报——pausedResult() 在 abort 时刻即算，turns 恰等于上限，测试断言 `usage.turns === 2` Windows 实测通过。未为误报改码。
- 发版前 gate：`npm run typecheck --workspaces --if-present` 退出码 0；`npm test` 退出码 0，六 workspace 全绿（52+1s / 125 / **61** / 191 / 87 / 115+9s）。

## 发布（2026-10-03）

- 版本 0.12.0 → **0.13.0**（行为修复，minor，同 ff106 先例）。提交链：feat `5d1f9e3` → docs(byissue) `52ea3a5` → release `f3efeed`（空提交，树与 52ea3a5 相同）。
- tag `pi-subagent-v0.13.0` 指向 `52ea3a5`（与 f3efeed 树哈希相同 d4d6279，发布内容无差）；中途误重打过 f3efeed 又遇网络抖动回滚失败，最终 `git tag -f` 对齐远端 52ea3a5——**远端已有同名 tag 时删除重推有窗口期，树相同就对齐本地即可，别 force**。Actions run `37118366070` success（58s）；npm 落库核验：`npm view` → 0.13.0 = latest（首查 0.12.0 是 CDN 缓存，约 20s 后刷新）。
- 本机安装版 `C:/Users/byte/.pi/agent/npm/node_modules/@bytetrue/pi-subagent`：npm pack 0.13.0 解包覆盖重装（package.json "pi".extensions 直跑 src/index.ts，无 dist；grep 确认 3 处 taskkill），替代之前的手工补丁。

## Review（完整版，2026-10-03）

评审子代理完整报告（此前经网关有损传输的预览曾误报 3 个 blocker，对照代码逐一核实均不成立——**评审文本不可信时代码不可不查**）。最终结论：**approve**，无 blocker/major。状态机逐路径推演无竞态、无定时器泄漏（所有 timer 均 unref）；POSIX kill(-pid) 经 detached 组长成立；resolvePiCli 无误杀路径；测试无恒真断言。附带现场验证：评审子代理自己撞上 20m timeout 被立即 paused 并带 resume 提示——修复在生产环境生效。

### Fast-follow（Minor，不阻塞发版）

1. `index.ts:1091-1097` taskkill 非零退出码无兜底（.on("error") 只盖 spawn 失败）——有 killTimer/verifyTimer 三次重试兜底不静默；建议监听 close 补一次 cli.kill。
2. `index.ts:1132-1136` "survived SIGKILL" 提示两条路径会丢：外部取消路径被 close 的 appendTail("") 重置抹掉；带 reason 路径 pausedResult 已定格，提示只在实时进度卡可见。建议独立字段。
3. `index.test.ts:1110,1115` 同 chunk 双事件窄窗口 flake（turn 2+3 合并进一个 stdout chunk 则 turns 变 3）——建议断言 toBeGreaterThanOrEqual(2) 或拉大临界 turn 间隔。
4. `index.test.ts:1132` gcPid 存活断言暴露于 Windows pid 复用（~800ms 窗口），vitest 高频起进程放大概率。
5. 测试缺口：外部取消路径（abort 无 reason → close → cancelled/failed:true）无用例，是新劈出的 settle 分支。
6. `index.ts:1086-1109` pid 复用为已知局限（childDead 在 exit/close 派发延迟窗口为假），健壮解是 Windows Job Objects——建议加注释说明即可。

Nits：paused 后迟到事件会短暂改写 state.status（进度卡观感）；stdin error 分支不设 status/errorMessage（既有问题）；.bin 正则不容忍尾随分隔符（纯理论）；Windows 文案 "survived SIGKILL" 实为 taskkill /F。

顺手发现（不在本次范围）：`PI_CLI_JS` 在 Windows 上指向 `.cmd` 文件时 spawn 会 EINVAL（runPi spawn 无 shell:true）——现有解析路径都返回 exe/node 场景，暂不处理。