---
kind: issue
title: "快改（放弃）：pi-context-guard 尝试斜杠命令修改 models.json 与状态机推演反思"
type: ff
status: discarded
created: 2026-10-12
epic: ""
---

# 快改（放弃）：pi-context-guard 尝试斜杠命令修改 models.json 与状态机推演反思

## 原始意图与尝试

- 用户提议：将 `pi-context-guard` 从硬编码 400k tokens 截断的运行时 `agent_settled` hook 改造成注册 `/context` 斜杠命令，在 TUI 中弹出多选菜单列出模型，用户可指定阈值并外科手术式写入 `~/.pi/agent/models.json` 的 `contextWindow`，从而依靠 Pi 原生 compaction 机制触发压缩，并提供原版参数还原功能。
- 本 issue 实现了全套能力：
  1. `/context` 斜杠命令与参数解析（支持 300k/400k 等单位换算）；
  2. 基于 `ctx.ui.select` 的多选 Toggle 交互菜单；
  3. 外科手术式精确文本更新（保护未选模型、格式、缩进与注释）；
  4. 原版参数持久化备份（`<agent-dir>/pi-pkg-cfg/pi-context-guard/originals.json`）与原版参数精确还原；
  5. 修复了独立对抗性审查发现的 5 处边界缺陷（注释剥离、空对象单行插入无逗号、行内注释末尾逗号清理、kind 维度隔离、modelOverrides 作用域限制等）。

## 放弃原因与本质困境（为什么放弃改写配置文件）

在进一步的端到端推演中，发现了**“改写持久化配置文件”路线带来的无法调和的系统性困境**：

1. **状态机死锁与基准丢失（500k → 300k → 700k 困境）**：
   - 用户今天设为 500k，明天改设为 300k；当过几天需要处理超长任务想放宽到 700k 时，系统若拿当前配置的 300k 作为判定依据，会误判该模型最大只有 300k 容量，将其视为小模型安全过滤掉，导致“改小之后再也无法合法调大”。
   - 试图引入“已知见过的最大值（Hardware Ceiling）”来解决基准丢失，但如果用户手动在外部修改了配置，系统猜测的基准就会变得脆弱且不可靠。
2. **小模型误伤与参数溢出风险**：
   - 用户并非所有模型都是 1M 超大模型（例如存在 272k、128k 的模型）；
   - 一旦在配置层面批量修改，极易误将小模型“反向改大”，导致向上游发送超长 context 时报 `context_length_exceeded` 参数错误。
3. **副作用与心智负担过重**：
   - 配置文件属于用户的核心静态资产。一旦工具频繁在磁盘上改写用户的 `models.json`，用户总会提心吊胆，且伴随着复杂的备份、覆盖检测、防手滑机制，方案越来越重，违背了 YAGNI / 极简原则。

## 最终结论与制度记忆

- **拍板**：彻底放弃“修改 `models.json` 配置文件”的路线，**完整回滚至最初的纯运行时守护形态（54 行代码）**。
- **核心认知沉淀**：
  - **动静态边界隔离**：`models.json` 只负责声明上游 API 的真实物理能力（声明性静态配置），绝对不应被动态压缩需求所篡改。
  - **纯运行时 Hook 的天然优越性**：
    最初的 `pi-context-guard` 在 `agent_settled` 中仅判断：
    `if (usage.contextWindow <= 400_000) return false;`
    小模型（$le 400k$）天然放行，大模型（$> 400k$）过线即 compact，零文件污染、零持久化状态、无需还原、无状态机死锁，删掉扩展即彻底还原，具有无与伦比的优雅与稳定性。

## 改了哪些（回滚）

- `small-extensions/pi-context-guard/`：全量恢复至收编基线 `bf929a5`
- `small-extensions/README.md`、根目录 `README.md`：恢复原版说明
- `byissue/spec/index.md`：证据索引更新指向本放弃记录
- `byissue/issues/117-d-ff-context-guard-slash-command.md`：沉淀放弃分析
