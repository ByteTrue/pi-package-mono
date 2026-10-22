# pi-goal（small extension）

## 定位

`small-extensions/pi-goal` 是一个单文件小扩展：给会话挂一个持久目标（`/goal <objective>`），让 Pi 在安全边界自动续跑，直到模型用 `goal_done` 带证据声明完成。动机是长任务里用户每轮手动输入「继续」；对照物是 Codex 的 `/goal`，反面参照是 14.6k 行的 `pi-goal-x`（任务树 + auditor + 看板 + 设置面板）。

**发行形态：small extension，非 npm 包。** 单个 `.ts` 即全部运行时（零运行时 import，type-only import 加载即消失；tool 参数是手写 plain JSON Schema，与 pi-ask-user 同法）。安装走 `scripts/install-small-extension.mjs`，复制进 `~/.pi/agent/extensions/`；`package.json` 为 `private: true`，只用于根 workspaces 把 typecheck/test 纳入 CI。更新 = 重跑脚本。

## 当前表面

- `goal_start(objective)` 工具：模型自己把对话里的意图整理成目标并起跑，用户不必口述 goal（「把这个设成 goal 然后开始执行」）。目标由模型写成「终态 + 验证面 + 不得回退的约束」，单字段不做结构化拆分。**只在无 active 目标时可用**，active 时调用直接报错——换目标由用户 `/goal clear` 或 `/goal pause` 决定，模型不能静默改目标。
- `/goal <objective>` 设置/替换目标并立刻起跑；`/goal`（无参）或 `/goal status` 汇报；`/goal pause|resume|clear` 控制。四个控制词是整串精确匹配，`/goal clear the cache` 仍然是目标。
- `goal_done(summary, evidence)` 工具：两个字段都必填，`evidence` 要求写明实际执行过的检查。**仅在目标 active 时挂进 active tools**。
- 两个工具互斥：无目标时只有 `goal_start`，active 时只有 `goal_done`。切换只发生在 `session_start` / 命令 / `agent_before_settle` 这些安全点，绝不在工具执行中途改（同一 assistant message 的兄弟调用可能仍在飞）。
- 系统提示 `<goal>` section（`before_agent_start`）：目标 + 三条行为契约（不要停下来问是否继续、先验证再 `goal_done`、被用户决策阻塞就停）。内容只随目标变化，不进 runs 计数，保持缓存前缀稳定。
- footer 状态行：`goal:active(N)` / `goal:paused`，完成或清空即消失。
- 事件：`session_start` / `session_tree` 从当前分支恢复；`agent_start` + `tool_call` 记「本段是否真干活」；`agent_before_settle` 是续跑循环本体；`agent_settled` 只为放行 print/json 模式的命令处理器。

## 续跑语义（核心契约）

在 `agent_before_settle` 这个 Pi 明确的最终可行动边界上判断（不是定时器、不是 idle 轮询、不是 bash 覆盖）：

- **active + 正常结束 + 本段调过工具** → 追加一条隐藏的 `custom_message`（`display: false`）并返回 `continue: true`；`runs` 加一。
- **本次续跑一个工具都没调** → 暂停，不续跑（Codex 同款 anti-spin：只有纯文本的续跑会原地打转）。判据只对「本扩展注入的续跑」生效，用户自己起的那轮只回文本不算目标停滞。
- **aborted（Esc）或 provider error** → 暂停。失败不是进展。
- **已有排队输入** → hold，不注入（用户的话优先，处理完那轮再判断）。
- **paused / done / 无目标** → hold。

「本次运行」以 `agent_start` 为界，每次续跑都会重新 emit 一次，所以判据天然按运行分段；`settleDecision` 另用 `isContinuation` 区分「我注入的续跑」与「用户自己起的一轮」。不能用「最后一轮是否调工具」判断——每次运行都以纯文本收尾轮结束，那样会每轮都暂停（实测踩过，见 ff）。

print / json 模式（`pi -p "/goal …"`）会在命令返回后立刻销毁会话，所以命令处理器在 `ctx.mode` 为 `print` 或 `json` 时等待 `agent_settled` 再返回，否则整个循环会被腰斩。

## 明确不做

- 不做任务树/子任务、完成 auditor、token/轮数预算、dashboard、多目标池、sisyphus 有序模式、设置面板、跨项目目标库；
- 不做完成判定启发式（文本哨兵、覆盖率打分）；完成只由 `goal_done` 的 summary+evidence 表达；
- 不注册任何内建工具覆盖，不改 bash/read 等原生行为；
- 不进 `packages/`、不发 npm、不接 release workflow。

## 状态与持久化

目标状态写在 session 的 custom entry（`customType: "pi-goal"`），`data: null` 表示清空；恢复时从 `getBranch()` 反向取最后一条，因此 `/resume` 与 `/tree` 切换都跟随当前分支。entry 不进 LLM 上下文；模型看到的目标来自系统提示 section，压缩后仍在。

## 实现地图

```text
small-extensions/pi-goal/
  pi-goal.ts              单文件运行时：parseGoalCommand / settleDecision / readGoalRecord / goalSection
                          + /goal 命令 + goal_done 工具 + 事件钩子 + 默认导出 registerGoal
  pi-goal.test.ts         CI-only：26 用例（命令解析、续跑策略矩阵、分支恢复、print 模式等待、工具边界）
  package.json            private，永不发布；仅为 workspaces 收编 CI
  README.md               安装、命令、循环护栏、卸载、实现表
scripts/install-small-extension.mjs  EXTENSIONS 清单（安装通道 gate 见 check-small-extension-installer.mjs）
```

## 验证

```bash
npm --workspace pi-goal test
npm --workspace pi-goal run typecheck
node scripts/check-small-extension-installer.mjs
```

真实 Pi 回归（`-ne -e <file>` 隔离加载）：`pi -p "/goal …"` 完成多轮续跑并在 `goal_done` 后停止；纯文本回复的目标自动 pause 并提示 `/goal resume`；pause/resume/clear/status 状态与工具表同步。RPC 模式见 `byissue/issues/2026-10-21-x-ff-pi-goal.md` 的验证记录。

## 证据

- README：`small-extensions/pi-goal/README.md`
- Codex 对照语义：OpenAI cookbook "Using Goals in Codex"（boundary 驱动、无工具调用即抑制、证据驱动完成）
- 同形态先例：`byissue/spec/pi-bash-timeout/index.md`、`small-extensions/pi-ask-user/`
