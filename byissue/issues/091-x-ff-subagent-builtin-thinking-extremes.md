---
kind: issue
title: "内置角色思考档改为两端：scout 最低、reviewer 最高、researcher 继承"
type: ff
status: closed
created: 2026-09-17
---

# 内置角色思考档改为两端：scout 最低、reviewer 最高、researcher 继承

内置角色不再占着中间档：`scout` 用最低档（`minimal`），`reviewer` 用最高档（`max`），`researcher` 不再设内置档、随父会话。pi 子进程会按子模型能力夹取请求档位，所以 `minimal`/`max` 就是各模型上的「最低/最高可用档」，不需要本包维护 `thinkingLevelMap` 逻辑。

- 改动：`packages/pi-subagent/src/builtin-agents.ts` — `scout.thinking: low → minimal`；`reviewer.thinking: high → max`；`researcher` 删除 `thinking: medium`（改走继承链）。
- 改动：`packages/pi-subagent/src/index.ts` — `off` 不再被 `buildPiArgs`/`resolveRunCfg` 丢弃。此前父会话停在 `off` 时子进程会退回自己的默认档，继承是断的；现在 `off` 作为真实档位写进 `--model m:off`（无 model 时走 `--thinking off`）。
- 改动：`packages/pi-subagent/src/index.test.ts` — 内置档位断言更新；新增继承用例（`minimal/medium/max/off` 四档父会话 → 子进程参数一致）。
- 验证：包内 25 项测试与全仓 8 个 workspace 测试、typecheck 全绿。用用户实际模型 `bytetrueapi/glm-5.3-flash`（map 只支持 `low/high/max`）走真实 `pi --mode json -p --model …:minimal`：会话文件记录 `thinkingLevel: low`，即最低可用档；`clampThinkingLevel` 直测 `minimal→low`、`max→max`、`off→low`（不报错）。`buildPiArgs` 抽查：scout→`p/m:minimal`、reviewer→`p/m:max`、researcher→父会话档。
- byissue：已同步 `byissue/spec/pi-subagent/index.md`（内置角色档位描述 + `off` 继承语义）；README 同步。

顺手发现（不在本次范围）：`buildPiArgs` 的 `!cfg.model.includes(":")` 守卫会让「model id 自带冒号（如 openrouter `:exacto`）+ thinking」时不再拼接档位；`resolveRunCfg` 已在有 model 时预拼档位，所以只有直传 cfg 的调用路径受影响。
