---
kind: issue
title: "清理 pi-background-terminal 孤儿日志文件：崩溃路径泄漏 + 启动时年龄扫描兜底"
type: bug
status: closed
closed: 2026-09-11
created: 2026-09-10
---

# 清理 pi-background-terminal 孤儿日志文件：崩溃路径泄漏 + 启动时年龄扫描兜底

> **读者：** 跨会话接手的人——「要做成什么、别碰什么、现状与方案是否还成立、怎么验、关了要回写哪里」。

## 做成以后是什么样

`$TMPDIR/pi-background-terminal/` 不再无限积累孤儿日志：正常退出路径（交互 quit、print 模式）行为不变（已有清理，实验验证过）；崩溃路径（uncaught exception、终端 EIO）泄漏的文件在**下次 extension 加载时被年龄扫描清除**。用户磁盘上不再出现三周 318 个文件的积累。

**范围：** extension 加载时的孤儿文件年龄扫描；不改变现有 session 生命周期清理逻辑。**不包含：** 进程内 crash hook（见方案判断）、跨 Pi 重启的进程存活追踪。

**归属：** 独立 issue。来源：issue 071 回归中发现（根因定位过程见 071 执行记录）；历史背景：issue 039 的 ponytail review 曾以「推测性」拒绝孤儿文件扫描——2026-09-10 发现 318 个真实积累文件，触发条件已满足。

## 为什么现在做 / 当前坏在哪

- **预期**：输出文件在真实 session 结束时删除（spec 与 README 承诺）。
- **实际**：`$TMPDIR/pi-background-terminal/` 积累了 345 个文件（2026-08-20 起，318 个历史泄漏 + 当日中间态代码产生的 27 个）。
- **根因**（已实证，非推测）：
  - print 模式（`pi -p`）**会**触发 `session_shutdown(reason: quit)`，清理路径完整（debug extension 实验验证：handler 收到事件 → clearSession resolved → 文件删除 → 进程杀死）。最初的「print 模式不清理」判断是错的。
  - 真实泄漏口是**交互模式崩溃路径**：`uncaughtCrash` 与 `emergencyTerminalExit` 只调 `killTrackedDetachedChildren()`（Pi 的全局 detached 进程收割，只杀进程、不 fire `session_shutdown`），extension 的清理 handler 无从执行。
  - 任何 uncaught exception（包括其它 extension 的 bug）或终端 EIO 崩溃都会留下孤儿文件；三周内 318 个文件的速率与「偶发崩溃 × 从不清理」一致。
- **最小场景**：交互模式中触发任意 uncaught exception → Pi 崩溃退出 → 该 session 的运行中/已结束任务的日志文件全部遗留。

## 现状怎么工作

输出文件生命周期由 `manager.clearSession` 管理（session_shutdown handler 调用，await 进程树退出 + 输出流关闭后删除文件）。manager 单例钉在 `globalThis[Symbol.for(...)]`，跨 `/reload` 存活，但**不跨 Pi 进程**。

## 方案与实现安排

**年龄扫描（推荐，本 issue 主体）**：extension 加载时（`registerBackgroundTerminal` 入口，即每次 Pi 启动/`/reload`）扫描 `$TMPDIR/pi-background-terminal/`，删除**修改时间超过阈值**（如 24h，$TMPDIR 本身会被 OS 周期性清理，阈值只兜近期）的所有 `bg_*.log`。

- 为什么安全：新进程的 manager 内存里没有任何旧进程的任务；任何 `bg_*.log` 文件在当前进程视角下都不可达，只有磁盘占用价值。当前正在写的文件 mtime 持续更新，永不过阈值。
- 为什么不做进程存活检查（`fuser`/lsof）：跨平台成本高（Windows 没有 fuser）；24h 阈值下的误删窗口只影响「一个 Pi 进程挂了但任务还在跑 24h+」的场景——那时 OS 的 $TMPDIR 清理也迟早会删，不值得为此引入平台特定依赖。
- 一次 `readdir + stat + unlink`，同步执行（文件数量级 ~百，非阻塞顾虑不成立；避免 async 时序与 `/reload` 竞态）。

**不做进程内 crash hook**：Pi 的 `uncaughtException` handler 已存在（TUI 恢复），我们在其后追加「删自己文件」的钩子需要碰全局 handler 链，收益（提前几小时清理）不抵复杂度与风险。已评估，拒绝。

**质量承诺**：可维护性（扫描逻辑 ~15 行，无平台分支）；可靠性（fail-soft：扫描/删除任何异常都吞掉，绝不让清理失败炸掉 extension 加载）。

## 动哪些、验哪些

- **必须改**：`src/index.ts`（加载时调用扫描）或 `manager.ts`（构造后扫描）；README 生命周期小节补一句崩溃路径说明。
- **需要验**：正常 quit 清理不回归（现有测试）；扫描不删正在写的文件（mtime 阈值测试，用 `utimes` 伪造旧 mtime）；扫描异常 fail-soft（mock readdir 抛错）；`/reload` 路径扫描幂等。
- **仍未知**：无。

## 验证

- 单测：伪造旧 mtime 文件 → 扫描后消失；新 mtime 文件 → 保留；readdir 抛错 → 不传播。
- 真实回归：预先放一个伪造旧文件 → 启动 `pi -p` → 文件被清；正常跑任务 → quit → 文件被清（既有路径不回归）。

## 执行记录

### 2026-09-10 实现

- `manager.ts` 新增 `sweepOrphanLogs()`（导出）：同步扫描 `$TMPDIR/pi-background-terminal/`，删除 mtime 超过 24h 的 `bg_*.log`；`readdir`/`stat`/`rm` 逐文件 fail-soft（单文件异常不中断扫描、不炸加载）。不傲进程存活检查（跨平台无 fuser；阈值下误删窗口只影响「Pi 已挂但任务还在写 24h+」的极端场景，$TMPDIR 的 OS 清理也会迟到）。
- `index.ts` 在 `registerBackgroundTerminal` 入口调用（覆盖启动与 `/reload`；`/reload` 时当前进程的活跃文件 mtime 持续更新，永不过阈值，幂等安全）。
- 已评估并拒绝：进程内 crash hook（需要碰 Pi 的全局 `uncaughtException` handler 链，收益只是提前几小时清理）。
- README 生命周期小节补崩溃路径说明。

### 2026-09-11 Review 轮修正（正确性 reviewer 发现 #6）

- **sweep 安全论证修正**：原「正在写的文件 mtime 持续更新，永不过阈值」对**静默任务**（sleep/安静 daemon）不成立——创建后不再写，超 24h 后同进程 `/reload`（sweep 在加载入口跑，manager 单例跨 reload 存活）会删掉本进程活跃任务的日志。修复：sweep 跳过当前 manager 持有的全部任务 outputPath（新增测试：live 任务 + 伪造旧 mtime → 保留；变异验证）。跨进程的静默任务仍可能被另一 Pi 实例清掉——接受并如实记录：$TMPDIR 的 OS 清理迟早也会删它。
- **测试卫生修正（ponytail reviewer）**：sweep 测试的 reset() 全清生产目录与并行测试文件互踩（实抓 ENOENT 竞态）且留下删不掉的 bg_dirlike.log 目录。修复：只跟踪清理自建文件；生产目录中 345 个历史孤儿在测试运行中被顺带清零（feature 首次大扫除的副作用，符合预期）。

**终态验证**：本包 513 passed / 9 skipped（三轮稳定）；typecheck 0 错；真实 Pi 0.85.1 场景重跑无回归，生产目录零新泄漏。

### 原验证记录（2026-09-10，修复前，保留作证据链）

- 单测 4 tests：旧 mtime 删除/新 mtime 保留、非 `bg_*.log` 模式忽略、fail-soft（不可删除条目不抛）。
- 变异验证：去掉 mtime 阈值 → 「keeps fresh ones」测试红。
- 真实 Pi 0.85.1 端到端：伪造 2 天前 mtime 的 `bg_fake-orphan-test.log` → `pi -p` 启动即被清除（SWEPT）。

## 关闭结论

- **关闭判断**：目标达成。崩溃路径孤儿文件有了兑底：加载时扫除 mtime > 24h 的 `bg_*.log`，跳过本 manager 持有的任务输出文件，逐文件 fail-soft；review 轮修正了「正在写的文件永不过阈」的错误安全论证（静默任务场景）并补上 live-task 保护测试。
- **验证摘要**：单测 4 tests（旧删新留、live 任务旧 mtime 保留、非 bg 模式忽略、不可删条目 fail-soft）+ 变异验证（去阈值→红、去 live 保护→红）；真实 Pi 端到端（伪造旧文件→启动即清）；生产目录 345 个历史孤儿在验证过程中被顺带清零，后续回归零新泄漏。
- **回写位置**：`codestable/spec/pi-background-terminal/` 生命周期节（崩溃路径兑底与跨进程接受边界）；README 同步。
- **遗留**：跨进程静默任务（>24h 无输出）可能被另一 Pi 实例清掉——已作为接受边界写入 spec，不再跟进。
