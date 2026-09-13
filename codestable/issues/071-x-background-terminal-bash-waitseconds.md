---
kind: issue
title: "bash 覆盖 + waitSeconds：单工具统一前台/后台命令执行"
type: feature
status: closed
closed: 2026-09-11
created: 2026-09-10
---

# bash 覆盖 + waitSeconds：单工具统一前台/后台命令执行

> **读者：** 跨会话接手的人——「要做成什么、别碰什么、现状与方案是否还成立、怎么验、关了要回写哪里」。

## 做成以后是什么样

模型只有一个命令执行入口 `bash(command, timeout?, waitSeconds?)`。不传 `waitSeconds` 时行为与内建 bash 完全一致；传了则在同步等待与后台运行之间自动切换：等待期内退出→内联返回输出，超期→转后台、返回 task id、退出自动通知。`background_run` 工具消失，被 `waitSeconds: 0` 收编；`background_status` / `background_kill` / `/background` / footer / 通知机制保留。

**范围：** 覆盖 `bash` 与 Windows `powershell`；`waitSeconds` 语义与 `timeout` 交互；删除 `background_run`；065 默认超时注入与覆盖的整合；spec/README 重写。**不包含：** 交互式 stdin/PTY、自定义 workdir/env、输出分页（仍交给内建 `read`）。

**归属：** 独立 issue。来源讨论：`codestable/talks/005-background-terminal-bash-waitseconds.md`；翻转的旧决策：`codestable/issues/039-x-background-terminal-standalone-tools.md` 已确认决策第 1 条（不覆盖内建工具）——用户已确认翻转（2026-09-10）。相关 spec：`codestable/spec/pi-background-terminal/index.md`。

## 为什么现在做 / 当前坏在哪

- 真实使用中模型工具选择困难：要么全走 `background_run`，要么全走 bash，二选一变成掷硬币。
- 根因（talk 005 已论证）：当前工具边界画在"命令要跑多久"上——时长是模型无法预测的；模型每次调用真正确定的只有"要不要阻塞"。
- 现状缺陷：后台任务没有任何超时兜底，挂死任务无声（永远 running、永远没有通知）；`background_run` 描述里的 "long builds/tests use me" 是预测轴措辞，主动教坏。

## 现状怎么工作

内建 `bash(command, timeout?)` 同步执行，无默认超时（065 ff 用 `tool_call` 钩子注入 600s）；`background_run(command)` 立即转后台，无超时上限；退出经 `followUp + triggerTurn:true` 唤醒，忙碌期缓冲到 `agent_settled`；输出落盘 `$TMPDIR/pi-background-terminal/<id>.log`。

## 动哪些、验哪些

- **必须改**：`src/index.ts`（注册 bash/powershell 覆盖，改注册三工具为两工具）；新建 `tools/shell-override.ts`（组合 schema + execute 分派）；`tools/background-run.ts` 删除；`bash-default-timeout.ts` 与覆盖整合（带 `waitSeconds` 的调用跳过 600s 注入；`timeout` 语义变为总寿命硬杀）；`background/manager.ts`（暴露"等待竞态"入口，内联返回路径的输出读取与截断）；README、spec。
- **需要验**：不传 waitSeconds 与内建逐字节一致；竞态三边界（等待中退出 / 转后台瞬间退出 / `timeout ≤ waitSeconds` 时同步等死与转后台后等死的行为定义）；转后台路径的通知契约不回退；真实 Pi 回归（普通命令、dev server、快路径内联返回、自动唤醒）；`/reload` 存活回归。
- **仍未知**：~~`timeout ≤ waitSeconds` 时的行为选择~~ 已由实现自然解决：硬杀发生在等待期内（ops.exec 原生超时），竞态以内联 `Command timed out after N seconds` 错误就地可见，与内建语义一致。

## 方案与实现安排

- **组合不重写**：schema 从 `createBashToolDefinition()` 的定义运行时组合（追加 `waitSeconds`）；默认路径直接调用内建 execute 转发（038 验证过委托路径）；waitSeconds 路径复用 `createLocalBashOperations().exec()` + 现有 manager（`exec` 原生支持 `timeout` 与 `AbortSignal`）。render 沿用内建（覆盖工具不注册自定义 renderCall/renderResult，Pi 按文档回退内建渲染器）。
- **语义**：`waitSeconds` 省略 = 纯前台（同今天）；`0` = 立即转后台；`N>0` = 同步竞态。`timeout`（若设）= 总寿命硬杀，覆盖同步与后台两段；不设则后台任务不限寿命。
- **风险与穿刺**：schema 遮蔽靠组合 + peer 下限 + changelog 跟踪；bash 覆盖失败/包卸载自动回退内建。第一刀先穿刺「覆盖注册 + 纯委托」证明零行为差异，再加 waitSeconds 分支。
- **质量承诺**：兼容性/隔离性（默认路径零差异）；功能正确性（竞态边界）；性能效率（零轮询、通知驱动不变）；可维护性（无手抄 schema 副本）。

## 验证

- 单测：默认委托路径（不传 waitSeconds 时与内建 execute 同参调用）；waitSeconds=0 等价旧 background_run；N>0 快路径内联返回（含截断）与慢路径转后台；`timeout` 在转后台后到点必死（timed_out 状态 + 通知）；带 waitSeconds 跳过 600s 注入；既有 manager 回归全绿。
- 真实 Pi 非交互回归（自然语言不提示工具名）：普通命令只走 bash 且行为不变；明确"别等它"的命令得到 task id；"等一下但别卡死"的命令在慢时得到转后台+后续通知；dev server 不被 600s 杀死；`/reload` 后任务仍可见可停。
- `npm pack --dry-run` 干净；全仓 typecheck + test。

## 执行记录

### 2026-09-10 实现

- 新建 `src/tools/shell-override.ts`：覆盖 `bash` 与 `powershell`。schema 从内建定义运行时组合（`{...proto.parameters.properties, waitSeconds}`），不手抄；promptSnippet/promptGuidelines/label 从 prototype 定义读取（不依赖文档说的继承，显式携带）；renderCall/renderResult 省略→按槽位回退内建渲染器；不传 waitSeconds 时纯委托内建 execute（含 038 验证过的同一路径）。
- 委托定义延迟到首次 execute 用真实 ctx 创建，按 `${trusted}:${cwd}` 缓存：内建 bash 由 Pi 用 `SettingsManager` 的 `shellPath`/`shellCommandPrefix` 创建，ExtensionAPI 不暴露 SettingsManager，故用公开导出的 `SettingsManager.create(cwd, undefined, {projectTrusted})` 读同一批文件，**尊重项目信任状态**（未受信项目的项目层 shell 设置不生效，与 Pi 自己的创建一致）；损坏的 settings 文件 fail-open 回退默认。powershell 内建不带 settings 选项，直接创建。
- `src/background/manager.ts`：
  - `start()` 增加 `options`（`timeoutSeconds`、`shell`、`suppressNotify`）；超时硬杀直接传给 `ops.exec(timeout)`（Pi 原生 killProcessTree + `timeout:N` 拒绝），catch 中识别为 `timed_out` 状态（与 killed/failed 可区分）；shell 选择 bash/powershell 两套 operations。
  - 新增 `startAndWait(command, cwd, sessionId, {waitMs, timeoutSeconds, shell})`：waitMs>0 时 `waitFor` 竞态（settled 内联 / 超时降级），内联路径 `inlineResult` 读输出文件并复刻内建 bash 的返回形状（`truncateTail` 截断 + `[Showing lines X-Y of Z. Full output: path]` footer + details.truncation/fullOutputPath；非零退出抛 `Command exited with code N`、超时抛 `Command timed out after N seconds`、abort 抛 `Command aborted`）；waitMs=0 等价旧 background_run。
  - 通知去重：被等待的任务 `suppressNotify`（内联结果已包含结局，退出通知将是重复唤醒）；降级路径 `notifyOnSettle` 重新武装，`maybeNotify` 用 `notified` 标志保证竞态下恰好一次。
  - 内联完成后任务保留在 map（settled，不可见于 /background 与 footer）直到 session 清理——截断时 footer 引用的输出文件需要存活；文件由 clearSession 统一删除。
- 删除 `tools/background-run.ts` 及测试；`index.ts` 注册两个覆盖 + 两个管理工具，`formatExitMessage` 增加 timed_out 文案；`bash-default-timeout.ts` 对带 `waitSeconds` 的调用跳过 600s 注入（否则降级的 dev server 会被默认值杀死）。

### 2026-09-10 验证

- 单测：本包 44 tests 全绿（新增 `shell-override.test.ts` 11 tests：schema 组合、纯委托零任务残留、waitSeconds=0 立即降级、内联返回、内联非零退出形状、降级报告、timed_out 硬杀、截断 footer、输出文件同一性、内联不触发重复通知、降级恰一次通知）；全仓 507 passed / 9 skipped；typecheck 通过；`npm pack --dry-run` 9 文件无测试泄漏。
- 变异验证（每个变异杀死对应测试后恢复）：去掉通知抑制→重复通知测试红；内联路径失效→3 测试红；hook 不跳过 waitSeconds→红；timeout 不传给 exec→timed_out 测试红。
- 真实 Pi 0.85.1 非交互回归（自然语言，未提示工具名）：普通命令纯委托行为不变；`waitSeconds=10` 快路径内联返回；`waitSeconds=2` + sleep 30 自动降级并报告 task id 与输出文件；`waitSeconds=0` + `timeout=3` + 无限循环命令后台启动、3 秒后 `timed_out`；2100 行输出内联截断 footer 正确（模型自主理解可去文件看全量）。

### 2026-09-11 Review 轮（两个独立只读 subagent：正确性 + ponytail）与修复

**Verdict 均为 BLOCK，修复后复验全绿。**关键发现与处置：

- **P0（已修）**：重构 trust-aware 版本时丢失 `type ExtensionAPI` import，typecheck 红而 vitest 照绿（vitest 不做类型检查）；此前执行记录中「typecheck 通过」的声明有误，已修正流程：每次 typecheck 单独跑。
- **#3 powershell 覆盖激活（已修，推翻先前记录）**：reviewer 从源码发现 `includeAllExtensionTools: true` 会把**所有** extension 注册工具推进 active 列表——先前「注册≠激活」的论断错误，真实 Pi 实证：macOS 上工具列表变成 bash+powershell（基线只有 bash），且 powershell 在非 Windows 上被调用会直接 failed。修复：**彻底不覆盖 powershell**（连 Windows 也不覆盖：默认 active 集在所有平台都不含它，覆盖反而添加工具）。600s hook 仍按名覆盖 powershell，不受影响。manager 的 shell 参数/powershellOps 同步删除。
- **#4 wait 路径丢弃用户 shell 设置与 PI_* 会话环境（已修）**：委托路径经 SettingsManager 尊重 shellPath/commandPrefix，wait 路径原先裸 ops + 无 env，同工具同参数行为分叉且违背 promptGuidelines 的 PI_* 承诺。修复：settings（commandPrefix/shellPath）与 sessionEnv（PI_SESSION_ID/FILE/PROVIDER/MODEL/REASONING_LEVEL）透传进 runWithWait；新增测试锁定 PI_SESSION_ID。已知边界：base env 用 process.env，未复刻内建的 agent-bin 目录 PATH 前置（不可导出）；upgrade trigger 已写在代码注释。
- **#5 abort signal 被忽略（已修）**：等待期 Esc 原先不杀任务且降级后还会唤醒 agent。修复：signal 进入竞态，abort → 杀任务（静默）+ 抛 `Command aborted`（带已产出输出，与内建同形）；测试 + 变异验证。
- **#7 peer 下限（已修）**：`>=0.80.4` 是 npm 上不存在的幽灵版本；实测 0.80.5 已含全部新用 API（SettingsManager 三参 create、truncateTail、BashToolDetails、AgentToolResult、isProjectTrusted、isToolCallEventType 泛型）。上调至 `>=0.80.5`，README 恢复版本说明行。
- **ponytail 减重（采纳）**：WaitResult 中间类型删除（startAndWait→runWithWait 直接返回 AgentToolResult，降级文案归 manager）；waitFor 手写 race → Promise.race + unref timer；inlineResult/readTail 收口；死参数（outputPath、session 复验、ShellToolInput.command）删除；净 -35 行。
- **#8/#9（采纳）**：footer 补齐内建的三分支（lines/bytes/lastLinePartial）；错误路径空输出不再加「(no output)」前缀（与内建 formatOutput(snapshot, "") 一致）。
- **#10（采纳）**：inline 读文件加 2MB 上限（防 `yes` 类病理性输出 OOM 宿主），超限时读尾部并从跟踪的 lineCount 修正 totalLines。
- **#11（采纳）**：waitSeconds=0 文案改为「Started in the background.」。
- **#12（采纳）**：仓库根 run1.sh（回归脚本遗留）删除。
- **reviewer 查证后保留的承重结构**：SettingsManager 复刻链、notified 标志（微任务序证明防双发）、clearTimeout/unref、手写 footer（vs 注入自定义 operations 会制造新泄漏口）、24h mtime 阈值。

**复验**：本包 513 passed / 9 skipped（三轮稳定，含并发竞态修复后的 sweep 测试）；typecheck 0 错；全仓全绿；pack 10 文件；真实 Pi 0.85.1：Shell 工具列表仅 bash（#3 验证）、全部场景重跑无回归、生产目录零新泄漏。新增变异验证：live-task 保护移除→红、abort 不杀→红、PI_SESSION_ID 不注入→红。

### powershell 工具的事实背景（2026-09-11 review 后修正）

用户问「pi 不是只有 bash 工具吗」。事实：Pi 有两个内建 shell 工具，`bash` 与 `powershell`，但**所有平台的默认 active 集都只有 bash**（`["read", "bash", "edit", "write"]`）；powershell 是 `--tools`/SDK 显式启用的 opt-in 工具。最初记录的「注册≠激活」论断**错误**：`includeAllExtensionTools: true` 会把所有 extension 注册工具强制激活，覆盖 powershell 会在 macOS/Linux 工具列表凭空多出一个（真实 Pi 实证过），非 Windows 上被调用还会直接 failed。最终决策：**不覆盖 powershell**，600s hook 仍按名覆盖它。详见上方 review 轮 #3。

### 回归中发现的新问题（不在本 issue 范围，待用户决定）

- **`$TMPDIR/pi-background-terminal/` 存在 345 个泄漏日志文件**（318 个历史 + 27 个当日）。深入定位后修正了最初判断：
  - print 模式（`pi -p`）**会**触发 `session_shutdown(reason: quit)`，当前代码下清理路径完整（实验验证：clearSession resolved、文件删除、进程杀死）；当日 19:07–19:10 的泄漏来自实现中途的中间态代码，不是缺陷。
  - 真实的泄漏口是**交互模式崩溃路径**：`uncaughtCrash`/`emergencyTerminalExit` 只调 `killTrackedDetachedChildren`（只杀进程、不 fire session_shutdown）；任何 uncaught exception 或终端 EIO 崩溃都会留下孤儿日志文件。三周 318 个文件的分布与“偶发崩溃 + 从不清理”一致。
  - 无孤儿进程（print/交互退出均杀干净）。
- 待决：开新 issue 处理孤儿文件兑底（见 issue 072）。

## 关闭结论

- **关闭判断**：目标达成。单入口承诺兑现——不传 waitSeconds 纯委托（逐字节内建行为，含 shellPath/commandPrefix/项目信任态）、`0` 收编 background_run、`N` 同步竞态内联/降级；timeout 硬杀与 timed_out 可观测；通知恰好一次；abort 同形。经两个独立 reviewer（正确性 + ponytail）全量审查，blocking 与 should-fix 全部修复后复验全绿。
- **验证摘要**：本包 513 tests（三轮稳定，含并发竞态修复）+ 变异验证七项（通知抑制、内联路径、hook 跳过、timeout 硬杀、live-task 保护、abort 杀、PI_SESSION_ID）；typecheck 0 错（流程修正：独立跑）；全仓全绿；pack 10 文件无泄漏；真实 Pi 0.85.1：Shell 工具列表仅 bash、全场景无回归、生产目录零新泄漏。
- **回写位置**：`codestable/spec/pi-background-terminal/index.md` 全文重写（三表面 → bash 覆盖 + 两管理工具 + 菜单；waitSeconds/timeout 语义、powershell 不覆盖的理由、崩溃路径兑底）；能力地图 `codestable/spec/index.md`；根/包 README。
- **决策翻转记录**：本 issue 翻转了 039 已确认决策第 1 条（不覆盖内建工具），理由与确认链见 talk 005 与本文背景节。
- **遗留**：无。
