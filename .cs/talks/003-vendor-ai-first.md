---
kind: talk
title: pi-vendor 转向 AI-first
created: 2026-07-29
---

# pi-vendor 转向 AI-first

## 原始想法

owner 用自己的 skill（`~/workspace/CFG/.agents/skills/pi-official-model-config`）维护 Pi 模型配置，体验下来觉得 `@bytetrue/pi-vendor` **过于重**。提出的方向：交互改成 AI-first——手动路径只负责首次使用（第一个 provider + 第一个模型），之后的增删改查交给 AI（以 Skill 形式）。不必极端到"只有第一个能手动"，但手动流程要比现在的 Web 轻得多。同时指出现在命令行的添加流程"有点怪"。

## 真问题

**包的身份错了。** 它现在是"UI 包"，试图用表单覆盖全部 CRUD；而它真正不可替代的能力只有两类：AI 结构上做不到的事（无 AI 冷启动），以及 AI 拿不到的确定性能力（官方 catalog、Pi oracle 校验、`/models` 发现、原子写）。表单本身没有价值。

## 事实（会话中已验证）

代码分布，共 15,096 行（含测试）：

| 部分 | 行数 | 占比 |
|---|---|---|
| Web（client + server + css + 生成产物） | 8,908 | 59% |
| model-source（catalog / enrich / discover） | 2,731 | 18% |
| TUI quick workflows | 1,780 | 12% |
| config core（document / mutation / oracle / commit） | 1,048 | 7% |
| 其他 | ~630 | 4% |

- **`SecretRef` / `mask` 在 `src/web/` 之外零引用。** 这套包里最微妙、review 成本最高的代码，唯一存在理由是"浏览器不能看到明文 key"。浏览器没了它整套跟着消失。
- Web 额外背着 esbuild 构建步骤、提交进仓库的生成产物（`src/web/assets/app.js`、`style.css` 与 client 版重复 745 行）、CSP / bearer token / socket 拆除 / session 生命周期。
- `src/enrich.ts`、`official-catalog.ts`、`openai-models.ts`、`templates.ts`、`custom-select.ts`、`vendor-ui.ts` 六个文件已是 1 行 re-export 空壳。
- **`fuzzy.ts` + `fuzzy.test.ts` 全包零引用**，是死码；而 `custom-select.ts` 没有输入过滤，纯方向键分页。
- `ctx.ui` 只提供 `select / confirm / input / notify`，**没有多选**；`custom-select.ts` 也是单选。
- Pi 文档（`docs/models.md:149-165`）支持 `apiKey` 用 `!command` / `$VAR` 引用——**本次不采用**，见下方决策。
- Pi 包可通过 `skills/` 目录分发 skill（`docs/packages.md:126,163`）。

## 已确认决策

1. **放弃"不用 AI 也能管全部"这个产品承诺。** owner 明确点头。
2. **删掉整个 Web。** 它唯一剩下的独特价值是"改前看 diff 再确认"，而 AI 在对话里本来就这么做——是冗余，不是互补。不保留、不冻结（冻结的 UI 代码仍会随 Pi API 变化而坏，仍要打包和测试）。
3. **不做 List。** Pi 自己的 `/model` 和 `--list-models` 已经能看现有模型，不重复做。
4. **apiKey 明文写入 `models.json`。** owner 推荐。"AI 给一条命令"指的是 **AI 给出一条直接改写 `models.json` 里 apiKey 字段的命令**，key 走 owner 自己的终端，从不经过 AI。不采用 `!command` 引用方案。
5. **mutation 不需要动词。** AI 用自己的 `edit` 写 JSON——这正是 owner 现有 skill 的形状，也是他更喜欢的形状。
6. **TUI 根菜单两项**：Add provider / Add model，Esc 取消。没有 open-web，没有 "What next?" 循环。
7. **每次添加只加一个。** 不管 add provider 还是 add model，一次一个；要加多个就重复几次。批量归 AI。
8. **零模型状态下 Pi TUI 可以跑斜杠命令**——owner 确认，所以冷启动走 TUI 可行。
9. **anthropic `/v1` 规则照搬 owner 的 skill**：model 的 `api` 为 `anthropic-messages` 且 provider 级 `baseUrl` 带 `/v1` 时，model 级 override `baseUrl` 去掉 `/v1`。owner 确认这条是他的要求，不需要再核。

## 目标形态

```text
@bytetrue/pi-vendor
├── skills/pi-vendor/SKILL.md   ← 主路径：增删改查 / 官方模板 / /models 导入 / 密钥命令 / 审查
├── 三个只读动词（AI 调用）
│     catalog search   → 输出官方模板 JSON（AI 粘贴，不默写）
│     validate         → Pi oracle
│     discover /models → bounded-discover
└── TUI /vendor        ← 两条直线，只为一次性单发与冷启动
```

TUI `Add provider` 流程（owner 给定顺序）：

```text
1. Provider key
2. Base URL
3. API 类型（4 选 1 + Custom）
4. API key（输入 → 明文入库）
5. GET {baseUrl}/models          ← 用第 4 步的 key，所以 key 必须在发现之前
   ├─ 成功 → 列出全部上游 id，选一个
   └─ 失败 → 退回手输 model id（命中官方 catalog 就套模板）
6. 解析官方模板：0 候选 → 最小条目 {id}；1 候选 → 自动；多候选 → 一个 select
7. oracle 校验 + 原子写 + registry refresh
```

`Add model` = 先选 provider，然后从第 5 步接上，同一段代码。

Base URL 追加 `/models` 的行为已有：填 `https://x.com/v1` → 请求 `https://x.com/v1/models`。

体量预期：15,096 → ~4,300（约删 71%），删的全是 review 成本最高、最易出微妙错误的部分。

## 取舍与影响

- **已有，只需重接线**：`bounded-discover`（`/models` + 信任预检 / 截止时间 / 体预算）、`official-catalog` + `templates`（模板解析与候选）、`config-core`（oracle + 原子写）、`quick-add-provider` 的问题链。
- **唯一新增组件**：给 `custom-select` 接输入过滤。原本为多选准备的 ~30 行因决策 7 取消；改为把已写好并测过的 `fuzzy.ts` 接进去（≈20 行），顺手让它不再是死码。中转站 `/models` 常返回上百 id，纯方向键分页难用。
- **现在 TUI 为什么怪**：`key → baseUrl → api → apiKey → "你想怎么添加第一个模型？" → 搜索 → "接下来做什么？Save / Add another / Cancel"`——七个阻塞式全屏提问、不能回退、还有个在你知道自己想干什么之前就要选的模式选择器，以及一个把菜单当状态机的循环。收缩成"一次一个 + 只做单发"后自然变成直线。
- **制度代价真实**：作废一个已关闭的 epic（`vendor-web-productization`）、project spec 一大块、约 10 个已关 issue。代码代价小。历史留在 `.cs/archive/`。

## 候选质量目标

- **信息安全性**：apiKey 明文存盘意味着 AI 编辑配置时会把 key 读进上下文。SKILL.md 必须有硬规则——**可以读，但输出里永不复现 apiKey 的值**；key 录入始终走 owner 自己终端跑的命令。这条替代了整套 SecretRef 机制，是本次唯一新增的安全约束。
- **功能正确性**：AI 会写出"合法但错"的值（`contextWindow` 记错、漏掉 anthropic `/v1` 坑），Pi oracle 只挡 schema 错。缓解办法在设计里：catalog 动词直接输出模板 JSON 让 AI 粘贴而非凭记忆填。owner 的 skill 已这么做，是可行性证据。
- **可维护性**：删 71% 代码、去掉构建步骤与生成产物、去掉 SecretRef 协议。

## 已确认边界

**不做**：Web 任何形式的保留或冻结；TUI 批量；TUI 删除操作（归 AI）；TUI List（归 Pi 自己）；密钥引用形态 `!command`/env（归 AI 按需改）；`auth.json` / OAuth。

## 最大未知

`model-list.ts`（33 行）是否已被 `config-mutations.ts` 取代成死码——切片 1 内查，不预先断言。

## 出口

Epic：`.cs/epics/003-x-vendor-ai-first/spec.md`，四个切片 issue。owner 确认后直接开切片 1。
