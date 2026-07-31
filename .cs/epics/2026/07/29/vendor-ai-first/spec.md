---
kind: epic
title: pi-vendor 转向 AI-first
status: closed
created: 2026-07-29
---

# pi-vendor 转向 AI-first

## 这个 Epic 要改变什么

把 `@bytetrue/pi-vendor` 从**UI 包**变成**能力提供者**：

- 日常增删改查交给 AI，包内出一个可分发的 `skills/pi-vendor/SKILL.md`
- 只保留 AI 自己无法可靠内联的确定性能力，放进 Skill bundled script（catalog / discover / lint / set-key），按需执行且不注册常驻 AI tool
- mutation 归 AI 自己的 `edit`，包内不出写动词
- TUI 缩成两条直线，只服务"冷启动"和"一次性单发"
- **删掉整个 Web**（8,908 行，占包 59%）以及只为浏览器边界存在的 `SecretRef` / `mask`

终态：`src/` 15,096 → 5,685 行（删除 9,411 行，约 62%）；比预估多保留的是经验证仍有消费者的 config/model-source 安全 core 与新增 script tests。

## 为什么现在做

owner 用自己的 skill（`~/workspace/CFG/.agents/skills/pi-official-model-config`）实际维护 Pi 模型配置，体验优于本包，判定本包过重。会话中验证后确认：Web 唯一剩下的独特价值"改前看 diff 再确认"，AI 在对话里本来就提供——是冗余不是互补；而它同时是包内 review 成本最高、最易出微妙错误的部分。

owner 已明确**放弃"不用 AI 也能管全部"这个产品承诺**。

## 关联 Project Spec

- `.cs/spec/pi-vendor/index.md`（本 epic 关闭时大幅重写）
- `.cs/spec/index.md`（包能力地图需同步）

被本 epic 作废的历史结论：

- closed epic `.cs/epics/2026/07/12/vendor-dual-ui-manager/spec.md`（双 UI 单语义）
- closed epic `.cs/epics/2026/07/14/vendor-web-productization/spec.md`（Web 产品化）
- closed issue `.cs/issues/2026/07/12/closed-vendor-web-*.md`、`.cs/issues/2026/07/14/closed-web-*.md`、`.cs/issues/2026/07/15/closed-web-visual-redesign.md`

历史材料本身不删，留在原处与 `.cs/archive/`；切片 4 统一标 superseded。

## 当前方案

```text
@bytetrue/pi-vendor
├── skills/pi-vendor/SKILL.md   ← 主路径：增删改查 / 官方模板 / /models 导入 / 密钥命令 / 审查
├── Skill bundled script（AI 按需执行；key 子命令由用户执行）
│     catalog search   → 输出官方模板 JSON（AI 粘贴，不默写）
│     validate         → Pi oracle
│     discover /models → bounded-discover
└── TUI /vendor        ← 两条直线
      ├── Add provider
      └── Add model
```

TUI `Add provider`（owner 给定顺序，一次只加一个模型）：

```text
1. Provider key
2. Base URL
3. API 类型（4 选 1 + Custom）
4. API key（输入 → literal encoding 后入库）
5. GET {baseUrl}/models          ← 用第 4 步的 key，故 key 必须先于发现
   ├─ 成功 → 列出全部上游 id，选一个
   └─ 失败 → 退回手输 model id（命中官方 catalog 就套模板）
6. 解析官方模板：0 候选 → 明确 warning 后写 TUI safe defaults；1 候选 → 自动；多候选 → 一个 select
7. 本地校验 + 原子写 + awaited registry refresh/getError
```

`Add model` = 先选 provider，然后从第 5 步接上，同一段代码。Esc 任意时刻零写入。

## 架构考量

- **AI 做判断，包做确定性动作。** 官方模板选择、元数据搬运、字段编辑靠 AI；catalog 查询、oracle 校验、`/models` 发现、原子写靠包。AI 不凭记忆填字段——动词直接输出模板 JSON 供粘贴。
- **不出写动词。** AI 已有 `edit`，再造 apply 动词是重复。代价是失去写路径的原子性保证；单用户配置文件可接受。
- **手动路径只保留 AI 结构上做不到的事。** 冷启动（没有模型就没有 AI）是唯一硬约束；List 归 Pi 自己的 `/model`；批量与删除归 AI。
- **`SecretRef` 随浏览器一起消失。** 已验证它在 `src/web/` 之外零引用。替代品是 SKILL.md 里一条规则：可以读 `models.json`，但输出里永不复现 apiKey 的值。
- **密钥 literal 入库**（owner 决策）。录入走 owner 自己终端跑的 bundled helper，key 从不经过 AI；普通值明文，Pi 元字符按 `$` → `$$`、开头 `!` → `$!` 编码，避免环境展开/命令执行。不强制 `!command` / `$VAR` 引用形态；需要时由 AI 按需改。
- **一次只加一个**，所以不需要多选组件（`ctx.ui` 本来也没有多选）。

## 统一语言

- **按需脚本**：包不向 AI 注册 tool；Skill 通过 bash 执行 bundled script 的 catalog/discover/lint，key 子命令只交给用户终端。
- **官方模板**：active Pi runtime catalog 里的某个 provider 下的 model 配置，作为元数据来源。
- **目标 provider** vs **官方源 provider**：前者是 `models.json` 里被编辑的 key，后者是模板来源；二者常不同，永不互相替代。
- **冷启动**：`models.json` 无可用模型、AI 不可用的状态。

## 当前推进

### Issues

| # | Issue | 状态 |
|---|---|---|
| 1 | `.cs/issues/2026/07/29/closed-vendor-drop-web.md` — 删 Web 与死码 | closed |
| 2 | `.cs/issues/2026/07/29/closed-vendor-tui-linear.md` — TUI 两条直线 | closed |
| 3 | `.cs/issues/2026/07/29/closed-vendor-skill-verbs.md` — skill + 三个只读动词 | closed |
| 4 | `.cs/issues/2026/07/29/closed-vendor-spec-rewrite.md` — spec / superseded / README | closed |

顺序即依赖顺序：先在干净树上删，再重写 TUI，再加 skill 与动词，最后收规格。

### 剩余阻碍

无。npm 发版仍需 owner 另行授权。

## 暂不推进范围

- Web 任何形式的保留或冻结
- TUI 批量添加、TUI 删除操作、TUI List
- 密钥引用形态（`!command` / `$VAR`）——归 AI 按需改
- `auth.json` / OAuth / `/login`
- npm 发版（另行授权）

## 已确认问题

1. 放弃"不用 AI 也能管全部"的产品承诺。
2. 删 Web，不保留不冻结。
3. 不做 TUI List。
4. apiKey 作为 literal 写入 `models.json`；AI 给 bundled helper 命令，key 不经过 AI；Pi 元字符必须编码后落盘。
5. mutation 归 AI 的 `edit`，包内不出写动词。
6. 根菜单两项，Esc 取消。
7. 每次添加只加一个。
8. 零模型状态下 Pi TUI 可跑斜杠命令（owner 确认）。
9. anthropic `/v1` override 规则照搬 owner skill，不需再核。

## 关闭条件与证据

- `src/web/`、SecretRef/mask、Web scripts/assets/CI 步骤已全部移除；pack dry-run 无 Web 产物。
- TUI 两条直线已实现；owner 真机确认 Add model，`opus` fuzzy + 完整候选 + 10 行分页按反馈修正；Esc/commit/refresh 与 provider flow 由 scripted tests 覆盖。
- `skills/pi-vendor/SKILL.md` 与单个 `scripts/vendor.mjs` 已打包；Pi RPC 真实发现 `skill:pi-vendor`，extension 只注册 `/vendor`、不注册 AI tools；script/catalog/discovery/lint/key 有聚焦测试。
- project spec / README 已重写，旧 Web epics/issues 标 superseded，内部 export/Web 命名与 CI 收口。
- package typecheck、20 files / 200 tests、pack dry-run、active Pi 0.82 catalog probe、真实 extension/skill discovery 通过；异构 provider 的 OpenAI/Anthropic/Google route 已分别真机探查。
- 独立 reviewer 经 changes-requested 修复后最终 verdict：blocking=0、important=0。

## 关闭结论

AI-first 转向完成。日常 CRUD 的唯一产品入口是 bundled Skill + AI edit；catalog/discover/lint/key entry 由 Skill 内单脚本按需承担，包不注册常驻 AI tool；另保留零模型冷启动 TUI。Web 产品承诺正式作废但历史证据保留。未执行 npm 发布。

## 合并回 Project Spec 的候选

- pi-vendor 的新身份（skill + on-demand script + 冷启动 TUI）与两条使用路径
- "AI 可读 `models.json` 但输出永不复现 apiKey" 这条安全约束
- 目标 provider vs 官方源 provider 的区分
- 官方模板由 active Pi runtime 提供（沿用既有结论）

## 相关材料

- Talk：`.cs/talks/2026-07-29-vendor-ai-first.md`
- owner 现用 skill：`~/workspace/CFG/.agents/skills/pi-official-model-config/SKILL.md`
- Pi 文档：`docs/models.md`（配置值解析）、`docs/packages.md`（skill 分发）
