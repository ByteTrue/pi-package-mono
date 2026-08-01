---
kind: issue
title: "pi-vendor 出 skill 与三个只读动词"
type: feature
status: closed
created: 2026-07-29
epic: ".cs/epics/003-x-vendor-ai-first/spec.md"
---

# pi-vendor 出 skill 与三个只读动词

## 目标

装了 `@bytetrue/pi-vendor` 之后，用户可以直接对 AI 说"给 X 加个 claude-opus-4.5"、"把 Y 的 baseUrl 改成 Z"、"审一下我的配置"，AI 能可靠完成——不靠记忆填字段，不把 apiKey 值复现在输出里。

## 范围

- 包含：`skills/pi-vendor/SKILL.md`、三个只读动词（catalog search / validate / discover）、`package.json` 的 `pi.skills` 声明
- 不包含：写动词（mutation 归 AI 自己的 `edit`）、`auth.json` / OAuth、npm 发版

## 归属

- 隶属 epic：`.cs/epics/003-x-vendor-ai-first/spec.md`（切片 3）
- 依赖：切片 2 完成（TUI 与动词共用 core，先把 core 接线理清）

## 背景与证据

- owner 用自己的 skill（`~/workspace/CFG/.agents/skills/pi-official-model-config`）实际维护配置，体验优于本包——**这是 AI-first 可行性的直接证据**。
- 那个 skill 的两个不可分发之处：硬编码了 owner 自己的仓库路径（`configs/ai-agent/pi/models.json`）、依赖仓库内的 `lookup-official-model.mjs`。本包要出的是它的可分发版。
- Pi 包可通过 `skills/` 目录或 `pi.skills` 声明分发 skill（`docs/packages.md:126,163`）。
- 包内已有 AI 拿不到的确定性能力：`official-catalog` + `templates`（模板解析，取 **active Pi runtime** 的 catalog）、`config-core`（Pi `ModelRegistry` oracle 校验）、`bounded-discover`（`/models` 发现 + 安全边界）。

## 实现设计

### 三个只读动词

| 动词 | 做什么 | 复用 |
|---|---|---|
| catalog search | 按 query 搜 active Pi runtime catalog，输出候选与**完整模板 JSON** | `official-catalog` + `templates` + `fuzzy` |
| validate | 把候选配置过一遍 Pi `ModelRegistry` oracle，返回 typed 结果 | `config-core` |
| discover | 对 provider endpoint 请求 `/models`，返回 id 列表 | `bounded-discover` |

**都不写 `models.json`。** `validate` 会刷新当前 Pi session 的内存 registry；写路径不出动词——AI 用自己的 `edit` 改 JSON。这是 owner 现有 skill 的形状。代价是 AI edit 不具备 config-core 的 conditional commit；单用户配置文件可接受。

关键设计点：**catalog search 直接输出模板 JSON 让 AI 粘贴，而不是让 AI 凭记忆填字段。** Pi oracle 只挡 schema 错，挡不住"合法但错"的 `contextWindow` 或漏掉的 compat flag。

### SKILL.md 必须包含的硬规则

1. **apiKey 值永不复现在输出里。** 明文存在 `models.json`，AI 编辑时会读进上下文——可以读，但不能在回复、日志、diff 展示里重复它。这条替代整套已删除的 `SecretRef` 机制，是本次唯一新增的安全约束。
2. **密钥录入给命令，不问值。** 需要用户填 key 时，给出一条**直接改写 `models.json` 里 apiKey 字段的命令**让用户在自己终端跑，key 从不经过 AI。
3. **目标 provider 与官方源 provider 是两个身份**，常不同，永不互相替代。
4. **一个 model id 有多个官方源模板时必须让用户选**，不自动挑（可以给推荐与理由）。
5. **anthropic `/v1` 规则**：复制官方模板时不复制 `baseUrl`；model 的 `api` 为 `anthropic-messages` 且 provider 级 `baseUrl` 带 `/v1` 时，model 级 override `baseUrl` 去掉 `/v1`；其他 api 类型不设 model 级 `baseUrl`。
6. **每次 mutation 后过 validate 动词**，并报告改了哪些路径。
7. **不发明数据**：定价、能力、上下文上限、compat flag 没有官方模板就问，不猜。
8. **配置路径**：`$PI_CODING_AGENT_DIR/models.json` 或 `~/.pi/agent/models.json`；不硬编码任何个人仓库路径。

### 怎么确认做对

真机各跑一遍并检查落盘结果：

| 场景 | 预期 |
|---|---|
| "给 X 加 <有唯一官方模板的 id>" | 套模板、validate 通过、报告改动路径 |
| "给 X 加 <有多个官方源的 id>" | 停下来让用户选源，不自动挑 |
| "给 X 加 <catalog 里没有的 id>" | 只写 id 与必要路由，不编造元数据 |
| "把 X 的 baseUrl 改成 Y" | 只改该字段，validate 通过 |
| "删掉 X 的 <model>" | 精确删除，先确认 |
| "审一下我的配置" | 报 schema 错、模板漂移、断引用；**输出里没有任何 apiKey 值** |
| 需要填 key | 给命令，不问 key 的值 |

## 质量目标

- **信息安全性**：任何一条输出路径都不得复现 apiKey 值。
  - 来源：本 epic 决策（明文存盘的连带约束）
  - 证据：审计场景真机跑一遍，人工检查完整输出
- **功能正确性**：模板元数据靠粘贴而非默写。
  - 证据：有唯一模板的场景，落盘结果与 catalog 模板逐字段一致

## 验证

- `npm --workspace @bytetrue/pi-vendor run typecheck`
- `npm --workspace @bytetrue/pi-vendor test`（三个动词各自单测）
- 真机跑完上表七个场景，检查 `models.json` 落盘结果与完整输出
- 验证不得读写真实 `~/.pi`：用项目内临时 config 目录（`PI_CODING_AGENT_DIR`）

## 执行记录

- 新增 `skills/pi-vendor/SKILL.md`，覆盖 inspect/add/update/remove/discover/audit、模板歧义、目标/来源 provider、Anthropic `/v1` override、validate 后置检查与 apiKey 不复现边界。
- 新增 `vendor_catalog_search`、`vendor_discover`、`vendor_validate`，并在 default extension registration 中与 `/vendor` 一起注册；无 lifecycle hook、无 mutation tool。
- `vendor_catalog_search` 使用 active Pi catalog closed DTO；补齐 Pi 0.82 当前 compat 字段，任意未知 top/nested field 都 fail loud 为 `catalog_unavailable`，避免成功返回残缺模板。
- `vendor_discover` 从已配置 provider 读取凭据，保留 command exact-path preflight；command runner 改为真正 shell command，修正 `$!`/invalid `${}`/literal `$` 语义，并覆盖 nonzero/64 KiB/timeout/abort。
- `vendor_validate` 使用运行中的 awaited registry refresh/getError；错误文本按当前 provider apiKey 值脱敏。
- 新增 bundled `scripts/set-api-key.mjs`：TTY 无回显输入、Pi literal metacharacter encoding、并发 bytes 变化时 abort、随机 temp + `0600` + rename；不把 key 放 argv/chat。
- package manifest 声明 `pi.skills` 与 `skills/**`；真实 Pi RPC `get_commands` 已发现 `skill:pi-vendor`，pack dry-run 含 Skill 与 helper。
- 自动化：工具、key helper、resolver、active catalog shape 均有聚焦测试；最终 package suite 21 files / 191 tests，typecheck 通过。
- 独立 reviewer 经过三轮 changes-requested 修复后最终 verdict：blocking=0、important=0。

## 2026-08-03 后续简化

Owner 验收后判定三个常驻 tool 属于过度设计；该运行时 surface 已由 `.cs/issues/035-x-vendor-skill-script.md` 取代。当前实现不注册 AI tools，catalog/discover/lint/set-key 均由 Skill bundled script 按需承担。本 issue 保留为当时实现历史，不再是现行接口合同。
