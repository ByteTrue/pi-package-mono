---
kind: issue
title: "pi-vendor 修复异构上游发现与 Skill 主路径"
type: bug
status: open
created: 2026-08-14
labels: [pi-vendor, bug, discovery, skill, security]
---

# pi-vendor 修复异构上游发现与 Skill 主路径

## 目标

让低能力 Agent 也能可靠完成四类核心请求：按自然称呼配置模型、查看 provider 上游模型、增加 provider、增删查改 provider/model；同时不暴露凭据、不混淆官方 catalog 与实际上游能力，并在结束前用 Pi 自身验证配置可加载。

## 触发证据

真实 session：

- `01a0002b-4630-77c3-910d-399272a2d313`：用户询问 bytetrueapi 上游模型，Agent 先执行 `catalog all`，把 Pi 全局官方 catalog 中的 Mistral、OpenRouter、Bedrock 等模型误报为目标上游；随后只执行默认 OpenAI route 的 discovery，并把 models.json 中静态配置误报为其他接口的上游结果。
- `019fff28-a1d8-7f93-8ae5-6d1170a7b62d`：Agent 无法稳定区分目标 provider、实际网关上游和官方 catalog provider，多次要求用户重新选择来源；过程中使用 `cat ~/.pi/agent/models.json`，使 `apiKey` 原文进入 Agent 工具结果和 session 上下文。

现有 034 已解决单 route discovery 的协议级支持，但关闭后的使用面仍要求 Agent 自己解析、分组、循环调用和比较；脚本没有提供完成该任务的聚合契约。

## 当前问题

1. 原 `discover <provider> [model]` 要求 Agent 自己解析配置、选择 route 并循环调用，不能一次枚举异构 provider 的所有 effective route。
2. 后续增加的 `compare` 又引入 configured/unconfigured/not-listed/unverified 多组语义，使弱 Agent 仍需理解复杂协议，偏离用户的核心任务。
3. `catalog` 是 active Pi 的全局官方模型目录，不是目标 provider 的上游模型列表；它必须只承担模糊候选与官方 metadata 搜索。
4. 用户说“千问 3.7”时表达的是模型意图，不一定是 canonical ID；机械搜索或写入原文会漏掉 `qwen3.7` 等实际候选。
5. 普通 shell 读取完整 models.json 会把 `apiKey`、headers 中的凭据或命令配置送入 Agent 上下文。
6. 普通 edit 后缺少强制 Pi oracle 门槛；真实 session 已出现漏逗号导致整个 models.json 不可用，而 Agent仍报告完成。
7. 真实 exact sync 演练中，discovery 与配置 ID 都正确，但 Agent 在自然语言手抄差集时把未列出的 `gpt-5.6-luna` 错写成仍在上游的 `gpt-5.6-sol`；Pi load oracle 无法发现这种合法 JSON 内的语义误删。

## 方案边界

- AI-facing bundled script 固定只有两个查询：`catalog <keyword>` 与 `discover <provider-key>`；不提供 compare、lint 或 CRUD 子命令。
- `discover` 从 provider-level route 固定派生四种 API adapter，再追加 configured model 引入的不同 effective overrides；去重后并发 bounded discovery，输出仅含 route API、状态和模型 ID。
- `catalog` 只做 active Pi 官方目录的模糊关键词搜索；支持空格/连字符/下划线归一，Skill 可把自然称呼转成更可能的 catalog 关键词重试，但不能静默决定 canonical ID。
- Skill 固定为四个编号工作流：配置模型、查看或 exact sync 上游模型、增加 provider、增删查改 provider/model；不得自行发明 compare/diff 或手工 route 循环。
- Exact sync 只在所有 intended route 为 `ok` 时允许删除；Skill 固定 Node 模板输出排序后的 `{before,add,remove,after}` plan 文件，该 JSON 是唯一 mutation authority，必须原样展示，禁止 Agent 手抄 ID。
- 固定模板在写入前要求 current IDs 等于 confirmed `before`，写入后要求 actual IDs 与再次 discovery union 都等于 confirmed `after`；`plan_stale`、`plan_after_mismatch` 或 `discovery_union_mismatch` 任一出现即不得报告成功。Pi load oracle 通过不是 exact sync 成功的替代条件。
- `modelOverrides` 不进入 exact sync，必须走定向 update/delete；禁止 `catalog all`、完整输出 models.json 与 credential-bearing 输出；模板只能输出目标 provider 的 ID plan。
- 保留现有四种 adapter、positive evidence、redirect/deadline/body budget、command resolution 与 credential echo fail-closed 边界。

## 不做

- 不重新设计已经关闭的 034 协议适配器。
- 不把官方 catalog 当成 provider-specific upstream catalog。
- 不增加常驻 AI tool 或 Web UI。
- 不改变用户选择模型 ID、目标 provider、官方 source 和冲突处理的两阶段授权边界。
- 不通过脚本自动修改 models.json；聚合与比较阶段必须只读。

## 验收标准

- 即使 provider 只声明一个默认 API，一次 `discover <provider>` 也探查四种 provider-level adapter；model-level override 追加不同 route，相同 effective route 去重。
- discovery 输出只有 source、provider key、route ID/API/status 与模型 ID；单 route 失败不隐藏其他成功 route，也不产生 unsupported/diff 推断。
- `catalog "qwen 3.7"` 能匹配 `qwen3.7`；自然称呼通过 Skill 转成搜索候选，模糊结果不静默写入。
- catalog 与 discovery 有明确不同的 source/officialProvider 字段；官方目录不会被报告为目标 provider 上游能力。
- 隔离配置目录与测试 HTTP server 的 stdout/stderr 不包含 apiKey、resolved credential、Authorization token、headers 或完整配置；credential echo 仍使 discovery fail closed。
- Skill 只提供四个固定工作流，不再引用 compare/lint；`set-key` 只属于用户终端。
- 每个 mutation 工作流结束前明确要求 `pi --list-models --offline`，并知道 malformed models.json 可 warning + exit 0；warning、命令失败或目标模型状态不符都必须修复或恢复。
- 回归覆盖四种 adapter 聚合、route 去重、fuzzy catalog、语义隔离、secret redaction、partial failure 与移除命令。
- Exact sync 回归覆盖 plan 原样展示（`luna` 不得误写成 `sol`）、写前 `before` stale 拒绝和写后 actual/after mismatch 不得报告成功。

## 验证计划

- `npm --workspace @bytetrue/pi-vendor test`
- `npm --workspace @bytetrue/pi-vendor run typecheck`
- packed package 中分别执行 `catalog`、`discover`，并确认 `compare`/`lint` 不可用。
- 使用 isolated `PI_CODING_AGENT_DIR` 运行 active `pi --list-models --offline`，验证合法配置无 warning 且目标 ID 出现；漏逗号配置即使 exit 0 也产生 `errors loading models.json` warning。
- 使用两份真实 session 作为回归样本，确认同类请求不再调用 `catalog all`、compare 或完整读取 models.json，并能一次报告所有 effective routes。
- 独立检查配置文件和测试日志，确认没有 credential occurrence。
- 用较低能力模型对 old/new Skill 并行执行 exact plan fidelity、stale-before 与 post-edit mismatch eval，确认新协议能阻止手工转录和错误完成。

## 执行记录

- 撤销初版 `compare`/diff 方向；`vendor.mjs discover <provider-key>` 从 provider route 派生四种 adapter，再追加 model-level effective overrides，按 `api/baseUrl/merged headers/authHeader` 去重并并发探查。
- AI-facing 输出收敛为 `catalog` 与 `discover` 两类 source；不再输出 configured/unconfigured/not-listed/unverified 集合。
- `catalog` 增加 token 与空格/连字符/下划线归一匹配，覆盖 `qwen 3.7` → `qwen3.7`；Skill 明确自然称呼先转为候选关键词而不是直接写成 ID。
- Skill 重写为四个固定工作流，删除 compare/lint 主路径，禁止 `catalog all`、完整 models.json 输出和手工 route 循环。
- mutation 完成条件改为运行 active `pi --list-models --offline`、检查两条输出流无 models.json warning，并验证目标模型列表状态；路由、认证或模型路由变化还要求 intended discovery route 为 `ok`。实测 malformed JSON 会 warning 后 exit 0，因此状态码不是充分条件。
- `set-key` 继续作为用户终端专用 helper，不属于两个 AI-facing 查询。
- 真实 `bytetrueapi` exact sync 演练先复现 `luna`/`sol` 手工转录错误；写入前复核阻止误删。正确同步后 configured 7 IDs 与 upstream union 完全相等、Pi offline 无 warning、discovery 四条 route 均 `ok`、models.json 权限仍为 `0600`。
- 根因修复不恢复 `compare`：Skill 的 workflow 2 改为唯一的固定 Node plan/stale/after/union 模板，生成 ID-only plan 文件并强制 verbatim confirmation；写前 stale gate、写后 exact-set gate 和 discovery union gate 都不依赖 Agent 手写集合逻辑。bundled script 仍只有 `catalog`/`discover` 两个 AI-facing 查询。
- exact-sync fixed-template isolation rehearsal: raw plan preserved `gpt-5.6-sol` while removing only `gpt-5.6-luna`; before assertion passed, deliberately wrong post-edit set emitted `plan_after_mismatch`, corrected set emitted `plan_after_matches=yes`, and verified route union emitted `discovery_union_matches=yes`. No user configuration or credential was read.

## 验证记录

- `npm --workspace @bytetrue/pi-vendor test`：通过，18 个测试文件、178 个测试；其中新增 `skill-contract.test.ts` 锁定固定 plan/stale/after/union 模板与两条 AI-facing 查询边界，`vendor-script.test.ts` 15 个覆盖四种 adapter 聚合、route 去重、不同 model-level override、fuzzy catalog、partial failure、credential redaction/echo fail-closed 与 compare/lint 移除。
- `npm --workspace @bytetrue/pi-vendor run typecheck`：通过。
- actual pack/extract smoke：packed `catalog` 返回 official-catalog，packed `discover` 返回 4 条 provider-level adapter route；`compare` 与 `lint` 均以 usage status 2 拒绝。
- active Pi oracle fixture：合法配置 status 0、目标 `test-model` 可见且无 warning；漏逗号配置 status 0 但产生 `errors loading models.json` warning，验证 Skill 不能只看退出码。
- `git diff --check`：通过。
- 尚未执行真实上游 session 重放；当前 discovery 证据来自隔离配置目录与本地 HTTP fixture。
## 相关事实

- `codestable/issues/034-x-vendor-protocol-discovery.md`：已关闭的协议级异构 discovery 支持。
- `codestable/issues/035-x-vendor-skill-script.md`：已关闭的 Skill bundled script 架构切换。
- `codestable/spec/pi-vendor/index.md`：当前 pi-vendor 稳定规格。
- `packages/pi-vendor/skills/pi-vendor/scripts/vendor.mjs`：当前 catalog/discover 与用户终端 set-key 实现。
- `packages/pi-vendor/skills/pi-vendor/SKILL.md`：当前 AI 操作协议。
