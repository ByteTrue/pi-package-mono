---
kind: decision
title: "2026-10-09 的 16 笔直推 main 为成员本人意外操作，已追溯确认；后续直推走 CONTRIBUTING 紧急通道登记"
created: 2026-10-10
superseded-by: ""
---

# 2026-10-09 的 16 笔直推 main 为成员本人意外操作，已追溯确认

2026-10-09 的 16 笔直推 main（74b586a4 起，作者 chuzijie@insta360.com）为成员本人意外操作，已追溯确认；后续直推需走 CONTRIBUTING 紧急通道登记。本文件既是对该批直推的追溯补录，也是 CONTRIBUTING「Emergencies」checklist 第 ② 步要求的登记记录样例。

## 背景（BYTE-12 审查）

- BYTE-12 只读审查发现：2026-10-09/10 期间 main 上有 16 笔未经 PR 的直推，author 均为 chuzijie@insta360.com，批次从 ade4d912 起到 74b586a4 止（74b586a4 为其中最新一笔，即合并时的 main HEAD）。逐笔 SHA：
  `74b586a4、b6d28c7f、30daa8d7、adab48e5、23ebdd4e、36317796、ccef21ec、3b8d9a31、edbe4397、11c5218c、59f559b3、93ece4b1、9d5dc639、f63daf8c、74bc7217、ade4d912`
  （逐笔主题与逐 diff 行级结论见 BYTE-12 顶层审查报告及 Leader 复跑记录。）
- **「merge main into main」的历史事实**：74b586a4 的 first parent = b6d28c7（本地批次线），second parent = beb7a2d（origin/main 经 PR #9 的 GitHub 合并提交），merge-base = a8485bd；`git diff-tree --cc 74b586a4` 为空 → 无手工改写、无夹带。分叉源于批次推进期间 origin/main 经 4 个 PR 先行合入（e480899→a8485bd→beb7a2d）导致 fast-forward 失效，属并行双写，**无 force-push、无历史改写**，合并后 main 线性。
- **孪生提交**：并行双写使 PR 侧与本地分支侧各落一次同内容提交，共 5 对 patch-id 与 tree 两两相等：13043dd↔61449cd、4acb655↔dcd755c、ac6c811↔173ea3d、e6caf7b↔a8485bd、0a24eb2↔beb7a2d。main 只含 PR 版，孪生的本地版仅可达 agent/mika/* 分支——合并没有把重复内容带上 main。
- 审查结论：16 笔逐 diff 审查 16/16 ✅（无 ❌ 项），该批内容即 main 现状；但流程上全部绕过了「Every change lands via PR」。发布面风险（5 包有行为/安全修复未 bump 未发版）不属本决策，另按 BYTE-12 决策 1 发版跟进。

## 决策口径（成员，2026-10-10，Mika 记录于 BYTE-12）

> 2026-10-09 的 16 笔直推为成员本人意外操作，已追溯确认；后续直推需走 CONTRIBUTING 紧急通道登记。

即：本批历史保持原样、不回滚、不改写；流程缺口由本补录 + 紧急通道 checklist 封闭。

## 后续约束

- 直推仅限成员本人在 CONTRIBUTING「Emergencies」紧急通道条件下使用（明确授权且无法走 PR）；**agent 仍然没有紧急通道**。
- 用后登记：按 CONTRIBUTING 紧急通道 checklist 第 ② 步，在 `byissue/decisions/` 留「授权人 + 时间 + 范围 + SHA 列表」标准记录。
- 事后义务：24h 内补 PR 或 issue 记录，保持历史可解释。
- branch protection（系统性防呆）评估不在本决策范围——结论留 BYTE-12，由成员决定是否启用。
