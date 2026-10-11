# 本机有两个都叫 `subagent` 的工具，排查时按参数形状消歧

## 结论

同一台机器上至少有两个不同来源的工具都注册为 `subagent`：

| 来源 | 参数形状 | 角色体系 |
|---|---|---|
| `@bytetrue/pi-subagent`（本仓） | `task` / `agent` / `tools` / `cwd` / `resume` / `timeoutMs` / `maxTurns` | 包内 agent 文档 + `.pi/agents/*.md` |
| byspace 仓库自带 | `action` / `tasks` / `workflowScript` / `agentScope` / `async` / `context` / `watchdog.configure` … | 自有 `worker` / `reviewer` / `oracle` / `delegate` / 外部 CLI 角色 |

## 为什么

按 `"name":"subagent"` grep 会话 jsonl 做使用统计时，两个工具的结果会混在一起，且因为参数形状不同而**不能按总条数判断谁用得多**：全机 `"agent":"reviewer"` 有 729 处、`"agent":"worker"` 1039 处，几乎全来自 byspace 那个；严格按本包 schema（键集 ⊆ 本包参数）筛出的只有 52 条。

## 规则

1. 统计或排查本包用法时，先按 **arguments 的键集**过滤，再统计 `agent` 取值。
2. 「用户主要用 reviewer」这类结论必须说明来源工具，否则会把另一个工具的量记到本包头上。
