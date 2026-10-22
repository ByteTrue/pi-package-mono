---
kind: issue
title: "快改：新增单文件 small-extension pi-goal（Codex /goal 极简版）"
type: ff
status: closed
created: 2026-10-21
epic: ""
---

# 快改：新增单文件 small-extension pi-goal

> 做了什么 · 改了哪些 · 怎么验证 · 对 `byissue/` 有无影响

用户诉求：长任务里模型每轮都停下来等他输入「继续」（会话 01a15306 后半段连续十几次「继续 / 继续推进」），希望像 Codex `/goal` 一样自驱动到完成。第三方 `pi-goal-x` 被判为过重（14.6k 行、30+ 模块：任务树、独立 auditor、dashboard、sisyphus 模式、设置面板），按「先要最小可用基线」的口径自研单文件版。

## 做了什么

- 新增 `small-extensions/pi-goal/`：`/goal` 命令（status/pause/resume/clear 四个整串控制词，其余为目标）+ `goal_done` 工具（summary+evidence 必填，仅在目标 active 时挂进 active tools）+ 五个事件钩子 + footer 状态。
- 追加 `goal_start` 工具（第二轮反馈）：用户不想自己描述目标，只想说「把这个设成 goal 然后开始执行」，由模型从对话里提炼终态 + 验证面 + 约束并起跑。两个工具互斥（无目标只有 `goal_start`，active 只有 `goal_done`），模型无法在 active 时静默换目标。
- 循环落在 `agent_before_settle`（Pi 的最终可行动边界）：active 目标下追加一条隐藏 `custom_message` 并返回 `continue: true`。不用定时器/idle 轮询，也不覆盖任何内建工具。
- 护栏对齐 Codex：本段无工具调用 → 暂停（anti-spin）；aborted / provider error → 暂停；已有排队输入 → hold。
- 状态写 session custom entry，按 `getBranch()` 恢复，`/resume` 与 `/tree` 都跟随当前分支；目标本体走 `before_agent_start` 的 `<goal>` system section，压缩后仍在。
- print 模式特殊处理：`pi -p "/goal …"` 会在命令返回后销毁会话，故命令处理器在 print 模式等 `agent_settled` 再返回。

## 明确不做

任务树/子任务、完成 auditor、token 或轮数预算、dashboard、多目标池、sisyphus 有序模式、设置面板、文本哨兵式完成判定。也不进 `packages/`、不发 npm、不接 release workflow。

## 改了哪些

- `small-extensions/pi-goal/pi-goal.ts`（新增，全部运行时）
- `small-extensions/pi-goal/pi-goal.test.ts`（新增，26 用例）
- `small-extensions/pi-goal/package.json`、`tsconfig.json`、`README.md`（新增）
- `scripts/install-small-extension.mjs`（EXTENSIONS 清单加一行，默认勾选）
- `small-extensions/README.md`（能力表加一行）
- `byissue/spec/pi-goal/index.md`（新增子 spec）、`byissue/spec/index.md`（能力地图加一行）

## 怎么验证

- `npm --workspace pi-goal test` → 34 passed；`npm --workspace pi-goal run typecheck` → 通过。
- `npm run typecheck --workspaces --if-present`、`npm test` 全绿；`node scripts/check-small-extension-installer.mjs` → 5 extensions OK。
- 真实 Pi（`-ne -e <file>` 隔离加载，未触碰用户配置）：
  - `pi -p "/goal 建 hello.txt 并读回"` → 多轮工具调用后 `goal_done`，文件落盘，session 里出现 `status: done` 的 goal entry 与 `evidence`。
  - 三文件分三轮的目标 → 时间线为 active(runs 0) → CONTINUE(display=False) → active(runs 1) → CONTINUE → active(runs 2) → done，证明单轮只干一件事也能自动接续。
  - RPC 模式：纯文本回复的目标 → 自动 `goal paused: the run called no tools`，`/goal resume` 后继续，`/goal status` 显示 done+evidence。
  - 全局安装后的 `goal_start` 路径（不提 `/goal`，只说「把这项工作设成 goal 然后开始执行」）：模型自己写出目标并调 `goal_start` → t1/t2/t3 三轮各一个文件（自动续跑 1 次）→ `goal_done`，session 里 `runs: 1`、`status: done`。

## 踩到的坑（已修，写进 spec）

最初按「最后一轮是否调过工具」实现 anti-spin，实测每轮必暂停：Pi 的每次运行都以一条纯文本收尾轮结束，最后一轮永远没有工具调用。改为以 `agent_start` 为界统计「本次运行是否真干活」；再进一步区分 run 的来源——只有本扩展注入的续跑「只说不动」才暂停，用户自己起的一轮只回文本不算目标停滞（否则 `/goal 解释一下这个测试` 会被误判）。

print 模式的 stale-ctx 报错也来自同一实现细节：`-p` 下命令返回即销毁会话，任何随后的 `appendEntry`/`setStatus`/`setActiveTools` 都会抛 "ctx is stale"。改为用 `agent_settled` 的 promise 把 handler 撑住。

## 对 byissue/ 的影响

已同步：新增 `byissue/spec/pi-goal/index.md`；`byissue/spec/index.md` 能力地图补一条（small-extensions 内、非 npm 包，不计入「六包」）。
