---
kind: issue
title: "background terminal 三独立工具：不覆盖 bash，输出落盘，timeout 必传"
type: feature
status: closed
created: 2026-08-01
epic: ""
---

# background terminal 三独立工具：不覆盖 bash，输出落盘，timeout 必传

## 目标

取代 `.cs/issues/038-x-background-terminal-bash-override-redesign.md`（覆盖内建 `bash` 加 `background` 参数的设计）。用户在验收该设计后经过一次完整的 cs 讨论（`.cs/talks/004-background-terminal-redesign.md`），提出两点新要求并最终收拢为本 issue 的形态：

1. 不覆盖 `bash`，不碰任何 Pi 原生工具——三个完全独立、自己命名的工具。
2. 输出落盘而不是内存 buffer（为了控制进入 agent 上下文的量，而不是为了扛 Pi 进程重启）；`timeoutSeconds` 从可选改为必传参数。

## 归属

- 独立 issue，取代 038。
- 相关 spec：`.cs/spec/pi-background-terminal/index.md`
- 相关 talk：`.cs/talks/004-background-terminal-redesign.md`

## 背景与证据

见 talk 文件的完整讨论记录。要点：

- 三工具形态用户已确认：`background_run`、`background_status`（列表+详情合一）、`background_kill`。
- "查看"为什么落盘：用户原话——长命令输出可能很多，如果一次性整段返回给 agent 容易撑爆上下文；落盘后 agent 可以用已有的 `read` 工具选择性地看，不需要我们自己重新实现一套 offset/limit 分页。
- "为什么 timeout 必传"：用户原话——怕长命令卡死没有兜底，这个应该是必传参数。
- 通知机制原样保留：`pi.sendMessage(..., {deliverAs:"followUp", triggerTurn:true})` 用于在命令结束时自动唤醒 agent 继续对话，不是给人看的日志；已核实这正是 Pi 该 API 的设计目的（`docs/extensions.md`：`followUp` 等 agent 空闲时投递，`triggerTurn:true` 空闲时立即触发新一轮 LLM 调用）。
- `/reload` 安全性：沿用上一版已发现并修复的坑——`session_shutdown` 在 `reason === "reload"` 时跳过清理，因为 Pi 的 `/reload` 在同一 session 上重新触发 shutdown/start，不是真正结束。

## 质量目标

- 功能正确性：`background_run` 缺少 `timeoutSeconds` 时报错，不静默退化为"无超时"；超时到达时任务被自动终止且状态与手动 `kill` 可区分（`timed_out` vs `killed`）。
- 可用性 / 上下文效率：`background_status` 不重复实现分页读取，只给文件路径 + 小段预览 + 总行数，全量/大量阅读交给已有 `read` 工具。
- 兼容性 / 隔离性：完全不修改、不注册同名覆盖任何 Pi 原生工具；普通 `bash` 调用行为与安装本扩展前完全一致，以真实 Pi 回归验证。

## 影响范围

- **必须修改**：`background/manager.ts`（文件输出、必传 timeout、`timed_out` 状态、`clearSession` 删除输出文件）；删除 `tools/bash.ts`+测试；新建 `tools/background-run.ts`、重命名重写 `tools/bash-output.ts`→`tools/background-status.ts`、重命名重写 `tools/bash-kill.ts`→`tools/background-kill.ts`；`index.ts`（工具注册、消息类型改名、通知内容含输出文件路径）；`renderers.ts`（消息类型改名）；`constants.ts`。
- **需要验证**：普通 bash 命令行为完全不变；后台启动/查看列表/查看详情/手动停止/超时自动终止/完成自动唤醒；输出文件在真实清理时机被删除。
- **不包含**：`workdir`/`env` 自定义参数、输出文件应用层大小上限（timeout 兜底运行时长，`read` 工具自身截断兜底单次阅读量）。

## 方案判断

- 不覆盖 `bash` 的直接后果是失去"前台/后台统一在一个工具里"的便利，但换来零风险地不影响 Pi 原生工具的既有行为、既有渲染、既有任何未来变化——用户判断这个取舍值得，采纳。
- 落盘 + 复用 `read` 工具，而不是自己重新实现一套分页读取：避免重复造轮子，同时天然限制单次工具调用返回给 agent 上下文的数据量由 agent 自己通过 `read` 的 offset/limit 控制。
- 内部继续复用 `createLocalBashOperations()`：其已有的 `timeout` 校验（`resolveTimeoutMs`）和跨平台进程树 kill（`killProcessTree`：Windows `taskkill /F /T`，POSIX 进程组 `SIGKILL`）直接拿来用，不重复实现。

## 验证

- 单测（真实子进程，不 mock）：
  - `background/manager.test.ts`：启动+捕获输出写入真实文件（读文件内容核对）；`timeoutSeconds` 到达后状态变为 `timed_out`；`kill()` 停止运行中任务标记 `killed`；`clearSession` 删除任务同时删除对应输出文件（`existsSync` 验证消失）；按 session 隔离 get/list。
  - `tools/background-run.test.ts`：立即返回（&lt;2s，命令本身运行更久）；返回内容含输出文件路径；`timeoutSeconds` 缺失时的运行时保护（不静默退化）。
  - `tools/background-status.test.ts`：无 id 列表；有 id 详情含状态/退出码/输出文件路径/行数/预览/"用 read 工具" 提示；未知 id 报错。
  - `tools/background-kill.test.ts`：真的停止运行中任务；已结束任务（含 `timed_out`）返回友好提示不报错；未知 id 报错。
  - `index.test.ts`：只注册 `background_run`/`background_status`/`background_kill` 三个工具、两个生命周期钩子、一个消息渲染器；`/reload` 不清任务、真正 session 结束才清任务的回归（沿用上一版已验证的手法）。
- package typecheck/test 全绿。
- 真实 Pi 0.82.1 非交互回归（自然语言，不提示工具名）：
  - 普通命令：只调用内建 `bash`，行为与未装此扩展时一致（证明零覆盖、零影响）。
  - 后台运行长驻服务：`background_run` 立即返回。
  - 后台运行 + 立即查看列表 + 查看详情：确认能看到输出文件路径与预览。
  - 后台运行 + 手动停止：`background_kill` 真实终止（真实 PID 存活检查）。
  - 故意给一个短 `timeoutSeconds` 但命令跑得更久：验证自动终止、状态为 `timed_out`、事后通过 `read` 工具读到输出文件里已产生的内容。
  - 完成自动唤醒：不调用任何查看工具，直接等待 follow-up 消息触发下一轮。
- 独立 review：待完成。

## 执行记录

### 第三轮：用户要求的 code review + ponytail review

并行跑了两个独立只读 subagent（一个查正确性，一个按 ponytail-review skill 只猎过度设计）。两份报告在一处直接冲突（write-error 测试：一个说弱要加强，一个说是 ceremony 要删），按“把 ceremony 改成真正的行为证明”合并解决。所有关键主张先自己验证再动手，没有直接采信。

**发现并修复的 blocker：`/reload` 实际上在制造孤儿任务。**
Pi 的 `/reload` 通过 jiti `moduleCache: false` 重新 import 每个 extension，会**重新求值整个模块**。我先前那个 `if (event.reason === "reload") return;` 只做到了“不主动杀任务”，但 `export const manager = new BackgroundManager()` 会被重建——旧任务对新 manager 不可见：`background_status` 查不到、`background_kill` 停不了、完成通知打到已失效的 extension ctx 上被吞掉、输出文件永不清理。比“直接杀掉”更糟。已用 Pi 自己的 jiti 配置独立复现确认：`same manager singleton: false`、`B sees A's task: false`。修复：把单例钉到 `globalThis[Symbol.for(...)]`，跨模块重新求值存活（任务仍按 `parentSessionId` 隔离，共享安全）。

**其他真实修复**：
- 成功路径上的 `controller.signal.aborted ? "killed" : "exited"` 是错的。核 Pi 源码确认 `exec` 在 `await waitForChildProcess` 之后才 `if (signal?.aborted) throw new Error("aborted")`，所以能走到 `.then` 就证明没被 abort——该分支要么永不命中要么命中就是错的（会产生自相矛盾的 `status: killed | exitCode: 0`）。改为恒为 `exited`。
- 新增 `failed` 状态。之前 cwd 不存在、这台机器上没 shell（Windows 没装 Git Bash）、timeout 超过 Pi 上限这些“根本没跑起来”的情况都被报成 `exited` + 通知里写“exited with code null”，是向 agent 说谎。核实 `exec` 是 `async`，这些 throw 均会 reject 进我的 catch，确属真实可达路径。
- 链末缺 `.catch()`：`onExit` 一旦 throw 就是 unhandled rejection，Pi 只装了 `uncaughtException` handler，Node 会把它升级成崩掉整个宿主进程——与上一轮那个 write-stream 问题同一类。已补终端 catch。
- `background_kill` 丢弃了 `kill()` 的返回值，任务在 get 与 kill 之间自然结束时会谎报“Stopped”。改为按实际结果报。

**接受的 ponytail 简化**（逐条核实后采纳）：
- 删整个 `renderers.ts` + `@earendil-works/pi-tui` peer 依赖：核实 Pi 的 `CustomMessageComponent` 默认就会渲染带主题色的 `[customType]` 标签 + 盒装 Markdown 正文，自己写的 renderer 反而**丢掉**了这些样式，只为把标签从 `[background-exit]` 改成 `[background]`。
- 删 `constants.ts`（两个常量各只一个消费者，改为使用处的局部具名常量）、删死字段 `done`、删 `outputFailed` 标志（error listener 已经是真防线，标志是叠在上面的推测性防御）、`decoder` 改局部变量、内联单调用的 `outputPathFor()`、去掉多余的对象浅拷贝。
- 手写 `truncate()` → Pi 已导出的 `truncateLine()`。
- `formatStarted` 8 行→两行（`Command:` 只是把模型自己的参数回声，尾部提示与 promptGuidelines 逐字重复）。
- 测试：三份拷贝粘贴的 `waitFor` 轮询 → `vi.waitFor`；三份重复的 `RegisteredTool`/`register()`/`ctx()` → 共享 `test-helpers.ts`（已在 `files` 里排除，不会发布给用户）。

**未采纳及理由**：
- 不删 `background_run` 的 timeout 守卫传递测试（ponytail 建议删）：它护的是“命令不会永远跑”这条不可让步的不变量，属于 ponytail 自己写的“不能简化掉”边界。保留但借共享 helper 瘦身。
- 不做 backpressure 处理、不做孤儿日志扫除：前者已按约定打 `ponytail:` 注释标明天花板与升级路径，后者需要年龄式扫描 + 共享目录处理，在真实观察到之前属于推测。

**新增/加强的测试（均做了变异验证，确认不是空测）**：
- `/reload` 存活：用 `vi.resetModules()` + 动态 import 复现 Pi 的模块重新求值，断言类身份变了（证明真的重求值）但 manager 同一个、旧任务仍可见。去掉全局钉位后该测试失败。
- 完成通知契约（之前 **零覆盖**，是本包招牌行为）：断言 `sendMessage` 带 `{deliverAs:"followUp", triggerTurn:true}`、内容含真实输出；另一条断言其他 session 的任务**不会**被推送进来。拿掉 `triggerTurn` 后该测试失败。
- `failed` 状态、`kill` 跨 session 拒绝、快照不泄露内部字段且不共享可变状态、`Lines so far` 真值、输出文件在真 session 结束时被删。
- write-error 测试从“断言 listener 存在”改成“真的 emit 一个 error，断言 `task.error` 被记录”，并合入 `manager.test.ts`（去掉单独文件）。
- 修了测试自身的泄漏：`afterEach` 之前不会清理进程全局 manager 名下的任务，测试失败时会残留真实子进程（在做变异验证时实际碰到了，已清理）。

**结果**：包体（会发布的文件）从 9 个降到 7 个；测试从 18 条增到 24 条但文件从 6 个降到 5 个（删 ceremony、加真证明）。

**遗留已知窄口**（不修，已权衡）：`/reload` 期间从模块重新求值到 `session_start` 重新填回 `currentSessionId` 之间有一个很短的窗口，恰好在这期间完成的任务会丢掉自动唤醒（任务本身和输出仍可通过 `background_status` 看到，不丢数据）。要堵得加一个 pending 队列，为一个几十毫秒的窗口不值得；比修复前（所有 reload 前的任务全部丢通知**且**全部不可见）严格好很多。

**本轮验证**：全 workspace typecheck 通过；376 tests passed / 9 skipped（本包 24）；`npm pack --dry-run` 7 个文件、无测试与 helper 泄漏；真实 Pi 0.82.1 重跑 E2E（普通 bash 仍只走内建、后台启动、status→kill 三步、自动唤醒三轮 turn）均 0 错误，收尾无残留进程与文件。

- 完成全部实现：`background/manager.ts`（文件输出、必传 timeout、`timed_out` 状态、clearSession 删文件）、三个独立工具、`index.ts`/`renderers.ts`/`constants.ts`；删除 `bash.ts` 覆盖及其测试。
- 第一轮独立 
 review 抨出一个真实 blocker：`createWriteStream` 没有 `'error'` 监听器，磁盘写入失败（ENOSPC/EACCES）会变成 uncaught exception 把整个 Pi 宿主进程拖崩，不只是单个任务失败。已修复：给 `fileStream` 加 `.on("error", ...)`，写入失败时记录 `task.error` 并停止继续写，不影响子进程自身的正常退出/超时/kill 状态流转。新增归回测试（`manager.write-error.test.ts`，用 `vi.mock("node:fs", ...)` 拦截 `createWriteStream` 断言监听器存在），并手动验证过把修复换回去后该测试确实会失败（非空测）。
- 同一轮 review 还页面确认了一个关键事实：Pi 自己的 tool-call 运行时不会根据 TypeBox `parameters` schema 预验证参数就调用 `execute()`（`tool-definition-wrapper.js`/`agent-loop.js` 都无 `Value.Check`/`TypeCompiler` 调用），所以 `manager.ts` 里自己写的 `timeoutSeconds` 运行时守卫不是冗余的防御性检查，而是跨 provider 唯一可靠的强制手段。
- 正常换行计数、文件存在性、clearSession 删文件粗细粒度、三工具描述一致性、测试真实性均已核实无问题。顺带修了一个小正确性遗漏：`tail` 预览之前按块直接 `toString("utf8")`，多字节 UTF-8 字符跨块边界会乱码（仅预览，不影响磁盘上的真实文件），改用 `node:string_decoder` 的 `StringDecoder` 正确缓冲跨块字符。
- 没有发现任何残留的 `bash.ts`/`bash_output`/`bash_kill`/`bash-background-exit`/`background: true` 字样引用（git status 确认覆盖版的整个 src 已删，grep 确认 zero hits）。
- 真实 Pi 0.82.1 非交互回归（`bytetrueapi/claude-haiku-4-5`），没有提示工具名，仅自然语言）：
  - 普通 `echo`：只调 `bash`，行为与未装此扩展时一致（确认零影响）。
  - 后台启动后立即返回，不等不查。
  - 启动+查看列表/详情：能看到输出预览与文件路径。
  - 启动+手动停止：真实终止。
  - 短 timeout（2s）跟长命令（300ms 间隔输出）：自动终止，状态 `timed_out`，模型自主用 `read` 工具读取输出文件，行数对得上（6 行）。
  - 完成自动唤醒（不提示查看工具，只要求启动后等通知）：真实事件流确认三个独立 turn——`background_run` 调用 → 模型说“已后台启动，会通知我”并结束本轮 → 无任何新用户输入情况下自动触发第三轮，报告任务真实完成结果。
  - 每轮测试后 `$TMPDIR/pi-background-terminal/` 均为 0 文件（确认 clearSession 在真实 session 结束时正常删除）。
- 二轮独立 review：第一轮因任务过大超时（500s）；拆小重跑后抨出上述写流 blocker，修复后无遗留 blocking。
- 全 workspace typecheck + test 通过（370 tests passed / 9 skipped，其中 package 自身 18 tests），`npm pack --dry-run` 干净无残留文件。
- **提示词优化**（用户要求“尽可能少 token 把重要的事情讲清楚，同时上下文工程要做好”）：三个工具 `description` 字数从 1611 字符压到 1142（含新增共享 guideline），约减 29%，`background_run` 单项减约 47%。具体做法：删除“从不碰/替换 bash”类冗余声明（架构上已经零耦合，不需要再自辩）；删除 `background_run` 尾部向其他两个工具的重复导航句（模型自己能看到那两个工具的 description）；把“不要轮询 background_status”这条跨工具共享规则从两个 description 里的重复叙述收敛成一条 `promptGuidelines`（只挂在 `background_run` 上，因三个工具总是一起注册，不会缺失）。真实 Pi 回归确认新文案下仍是三轮真实 turn（启动→结束本轮→自动唤醒），全程 **0 次** `background_status` 调用（模型完全依赖自动通知，未轮询）。

## 发布

- 版本号用 **0.2.0**，不是开发期遗留的 0.3.0：npm 上当时只有 `0.1.0`（PTY 版），本会话内那两次 bump（0.2.0 → 0.3.0）都没发布过。留个幽灵 0.2.0 空档只会让人回头问“0.2.0 去哪了”，而 0.1.0 → 0.2.0 在 0.x 语义下正好表达破坏性变更。
- 两个提交：`9f6535e` docs(cs) CS 产物格式迁移（issue 036）、`1768df1` feat(background-terminal)! 本次重写。已推送 origin/main。
- tag `pi-background-terminal-v0.2.0` 触发 `release.yml`（run 30706997778）：typecheck → npm test → OIDC Trusted Publishing 全部 ✓，conclusion success。
- npm 已生效：`latest = 0.2.0`，**零 runtime dependencies**（旧版带 `@lydell/node-pty` + `ws`），peerDeps 仅 `@earendil-works/pi-coding-agent` 与 `typebox`。
- 拉下已发布的 tarball 反验（不是工作区）：7 个文件、测试与 `test-helpers.ts` 均未泄露；真实 Pi 0.82.1 跑自动唤醒场景，三轮 turn（`background_run` → “已启动”结束本轮 → 无用户输入下自动唤醒报告 `published-ok`），0 错误；临时目录、输出文件、子进程均无残留。

## 关闭回写

- project spec：`.cs/spec/pi-background-terminal/index.md`
- 包 README：`packages/pi-background-terminal/README.md`
- 根 README：`README.md`
- 能力地图：`.cs/spec/index.md`

## 关闭结论

- **关闭判断**：目标达成，范围未暗扩。用户提出的四件事（后台跑命令 / 查看 / 管理 / 完成通知）全部实现，且两条硬约束——不覆盖任何 Pi 原生工具、输出落盘以控制上下文——均有真实证据。已发布 0.2.0 并用**已发布的 tarball**而非工作区反验通过。
- **验证摘要**：
  - *功能正确性*：`timeoutSeconds` 缺失/非法时在任何进程启动前抛错；超时自动终止标 `timed_out`，与手动 `killed`、从未跑起来的 `failed` 三者可区分。
  - *上下文效率*：`background_status` 从不内联全量输出，只给路径 + 行数 + tail 预览，全量阅读交给 Pi 内建 `read`。
  - *兼容性 / 隔离性*：真实 Pi 0.82.1 下普通命令仍只走内建 `bash`；`index.test.ts` 锁定只注册三个 `background_*` 工具、无命令、无 renderer。
  - 24 条单测全部面向真实子进程；三个关键回归（`/reload` 存活、完成通知契约、`failed` 状态）均做了变异验证，确认不是空测。
  - 全 workspace typecheck + 376 tests / 9 skipped；`npm pack` 7 个文件无测试与 helper 泄漏；release workflow run 30706997778 success；npm `latest = 0.2.0`，零 runtime 依赖。
- **回写位置**：稳定结论（三工具职责、落盘与 `read` 分工、必传 timeout 的理由、`/reload` 存活机制、不对标外部产品的立场）已合入 `.cs/spec/pi-background-terminal/index.md`；能力地图与包描述已同步 `.cs/spec/index.md` 与两份 README。中间过程（三次重设计、两轮 review 的逐条取舍）留在本 issue 与 `.cs/talks/004-background-terminal-redesign.md`，不往 spec 搬。
- **遗留**：`/reload` 期间从模块重新求值到 `session_start` 重新填回 `currentSessionId` 之间有一个几十毫秒窗口，恰好在此完成的任务会丢自动唤醒（任务与输出仍可用 `background_status` 看到，不丢数据）。已在 spec 中记为已知边界；要堵需加 pending 队列，为这个窗口不值得。若将来真实碰到再开新 issue，不在本次预先建档。
