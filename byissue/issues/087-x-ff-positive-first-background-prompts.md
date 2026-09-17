---
kind: issue
title: "后台工具提示词改为正向优先：说清“结束回合即等待”"
type: ff
status: closed
created: 2026-09-17
---

# 后台工具提示词改为正向优先：说清"结束回合即等待"

> 来源 talk 007；判据 decision 001。

---

模型在 `background_run` 之后用 `sleep` 自阻塞、几乎从不给 subagent 传 `async: true`，根因是提示词只禁了轮询、没说等待方式。现在两个包的 description / promptGuidelines / 返回文本都先说该做什么（继续做别的或结束回合，退出以新消息开启下一回合），并修正了"长命令转 background_run"这条把要结果的命令推向后台的引导（改为给 bash 传更大 timeout）。`sleep` 一词不出现在任何提示词中。

- 改动：`packages/pi-background-terminal/src/tools/background-run.ts` — description、promptSnippet、五条 guidelines、返回文本重写；`background-run.test.ts` 同步断言
- 改动：`packages/pi-background-terminal/README.md` — 选择说明一句同步
- 改动：`packages/pi-subagent/src/index.ts` — 工具 description 改为 prefer async 并说明等待方式；新增 promptSnippet + 两条 promptGuidelines；`async` 参数描述改写；async 启动返回文本改为动作收尾（"continue with other work or end your turn now"）
- 改动：`packages/pi-subagent/src/builtin-agents.ts` — scout/reviewer 三处否定改为正向（"ground every claim in what you read"、"verify every finding before reporting"、"Leave the working tree unchanged: ... put every suggested fix in the report"）
- 验证：两包 `test` + `typecheck` 通过（47 + 19 用例）；reload 后在真实会话验证：`background_run` + `subagent(async)` 同回合启动 → 模型主动结束回合等通知，未 sleep / 未轮询；后台命令退出通知按预期唤醒下一回合
- byissue：已同步 `spec/pi-background-terminal/index.md`（promptGuidelines 段）与 `spec/pi-subagent/index.md`（async 参数段，注明待 088 删前台）

顺手发现：pi-vision 唯一 guideline 的 "never infer contents from filenames" 属强默认型，保留；pi-image-gen SKILL 约 5 条否定为凭据/格式边界，低优先级，未动。
