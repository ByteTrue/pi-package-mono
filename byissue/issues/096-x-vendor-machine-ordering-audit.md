---
kind: issue
title: "pi-vendor 排序门禁机器化：新增 vendor.mjs order 只读审计查询"
type: bug
status: closed
created: 2026-09-23
---

# pi-vendor 排序门禁机器化

> **读者：** 跨会话接手的人——「要做成什么、别碰什么、现状与方案是否还成立、怎么验、关了要回写哪里」。

## 预期与实际

**预期：** 任何发生模型变更的会话，在汇报完成前对「每个 provider 的 `models` 数组是否符合约定顺序（大系列 A-Z，系列内按 models.dev `release_date` 升序）」给出**机器证据**；有乱序或无法定序时显式告警并询问用户，不静默结束。

**实际（会话 `01a0cc2c-b791-77b0-bf07-99293e652d72`，2026-09-23）：** AI 声称「claude 系列内 sonnet-5 → opus-5-5 → fable-5-1，无乱序」，**未拉取任何 release_date**。用户追问「排序是不是漏了，我们系列内是按推出时间排序哦」后它才 fetch models.dev，立刻发现真实乱序：`claude-opus-5-5`(2026-09-22) 排在 `claude-fable-5-1`(2026-09-01) 之前。同一会话后续又依赖它手工比对 gpt 系发布日期。

**最小复现：** 配置中 `claude` 系列按 `sonnet-5 / opus-5-5 / fable-5-1` 排列，只改其中某个模型的字段（不改位置），然后按 SKILL.md 的 Model ordering 步骤执行——现流程给不出任何机器证据，AI 可以用「我没移动它」直接得出结论。

**根因：** 排序门禁是三处门禁里唯一**没有机器产物**的一条。exact sync 有 plan JSON + 三道断言、drift 有机器表格，都必须原样转述；ordering 只有散文指令，判断链（抓取 models.dev → 按 ID 匹配条目 → 归系列 → 取日期 → 排序 → 比对）全是确定性的，却留给模型临场现编，于是被一句自我断言绕过。

## 现状怎么工作

- `packages/pi-vendor/skills/pi-vendor/SKILL.md`「Model ordering」节规定：约定顺序、日期来源 `https://models.dev/api.json`（失败经代理重试一次）、Enforcement Gate（检测到乱序必须显式告警并询问）、重排是只移动对象不改字段的窄编辑。三处 workflow 步骤（1.8 / 2.13 / 4.6）与末尾汇报句都引用它。
- **全部为散文**：没有脚本子命令、没有固定 Node 模板、没有可执行输出。
- 与之对照：`vendor.mjs` 已有 `catalog` / `discover` / `drift` 三个只读查询，输出 JSON + 机器表格，AI 原样转述（`byissue/issues/093-x-vendor-sync-catalog-drift.md`）。
- `models.dev/api.json` 中同一 model id 会出现在多个 provider 下，`release_date` 可能不一致（实测 `claude-sonnet-5` 为 06-29×2 / 06-30×18）；`family` 字段口径不统一（`gemini` 与 `gemini-flash` 并存），不能直接用。
- Pi 内置官方 catalog **没有** `release_date` 字段（实测 `.MODELS` 无该键），所以日期必须来自 models.dev，脚本自身不出网。

## 影响面

**必须改**

- `packages/pi-vendor/skills/pi-vendor/scripts/vendor.mjs`：新增 `order <snapshot-file> [provider-key,...]` 只读查询。
- `packages/pi-vendor/skills/pi-vendor/SKILL.md`：查询声明三→四；Model ordering 节改为「跑机器查询 + 原样转述 + 有乱序/未定序时告警询问」；三处 workflow 步骤与汇报句改为引用该查询（含固定的 models.dev 抓取命令与代理重试）。
- `packages/pi-vendor/src/skill-contract.test.ts`：查询面断言更新；新增 ordering 契约断言。
- `packages/pi-vendor/src/vendor-script.test.ts`：`order` 的乱序 / 有序 / 未定序 / 缺参 fixture 用例。
- `packages/pi-vendor/skills/pi-vendor/evals/evals.json`：新增一条 ordering 门禁 eval。
- `byissue/spec/pi-vendor/index.md`：查询表、ordering 语义。
- `packages/pi-vendor/README.md`：查询表。

**需要验**

- typecheck / vitest 全量 / `pack --dry-run`。
- 真机 smoke（isolated `PI_CODING_AGENT_DIR`，不碰用户配置）：用真实 `/tmp` models.dev 快照跑 `order`，确认能检出历史乱序（opus-5-5 在 fable-5-1 之前）并在有序文件上静默通过。
- 重新 curl 一次 models.dev，确认 SKILL 里给的抓取命令可直接用。

**仍未知**

- 无。

## 方案

**分工：确定性读取与计算进脚本，判断与绑定留给 AI。** 排序审计的每一步（取日期、匹配、归系列、比对、给出建议顺序）都是确定性的，整体做成 `vendor.mjs order`；AI 只负责跑它、原样转述输出、在有乱序或未定序时向用户提问、得到确认后用普通 edit 做窄重排。包不新增写动词，与 exact sync「计划由模板生成、写入由 AI 执行」同构。

**`order <snapshot-file> [provider-key,...]` 契约**

- 只读；入参为 models.dev 快照文件路径与可选的 provider 限定列表；缺快照参数即用法错误（脚本不出网）。
- 逐个 provider 检查其 `models` 数组（默认全部 provider，限定参数时只查指定项）。
- **系列**：取 model id 去掉 `vendor/` 前缀后的首个小写字母串（`claude-opus-5-5` → `claude`，`openai/gpt-oss-120b` → `gpt`，`qwen3.8-max` → `qwen`）；无法归纳的记为 unresolved。
- **日期**：在快照中按「同 id 全 provider 匹配」加「`vendor/id` 前缀拆解匹配」收集 `release_date`；多个不同值时取众数并同时输出全部候选（`dateConflicts`），匹配不到记为 unresolved。
- **判定**：同系列内按日期升序，跨系列按系列名字母序；相邻逆序对即 deviation。
- **输出**：JSON（`providers[].series[] / order / proposedOrder / deviations / unresolved`、顶层计数）+ 机器表格（逐模型一行：provider / 位置 / id / 系列 / 日期 / 来源 provider），并列 deviations 与 unresolved 两张表。有任一 deviation 或 unresolved 时以非零码退出，阻止「静默完成」。
- `proposedOrder` 为稳定排序结果（同日期保持原相对位置）；unresolved 暂列其系列末尾并在输出中标注需用户补日期。

**原则固化（本次一并记录）**：能确定性完成的读取与计算一律做成脚本查询，输出机器可转述的证据；散文只保留判断、取值与确认类规则。落 `byissue/decisions/002-...`（关闭候选，见下）。

**有界简化：** 不做写入/自动重排，不缓存快照，不做跨 provider 的全局排序；日期冲突只报告不裁决。升级触发：若出现「同一系列必须按能力档位而非日期排序」的需求，改由用户提供排序键，脚本只比对。

## 验证

```sh
npm --workspace @bytetrue/pi-vendor run typecheck
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor pack --dry-run
```

真机 smoke：

```sh
curl -s --max-time 30 https://models.dev/api.json -o /tmp/modelsdev.json
PI_CODING_AGENT_DIR=<isolated dir with a copy of the config> node '<skill dir>/scripts/vendor.mjs' order /tmp/modelsdev.json
```

期望：历史乱序配置非零退出且 deviations 指向 `claude-opus-5-5` 与 `claude-fable-5-1`；乱序修正后的配置零退出、表格全绿。

## 执行记录

2026-09-23（受管理实现，issue 096）：

- `vendors.mjs`：新增 `modelSeries` / `releaseDateIndex` / `resolveReleaseDate` / `order`。`order <models.dev-snapshot-file> [provider-key,...]` 逐个 provider 审计 `models` 数组：系列取 id 去 `vendor/` 前缀后首个字母串；日期按「同 id 全 provider 匹配」+「`vendor/id` 前缀拆解匹配」收集，多值时取来源数最多的日期并输出其余候选为 `conflicts`；输出 JSON（`status`/`checked`/`deviations`/`unresolved`/`providers[].order|proposedOrder|series|models`）+ 逐 provider 表格 + deviations 表 + unresolved 表；有任一 deviation 或 unresolved 时 `process.exitCode = 1`。用法串更新为 `catalog|discover|drift|order`。
- `SKILL.md`：查询声明三→四；三处 workflow 步骤（1.8 / 2.13 / 4.6）与收尾句改为「拉 models.dev 快照 → 运行 `order` → 原样转述 → 据 deviations/unresolved 行动」；Model ordering 节重写为机器审计：固定 `mktemp` + `curl` + `order` 命令块、禁止凭记忆或「未移动位置」断言顺序、原样转述表格、Enforcement Gate 以审计非零退出为准、用 `proposedOrder` 提方案、unresolved 行问用户补日期。
- 测试：`vendor-script.test.ts` 新增 6 个 `order` 用例（乱序检出与 `proposedOrder`、有序静默通过、无日期 unresolved、跨系列乱序、多源日期众数+conflicts、缺参/非快照文件）；`skill-contract.test.ts` 查询面与 ordering 契约断言更新。全套 191 passed。
- 其他：`evals.json` 新增 eval 10（ordering 门禁行为）；`byissue/spec/pi-vendor/index.md` 查询表与 ordering 语义；`README.md` 查询表 + 门禁句。
- 判据落盘：`byissue/decisions/002-deterministic-work-belongs-in-script.md`。

## 验证

- `npm --workspace @bytetrue/pi-vendor run typecheck` → 通过。
- `npm --workspace @bytetrue/pi-vendor test` → 19 个测试文件，191/191 通过（基线 185）。
- `npm --workspace @bytetrue/pi-vendor pack --dry-run` → 通过（23 files）。
- 真机 smoke（isolated `PI_CODING_AGENT_DIR` + 真实 `/tmp/modelsdev.json` 快照）：
  - 复现历史乱序的 fixture（`sonnet-5 / opus-5-5 / fable-5-1`）→ `exit 1`，deviations 表命中 `claude-opus-5-5 (2026-09-22)` 在 `claude-fable-5-1 (2026-09-01)` 之前；
  - 用户当前配置（已修正顺序）→ `exit 0`，`Every provider's models array already follows the agreed order.`，14 个模型全部有日期。

## 关闭结论

- **为何可关**：门禁类检查从「散文断言」改为「机器产物」这一目标已达成；排序审计由 `vendor.mjs order` 产出，AI 只能运行并原样转述，deviation 或 unresolved 一律非零退出，机制上排除了「凭记忆断言无乱序」。
- **验证摘要**：typecheck 通过；191/191 测试（基线 185，新增 6 个 `order` 用例 + 更新契约断言）；pack 通过；真机 smoke 在历史乱序 fixture 上 `exit 1` 且精确命中 `claude-opus-5-5` 在 `claude-fable-5-1` 之前，在已修正配置上 `exit 0`。
- **回写位置**：`byissue/spec/pi-vendor/index.md`（查询表加 `order`、ordering 语义改为机器审计、证据区链 decision 002）；`packages/pi-vendor/README.md`（查询表 + 门禁句）；判据落 `byissue/decisions/002-deterministic-work-belongs-in-script.md`。
- **遗留**：无。npm 发版与本地安装副本更新按用户授权另行完成（见下）。

## 发布

（发布记录在推送 tag 后于此处补充。）

## 关闭时

- 回写 `byissue/spec/pi-vendor/index.md`：查询表加 `order`、ordering 语义改为机器审计。
- 立 `byissue/decisions/002-...`：确定性读取与计算进脚本、散文只留判断（记录本次取舍与「为什么不做成 SKILL 内固定模板」）。
- 关闭判断：改前/改后的行为对照——同一乱序配置，旧流程可被一句断言放过，新流程非零退出并给出机器表格。
