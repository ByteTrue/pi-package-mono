# 全仓 typecheck 前先 npm ci：本地 node_modules 漂移会造成 phantom 类型红

## 结论

跑 `npm run typecheck --workspaces --if-present` 之前要先 `npm ci`。本地
`node_modules` 与 `package-lock.json` 漂移时，`small-extensions/pi-context-guard`
会报 `Property 'sections' does not exist on type 'BuildSystemPromptOptions'`，
而 CI（走 `npm ci`）是绿的。这条红不属于任何代码改动，把它算进本次改动就会写出一份
错误的提交汇报。

## 为什么

pi 的类型来自 `@earendil-works/pi-coding-agent`。根 `package.json` 不声明它（只由各
workspace 声明），所以本地装的版本与 CI 装的版本可以差一个 minor 而无人察觉：本次实测
lock 钉 `1.1.0`（`BuildSystemPromptOptions` 有 `sections`），本地 `node_modules` 是
`0.84.3`（没有该字段）。

症状是"某个 small-extension 在 HEAD 上坏"。三条判据可以把环境漂移与代码坏分开：

1. 该包有无 diff：`git diff HEAD -- small-extensions` 为空 → 不是本改动引入的。
2. lock 钉的版本：`rg -n '"node_modules/@earendil-works/pi-coding-agent"' -A3 package-lock.json`
3. 本地实际版本：`node -e "console.log(require('./node_modules/@earendil-works/pi-coding-agent/package.json').version)"`

两边不一致就是漂移，不是代码坏。CI 结论是最终裁判：`gh run list --json status,conclusion,name,headSha`
看本次 headSha 的 CI；本地红 + CI 绿 = 先修环境，再谈代码。

## 规则

1. 全仓 typecheck / test 之前跑 `npm ci`（AGENTS 的 install-first 契约就是这条）。
2. 不方便跑 `npm ci`（worktree 被别人占用等）时，在汇报里写明"未 `npm ci`，本地依赖可能漂移"，
   不要把红归因成"HEAD 既有失效"——这个归因把环境故障写成了代码故障，下一个读汇报的人会去找
   一个不存在的坏。
3. 结论已经写进提交/关闭汇报后又被证伪时，明确写"修正"并给出证据（版本两边对比、CI 状态），
   不要静默改掉。

## 验证

2026-10-18（`byissue/issues/2026-10-18-x-subagent-budget-config.md`）：本地全仓 typecheck
报 context-guard 红；`git diff HEAD -- small-extensions` 为空；lock 钉 `1.1.0`，本地
`0.84.3`；推送后 `gh run list` 显示 `HEAD a210391` 的 CI 是 success，本次 headSha
`53655aa` 的 CI 在跑，Release queued。

## 复用场景

- 任何全仓 typecheck / test 前的准备动作，尤其是"我改了一个包，别的包报了类型红"。
- 上游类型包（pi-coding-agent）升级后的整仓体检；small-extensions 的 tsc 只看声明，
  没有运行时行为能暴露漂移。
- 修转依赖 advisory 后验三件事（`npm ci` 实际版本 / `npm audit` / 全仓 typecheck），见
  `byissue/notes/022-npm-transitive-advisory-fix-shapes.md`。
