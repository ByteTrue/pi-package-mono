---
kind: issue
title: "background terminal：不限时任务、可等待清理与用户管理菜单"
type: feature
status: closed
created: 2026-08-03
epic: ""
---

# background terminal：不限时任务、可等待清理与用户管理菜单

## 目标

后台开发服务可以在没有超时的情况下持续运行；Agent 或用户主动停止时不再触发多余的完成 follow-up；真正结束 Pi session 时，所有由本包启动的进程树和输出文件都被可靠清理。用户通过 `/background` 菜单即可查看任务、查看输出、停止任务或返回，不需要记 subcommand 或复制 task id。

## 范围

- `background_run` 的 `timeoutSeconds` 改为可选；省略表示不限时。
- 手动 `background_kill` 与 session 清理抑制自动完成通知；正常退出和超时仍通知。
- `clearSession()` 等待 abort 后的 shell/process-tree 完成与输出流关闭，再删除任务文件；`session_shutdown` 等待清理；`/reload` 继续保留任务。
- 新增用户 slash command `/background`：
  - 菜单列出当前 session 的全部后台任务及状态；
  - 进入任务后可选择查看输出、停止运行中的任务或返回；
  - 查看输出使用 Pi 原生多行 editor，停止动作使用用户确认；
  - 不要求用户输入 `list` / `kill` 或复制 `bg_<hex>`。
- 保留三个现有 Agent 工具及其 session 隔离语义；不覆盖 Pi 原生 `bash`。

## 质量目标

- **功能正确性**：不限时开发服务持续运行；主动停止不产生自动 follow-up；真正 session 结束后普通 Pi-managed process tree 不残留。以真实子进程、PID 存活检查和通知断言验证。
- **交互能力 / 用户差错防御**：用户从 `/background` 进入任务菜单即可完成查看输出或停止，不需记命令语法或 id；停止前有确认，返回路径明确。以 command UI 测试验证。
- **兼容性 / 隔离性**：`/reload` 不杀任务，任务仍可由 Agent 工具访问；普通 `bash` 不受影响。以生命周期与扩展注册测试验证。

## 实现设计

- 继续复用 Pi 的 `createLocalBashOperations().exec()` 与进程树 kill，不自建 shell 或 PTY。
- `InternalTask` 持有完成 promise 与通知抑制状态；public snapshot 不泄露内部字段。
- `/background` 通过 `ctx.ui.select` 组织任务列表和动作菜单，通过 `ctx.ui.editor` 查看落盘输出；操作按 `parentSessionId` 隔离。

## 验证

- manager：可选 timeout、正常退出/超时/手动 kill 通知差异、`clearSession()` 等待进程退出并删除输出文件、真实 PID 不存活。
- command：空列表、任务列表、输出查看、运行任务停止确认、已结束任务无 kill 选项、返回路径。
- package typecheck/test、README 更新，以及必要的真实 Pi session smoke。

## 执行记录

- 用户确认不限时开发服务、主动 kill 静默、session 退出清理和用户管理入口。
- 用户进一步确认 `/background` 必须是菜单式交互：列出后台任务，进入任务后选择查看输出、kill 或返回，不要求记 `list` / `kill` / task id。
- 已实现：`background/manager.ts` 支持可选 timeout、手动 kill/会话清理抑制通知、等待执行与输出流完成后清理；`index.ts` 等待真实 session cleanup；新增 `background-command.ts` 菜单和原生 editor 输出查看。
- 已更新：三个 Agent 工具说明与 `README.md`，明确 timeout 可选、手动停止静默和 `/background` 用法。
- 已验证：`npm --workspace @bytetrue/pi-background-terminal run typecheck`；`npm --workspace @bytetrue/pi-background-terminal test`（29 tests，含真实 PID 存活检查、通知差异、菜单空列表/输出/返回/确认 kill/取消 kill 流程）；`npm --workspace @bytetrue/pi-background-terminal pack --dry-run`。
- 并行 correctness review：未发现 blocker；review 建议的 timeout 通知、session 清理静默和取消 kill 覆盖已补进测试。未执行真实交互式 Pi session smoke，作为后续 Pi 版本回归风险保留。
- ponytail review：已采用 `node:stream/promises.finished` 收敛输出流关闭等待，并删除 README 中重复的 `/background` 总览条目。

## 发布

- 版本 `0.3.0`：tag `pi-background-terminal-v0.3.0` 触发 `release.yml`（run 30838293398），全 workspace typecheck/test 与 OIDC publish 均成功；registry 已确认 `latest = 0.3.0`。
- 发布前本地复跑与 workflow 同构的验证：全 workspace 453 tests passed / 9 live tests skipped；目标包 tarball 共 8 个文件，无测试/helper 泄漏。

## 关闭结论

- **可关闭**：实现范围与用户确认一致；不限时任务仍按 session 管理，主动 kill 静默，session 结束等待进程树/输出流并清理，`/background` 完成菜单式查看与停止。
- **质量证据**：独立 correctness review 未发现 blocker；29 个包级测试覆盖可选 timeout、正常/超时/手动 kill 通知差异、真实 PID 清理、菜单输出/返回/确认与取消 kill；typecheck 通过。
- **回写**：稳定的生命周期、通知和用户菜单约束已回写 `codestable/spec/pi-background-terminal/index.md`，README 与 issue 执行记录同步。
- **遗留风险**：未执行真实交互式 Pi session smoke；后续若 Pi session shutdown 或 UI API 契约变化，应在 Pi 版本升级回归时补跑。

## 关闭回写
- 已将不限时但 session-scoped 清理、主动 kill 静默和 `/background` 菜单约束回写 `codestable/spec/pi-background-terminal/index.md`。
