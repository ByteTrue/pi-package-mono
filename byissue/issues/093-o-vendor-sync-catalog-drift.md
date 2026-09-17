---
kind: issue
title: "pi-vendor 同步体验修复：catalog 定位、计划表格化与存量模型漂移检查"
type: bug
status: open
created: 2026-09-16
labels: [pi-vendor, bug, skill, sync, drift]
---

# pi-vendor 同步体验修复：catalog 定位、计划表格化与存量模型漂移检查

> **读者：** 跨会话接手的人——「要做成什么、别碰什么、现状与方案是否还成立、怎么验、关了要回写哪里」。

## 做成以后是什么样

一次 exact sync 会话应当：开场即按 workflow 执行、不因环境问题绕弯；同步计划以机器生成的表格呈现（JSON 行仍是唯一 mutation authority）；保留模型会自动与最新官方元数据比对，漂移逐项询问用户是否更新，不静默、不遗漏。

**范围：** 包含 vendor.mjs 的 catalog 安装定位修复、`drift` 只读查询、SKILL.md 同步展示与漂移检查契约、evals 与 contract 测试、spec 同步；不包含 npm 发布与已安装副本更新（需用户授权另走 release）。

**归属：** 独立 Issue，根 `byissue/issues/`；产品 spec 为 `byissue/spec/pi-vendor/index.md`。

## 为什么现在做 / 当前坏在哪

真实 session `01a0a603-05b1-7712-9a7f-c960e70d0e1a`（2026-09-15，同步 bytetrueapi 上游）暴露三个缺陷：

1. **指令执行迟缓。** 用户首条消息即要求同步；agent 40 秒内完成 discover + plan，随后 `catalog` 因 `Official catalog is unavailable` 失败，根因是本机 Pi 由 mise/npm 安装，`pi` 是 `node_modules/.bin/pi` 下的 aube-bin-shim 脚本，真实包在 `node_modules/.mise/@earendil-works+pi-coding-agent@<ver>/`，`catalogPaths()` 的 PATH 上溯解析找不到；随后 agent 自行读脚本源码、翻安装目录、探测代理约 10 分钟才给出首个实质回复，期间用户两次催促。
2. **展示格式不便。** plan 以单行 JSON 串展示，`add[0]`/`add[1]~add[4]` 索引式指代不可读。SKILL 旧文案「Do not type any model ID outside that JSON block」把展示与 mutation 权威混在一起，逼出索引指代。
3. **存量模型漂移未检查。** exact sync 只做 ID 集合 add/remove；已保留模型的官方元数据更新（本例 `deepseek/deepseek-v4-flash-vision-exp` 背后上游已转发到 V4.1 Flash，cost 0.14→0.15、context 128k→1M）完全依赖用户口头指出，agent 手工逐个比对又花了约 8 分钟。Pi 自带 catalog 快照还滞后于 models.dev（09-08 生成 vs 09-10 更新），按快照比对也会漏报。

## 现状怎么工作

- `vendor.mjs catalog` 通过 `PI_VENDOR_PI_ROOT` 或 PATH 中的 `pi`（realpath 后向上找 `@earendil-works/pi-coding-agent` package.json）定位安装，再拼 `node_modules/@earendil-works/pi-ai/dist/models.generated.js`；mise aube shim 布局两条路都断。
- exact sync 的 plan 由 SKILL.md 固定 Node 模板生成，stdout 只有单行 JSON；ID 集合比对、断言均正常，无元数据比对步骤。
- `drift` 一类查询不存在；spec 明确「AI-facing script 固定只有两个只读查询」「compare 子命令不存在」。

## 动哪些、验哪些

- 必须改：
  - `packages/pi-vendor/skills/pi-vendor/scripts/vendor.mjs`：catalogPaths 支持 aube shim `target=` 解析、`.mise/@earendil-works+pi-coding-agent@*` 布局、hoisted sibling pi-ai；失败信息带 `PI_VENDOR_PI_ROOT` 提示；新增 `drift <provider-key> <snapshot-file>` 只读查询。
  - `packages/pi-vendor/skills/pi-vendor/SKILL.md`：三查询声明、环境失败护栏、plan 模板输出机器表格、禁索引指代、workflow 2 增加 kept-model 漂移检查步骤、ordering 快照复用与代理重试、audit 增加新鲜度检查。
  - `packages/pi-vendor/skills/pi-vendor/evals/evals.json`：eval 5 更新为表格契约；新增 drift 询问、catalog 不可用两类 eval。
  - `packages/pi-vendor/src/vendor-script.test.ts`、`src/skill-contract.test.ts`：新增/更新断言。
  - `byissue/spec/pi-vendor/index.md`：三查询、展示契约、漂移语义同步。
- 需要验：vitest 全量、真机 `catalog`（aube shim 环境）与 `drift bytetrueapi`（真实 models.dev 快照）只读运行。
- 仍未知：无。

## 方案与实现安排

- `drift` 语义：对 provider `models` 数组逐个在 models.dev 快照中找官方条目——全 provider exact key 匹配 + `vendor/id` 前缀拆解到同名官方直连 provider 的 vendor 匹配；仅比对一一对应的元数据字段（name、contextWindow、maxTokens、cost.input/output/cacheRead/cacheWrite、input、reasoning），configured 侧字段缺失计为漂移、official 侧缺失跳过；`api`/`baseUrl`/compat 等 Pi 路由与方言字段不算漂移。输出 JSON + 机器表格；快照由 Agent 自行 curl 获取（复用于 ordering），脚本自身不出网。漂移报告永远不是授权，更新走 strict in-place patch 并逐项经用户确认。
- mutation 权威不变：plan JSON 文件仍是唯一写入依据；表格仅由机器生成并原样转述；散播到 prose 的 ID 必须来自刚收到的机器输出。
- 展示契约：plan 模板 stdout = 单行 JSON + 摘要表格（add/remove 行 + kept 列表）；catalog source 解析以 ID 命名呈表格；禁止 `add[0]` 索引指代。

## 验证

- `npm --workspace @bytetrue/pi-vendor run typecheck`、`npm --workspace @bytetrue/pi-vendor test`（含新增 shim/drift/模板抽取执行测试）。
- 真机只读 smoke：repo 脚本目录下 `catalog 'gpt-6'`（应经 aube shim 命中本机 catalog）；`drift bytetrueapi /tmp/modelsdev.json`（对真实配置输出漂移报告，验证 deepseek 案例字段映射）。

## 执行记录

2026-09-16（受管理实现，issue 086）：

- `vendor.mjs`：新增 `shimRoots()`（解析 mise/aube bin shim 文本中的 `target=`/`$basedir` 包路径）与 `miseRoots()`（`node_modules/.mise/@earendil-works+pi-coding-agent@*` 布局）；catalogPaths 补 hoisted 同层 `pi-ai` 路径；`catalog` 失败信息带 `PI_VENDOR_PI_ROOT` 提示；抽出共享 `officialModels()` 加载器。新增 `drift <provider-key> [official-provider,...]` 只读查询。
- `SKILL.md`：三查询声明；环境失败护栏（至多一次文档化恢复）；plan 模板 stdout 追加摘要表格（add/remove 行 + kept 列表）；workflow 2 重写（新增 kept-model drift check 与 drift 更新走 strict in-place patch 的步骤；ordering 的 models.dev 拉取仅用于 release_date，代理重试一次）；全面禁 `add[0]` 索引指代；展示与 mutation 权威分离（ID 必须来自刚收到的机器输出）。
- `evals.json`：eval 5 改为表格契约；新增 eval 8（drift 询问）与 eval 9（catalog 不可用的单次恢复护栏）。
- 测试：`skill-contract.test.ts` 更新并新增 3 个断言块；`vendor-script.test.ts` 新增 aube shim 解析、无 shim 文本的 .mise 同级、失败提示、drift 正常/路由豁免/vendor 前缀与 restrict 共 8 个用例；新增 `skill-plan-template.test.ts`（从 SKILL.md 抽取 Generate-the-plan Node 程序并真实执行，断言 JSON+表格双输出与 no-op 分支）。
- spec 同步：`byissue/spec/pi-vendor/index.md` 三查询、展示契约、drift 语义、catalog 安装定位策略；README 同步三查询表。

2026-09-16（用户修正后的返工）：

- **用户拍板：drift 比对基线改为当前 active Pi 内置官方 catalog，不再使用 models.dev 快照**。理由：本仓配置全部复制自内置模板，「配置 vs 当前内置」才是有意义的基线；models.dev 作为基线引入了快照获取/代理/字段映射三层额外复杂度，且聚合源噪声大。内置快照滞后于 models.dev 属已知且可接受（Pi 升级后模板刷新，漂移检查自然抓到过期副本）。
- 重写 drift：删除快照文件参数、models.dev 字段映射与 unresolved 机制；改为与 `catalog` 同源的 `officialModels()` 直读，同 schema 逐字段对比（leaf-level，排除 `id`/`api`/`baseUrl`/`headers`/凭据等路由字段，null 视同缺省）；模板匹配含 exact 与 `vendor/id` 前缀两种；可选第二参限定官方源。
- 降噪规则：配置与任一当前官方模板完全一致即 up-to-date（对其他源差异不再展示）——实测用户配置 19 模型中 16 个 up-to-date，仅 3 个真实漂移（含 vision-exp 手工 4.1 修复 vs 当前内置 deepseek 模板的 4 处差异，诚实上报交用户决定）。
- 验证：`npm --workspace @bytetrue/pi-vendor test` 185/185 通过；typecheck 通过；真机 smoke：`drift bytetrueapi`（无网络无快照，16 up-to-date / 3 drifted，表格正确）、`drift bytetrueapi deepseek`（restrict 模式）。

2026-09-17（远端主干整合与发布授权）：

- 远端已合并 `f6ca5db`（重构 SKILL 正面表述）并发布 `pi-vendor 0.3.9`，且制度记忆根目录已由 `codestable` 更名为 `byissue`（issue 086 占用，本 issue 顺延为 093）。
- 将本变更完整整合至当前主干：SKILL.md 遵循 `byissue/decisions/001-positive-first-prompting.md`（正面表述优先）；`byissue/spec/pi-vendor/index.md` 同步；版本升级为 `0.4.0`。
- 用户确认授权发布。准备推送到 main 并触发 GitHub Actions CI OIDC 发布 `pi-vendor-v0.4.0`，之后更新 `~/.pi/agent/npm` 本地安装副本。

## 关闭时

- 回写到 project spec 的候选：pi-vendor `index.md` 三查询、drift 语义、同步展示契约（本 issue 内已同步）。
- 关闭判断与验证摘要：真机 sync 会话不再绕弯、计划以表格呈现、漂移主动询问。
- 遗留：发布完成后更新本地副本并确认关闭。
