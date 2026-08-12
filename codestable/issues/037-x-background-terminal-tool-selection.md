---
kind: issue
title: "background terminal 只用于真正的后台或交互命令"
type: bug
status: closed
created: 2026-08-01
epic: ""
superseded_by: "codestable/issues/038-x-background-terminal-bash-override-redesign.md"
---

# background terminal 只用于真正的后台或交互命令

## 目标

Pi 默认用 `bash` 执行普通、有限时长、无需 stdin 的命令；只有命令必须跨 tool call 持续运行、需要后续输入或需要保留 PTY 会话时才使用 `pty_*`，避免产生大量无价值后台 session 和管理调用。

## 归属

- 独立 issue。
- 相关 spec：`codestable/spec/pi-background-terminal/index.md`

## 当前证据

- 预期行为：与 OpenCode 一样，background terminal 是按需能力，不替代普通 shell command。
- 实际行为：指定 Pi session 的最后一个大型同步 turn 中出现 235 次 `bash`，同时出现 36 次 `pty_spawn`、76 次 `pty_read`、64 次 `pty_list`、35 次 `pty_kill`；大量 E2E 重跑和 CI watcher 被拆成后台 session，用户看到一长串终端噪声。
- 最小场景：给模型同时暴露 `bash` 与 `pty_*`，要求执行测试或等待 CI。
- 原始证据：Pi session `019f5f47-ad9f-75cc-bf0c-0d95f6d49f41`，user turn 92（2026-07-31 13:01–18:07）。

## 质量目标

- 交互能力 / 适当性可识别：工具描述应让模型明确把 `bash` 作为普通命令默认入口；以真实 Pi 非交互选择测试验证。
- 性能效率 / 资源利用：短命令不创建 managed PTY；以工具调用轨迹验证无多余 `pty_list/read/kill`。
- 可维护性 / 可分析性：一次后台任务只保留一个有意义 session，命令应直接出现在 spawn 参数中；以回归场景和 tool-call 审计验证。

## 根因定位

- 这不是模型“忘了 bash”：同一 turn 的 `bash` 调用远多于 PTY。
- 36 次 spawn 全是会自行结束的 build/test/typecheck/package/CI-watch 命令；没有 dev server、watch mode、REPL 或需要 stdin 的任务。
- 每次均设置 `notifyOnExit=true`，agent 仍立即 read/list 轮询；最后批量清理 35 个 session。
- `pty_spawn` guideline 把“之后可能看日志”列为使用条件，范围覆盖几乎所有测试；`pty_list` 又要求在 read/write/kill 前先 list，直接放大调用链。
- OpenCode `opencode-pty` 的产品入口强调 dev server、watch、长驻与 interactive program；当前 upstream 还在 spawn/read 返回中重复提醒 `notifyOnExit` 不应轮询。
- 同步任务本身反复扩 scope、测试失败与重跑是 36 个 PTY 的放大器；本 issue 只修 package 可负责的工具选择边界。
- **补充根因（用户追问后确认）**：之前的“对标 OpenCode”只对齐了 tool 数量与名称（5 个 `pty_*`），每个工具的 `description`/`promptGuidelines` 文案是本项目自撰，从未真正读取 `shekohex/opencode-pty` 的实际 `tools/*.txt`。抓取该仓库源码后发现两个具体差异：(1) OpenCode 真实文案把每个工具的完整用法、参数、示例、no-poll 规则都放在单一 `description` 字段（其工具协议没有 Pi 的 `promptGuidelines`/`promptSnippet` 分层）；(2) `write.ts` 有 `parseEscapeSequences()` 把模型输出的字面转义文本（如两个字符 `\x03`）解析成真实控制字节，而本包的 `pty_write` 此前完全透传、没有这一步——这是一个独立的真实功能缺陷：模型若照描述写 `data="\x03"`，实际发送的是 4 个字面字节而非 Ctrl-C。

## 影响范围

- 必须修改：`packages/pi-background-terminal` 的 AI-facing tool descriptions；如有必要同步 README/spec。
- 需要验证：普通命令、有限时长测试、真正长驻服务、需要 stdin 的进程。
- 仍待调查：与 OpenCode PTY tool 描述的具体差异。

## 修复方案

- `pty_spawn` 明确以 builtin `bash` 为默认；只允许显式后台、无限期 service/watch、或 interactive stdin/TTY 三类理由。
- 明确排除 build、test、typecheck、search、git 与 one-shot script；禁止先开空 shell 再写入命令。
- `pty_list` 只用于 overview / ID 丢失；已知 spawn ID 时直接操作。
- spawn/read 对 `notifyOnExit=true` 动态返回等待 `pty-exit` 的反轮询提醒。
- 不增加命令分类策略引擎或自动清理规则；选择边界留在 AI-facing contract。
- **文案对齐（本轮）**：抓取 `shekohex/opencode-pty` 五个工具的真实 `tools/*.txt`，把其中真正适用的用法/参数/返回值/示例移植进对应 `description`（Pi 的 JSON-schema 描述字段，是 OpenCode 单一 description 的对等物），逐句核对不移植我们没有的能力（bash 权限矩阵、行数上限而非字节上限、错误的 exit 消息措辞）。`promptGuidelines`/`promptSnippet` 保留为 Pi 独有的额外分层，专门承载 OpenCode 结构上没有对应位置的 bash-first steering（含 builds/tests/typechecks/searches/git/one-shot 显式清单），避免与 description 内容重复。
- **修复 `pty_write` 转义解析缺失**：移植 `parseEscapeSequences()`（MIT，来自 opencode-pty write.ts）到 `pty-write.ts`，在写入前把 `\n`/`\r`/`\t`/`\xNN`/`\uNNNN`/`\\` 解析成真实字节，使 description 里的 Ctrl+C 等示例真实可用。

## 验证

- tool guidance 单测锁定 bash-first、known-ID 复用、no-poll contract 与 spawn/read 动态提醒。
- `parseEscapeSequences` 单测覆盖全部转义类别；新增一个不 mock 的真实 PTY 集成测试：真实 spawn 一个注册了 `SIGINT` handler 的 Node 子进程，通过 `pty_write` 工具发送 `data="\\x03"`，断言子进程真的收到信号、打印 `caught-sigint` 并退出。
- package typecheck/test 通过（5 files / 12 tests）。
- 真实 Pi 0.82.1 非交互选择回归（`bytetrueapi/claude-haiku-4-5`，`gpt-5.6-sol` 当时上游 503 不可用已切换模型）：
  - `pwd`：`bash=1`，PTY tools = 0。
  - 800ms 后结束的一次性 Node 测试：`bash=1`，PTY tools = 0。
  - 明确要求越过 tool call 存活的长驻 Node service：`pty_spawn=1`，直接启动 `node`，`pty_list/read/write/kill=0`。
  - 明确要求后台运行的 2.5s finite job：`pty_spawn=1`，`notifyOnExit=true`，`pty_list/read=0`。
  - 端到端 Ctrl+C 场景（未提示工具名，仅自然语言）：模型自主 `pty_spawn` → 等待 `ready` 后 `pty_write(data="\\x03")` → `pty_read` 确认 `caught` 打印 → 汇报退出码 0；0 tool errors。
- 独立 review：blocking 0；3 条 note（byte→character 措辞、示例 ID 位数）已按建议修正并重新跑测试确认绿。

## 执行记录

- 已完成指定 session 的尾部逆向统计和 36 次 spawn 场景分类。
- 已对照 `shekohex/opencode-pty` 当前 README、spawn/read/list/write/kill 五个工具的真实 `description`/`.txt` 源码与 notify-on-exit reminders。
- 已收窄 AI-facing contract 并完成四轮真实 Pi tool-selection regression。
- 已发现并修复 `pty_write` 转义序列缺失的独立功能缺陷，含真实（非 mock）PTY 集成测试与真实模型端到端验证。
- 独立 reviewer 复核后按建议修正三处文案精度问题（bytes→characters、buffer 上限措辞、示例 ID 位数）。

## 关闭回写

- project spec：`codestable/spec/pi-background-terminal/index.md`

## 关闭结论

- **关闭判断**：本 issue 提出的文案对齐 + 转义修复已实现并验证继，但在未经 owner 确认/提交前，用户进一步追问“这个插件本身是否对齐错了对象”。核实后确认 OpenCode 官方根本没有任何后台/PTY 工具，`shekohex/opencode-pty` 只是个人开发者的第三方社区插件（自带未解决的跨平台 bug），且真实使用体验比不装这个包还差。User 随后明确指令“作废”整个基于该插件对齐的 5-tool/PTY/Web-monitor 设计。
- 因此本 issue 里的文案对齐与转义修复（虽已验证完整）从未提交，就在验收前被完整删除。`pty_spawn`/`pty_list`/`pty_read`/`pty_write`/`pty_kill` 五个工具已不存在，本 issue 要解决的“工具选择边界”问题因它们消失而自然不再存在。
- **superseded_by**：`codestable/issues/038-x-background-terminal-bash-override-redesign.md`
- 保留本 issue 作为历史：它真实发生过，且包含迁移前就已发现的真实 `pty_write` 转义缺陷。
