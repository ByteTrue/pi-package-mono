---
kind: issue
title: "pi-vendor TUI 重写成两条直线"
type: feature
status: closed
created: 2026-07-29
epic: ".cs/epics/003-x-vendor-ai-first/spec.md"
---

# pi-vendor TUI 重写成两条直线

## 目标

`/vendor` 只做两件事，各是一条不分叉的直线，一次只添加一个模型：

- **Add provider**：从零建一个 provider 并加它的第一个模型
- **Add model**：给已有 provider 加一个模型

走完即结束，没有"接下来做什么"循环，没有模式选择器。Esc 任意时刻零写入。

## 范围

- 包含：根菜单收成两项、`Add provider` 六步流程、`Add model` 复用第 5-7 步、模板候选 0/1/多 三分支、`/models` 失败回退、给 `custom-select` 接输入过滤（用现成 `fuzzy.ts`）
- 不包含：批量添加、多选、删除操作、List、密钥引用形态

## 归属

- 隶属 epic：`.cs/epics/003-x-vendor-ai-first/spec.md`（切片 2）
- 依赖：切片 1（`.cs/issues/028-x-vendor-drop-web.md`）先删完 Web

## 背景与证据

现在的流程 owner 评价"有点怪"，具体来源：

```text
key → baseUrl → api → apiKey → "你想怎么添加第一个模型？" → 搜索 → "接下来做什么？Save / Add another / Cancel"
```

- 七个阻塞式全屏提问，不能回退
- 第 5 步是**模式选择器**：在用户知道自己想干什么之前先让他选模式（`quick-add-provider.ts:124-135`、`quick-add-model.ts:94`）
- 末尾把菜单当状态机循环（`quick-add-provider.ts:323-328`、`quick-add-model.ts:73`）

另外两条已验证事实：

- `ctx.ui` 只有 `select / confirm / input / notify`，**没有多选**；`custom-select.ts` 也是单选（`selectedIndex` + Enter）。owner 决定"一次只加一个"后，多选不再需要。
- `fuzzy.ts` + `fuzzy.test.ts` **全包零引用**，是死码；`custom-select.ts` 没有输入过滤，纯方向键分页。中转站 `/models` 常返回上百 id。

## 实现设计

### 这次要怎么做

根菜单：

```text
/vendor → [ Add provider ]
          [ Add model    ]
          Esc = 取消
```

`Add provider`：

```text
1. Provider key
2. Base URL
3. API 类型（openai-completions / openai-responses / anthropic-messages / google-generative-ai / Custom…）
4. API key（输入 → Pi literal encoding 后写入 models.json）
5. GET {baseUrl}/models          ← 用第 4 步的 key；故 key 必须先于发现
   ├─ 成功 → 列出全部上游 id（带输入过滤），选一个
   └─ 失败 → 退回手输 model id
6. 解析官方模板（active Pi runtime catalog）
   ├─ 0 候选 → 写最小条目 {id}，汇总里告知
   ├─ 1 候选 → 自动套用，汇总里说明来源
   └─ 多候选 → 一个 select 让用户选官方源 provider
7. oracle 校验 + 原子写 + registry refresh，打印汇总后结束
```

`Add model` = 先 select 已有 provider，然后从第 5 步接上，与 `Add provider` 共用同一段代码。

第 5 步的 URL 拼接沿用现有行为：`https://x.com/v1` → 请求 `https://x.com/v1/models`。

### 哪些边界不碰

- `bounded-discover` 的安全边界（信任预检、15s 截止时间、2 MiB 体预算、typed errors）原样复用
- `config-core` 的 oracle 校验、revision、原子写 0o600 原样复用
- `official-catalog` / `templates` 的模板解析原样复用
- **目标 provider 与官方源 provider 永不互相替代**：套模板只取非路由元数据，`baseUrl` 用目标 provider 的

### 模板套用规则

照搬 owner skill（`~/workspace/CFG/.agents/skills/pi-official-model-config/SKILL.md`，owner 已确认这条是他的要求，不需再核）：

- 复制官方模板时**不复制 `baseUrl`**，始终用目标 provider 的
- 唯一需要 model 级 `baseUrl` override 的情况：model 的 `api` 为 `anthropic-messages` 且 provider 级 `baseUrl` 带 `/v1` → model 级 override **去掉 `/v1`**
- 其他 `api` 类型不设 model 级 `baseUrl`

### 长列表过滤

原计划把 `fuzzy.ts` 接进 `custom-select` 做实时过滤，**实现时改了方案**，理由见执行记录。改为：上游 id 超过 20 个时先给一个可选的 filter 输入，用 `fuzzyFilter` 缩短候选再走 `ui.select`。同样让 `fuzzy.ts` 不再是死码，且不需要新组件。

### 怎么确认做对

| 行为 | 预期 |
|---|---|
| 根菜单 | 两项 + Esc |
| Add provider 全程成功 | 恰好一次 commit + 一次 registry refresh |
| `/models` 返回 100+ id | 可输入过滤定位；选一个 |
| `/models` 失败（超时 / 非 2xx / 无凭据） | 退回手输 model id，不中断流程 |
| 模板 0 候选 | 写 `{id}` 最小条目，汇总告知 |
| 模板 1 候选 | 自动套用，汇总说明来源 |
| 模板多候选 | 一个 select；不静默乱选 |
| anthropic-messages + provider `baseUrl` 带 `/v1` | model 级 `baseUrl` 去掉 `/v1` |
| 任意步骤 Esc | 零写入 |
| Add model | 先选 provider，其余与 Add provider 第 5-7 步一致 |

## 质量目标

- **功能正确性**：模板候选三分支与 anthropic `/v1` 规则必须有单测覆盖——静默配错 claude 系是最贵的失败。
  - 证据：scripted UI 单测 + 模板套用单测
- **功能适用性**：`/models` 失败必须能继续，不能把用户堵在冷启动。
  - 证据：失败回退路径单测

## 验证

- `npm --workspace @bytetrue/pi-vendor run typecheck` —— 通过
- `npm --workspace @bytetrue/pi-vendor test` —— 20 文件 / 174 测试全过
- 真机第一轮（owner 实跑）—— **报两个真问题，已修**，见下方“真机第一轮反馈”
- 真机第二轮：**待做**

## 执行记录

### 长列表过滤：为什么没接进 custom-select

计划里写的“≈[20] 行”是错的。`custom-select.ts` 的 `handleInput` 已经把 `j` / `k` / `h` / `l` 绑定为 vim 导航键，**输入过滤会与它们直接冲突**（敲 `claude` 里的 `l` 就会翻页）。要接就得重排整个按键处理，远不止 20 行。

改用更懒的做法：超过 20 个上游 id 时先问一个可选 filter，`fuzzyFilter` 筛完再进 `ui.select`。约 12 行，不需新组件，不碰按键绑定，测试用现有 scripted adapter 就能覆盖。代价：多一次可跳过的提问，没有实时增量过滤。

### 改动

- 新增 `src/tui/model-pick.ts`：两条流程共用的“取恰好一个模型”步骤。`acquireOneModel` → `listUpstreamIds`（失败/空/不可信 `!command` 都回退到手输）→ `pickModelId`（>20 先 fuzzy filter）→ `resolveModelConfig`（0/1/多 候选）。
- `quick-add-provider.ts` 重写：删 `acquireFirstModel` 模式选择器、删累积循环与 What next 菜单；保留 key/baseUrl/api/apiKey 四个带校验的步骤。337 → 130 行。
- `quick-add-model.ts` 重写：删模式选择器与 What next 循环，保留 id 冲突确认。302 → 65 行。
- `quick-root.ts`：两项（Add provider / Add model），去掉 `cancel` 选项与 RootAction 成员，Esc 返回 null 即取消。**Add provider 放第一且为默认**：冷启动是唯一必须不依赖 AI 的路径。
- `command.ts`：删 `for(;;)` 循环，任何 Esc 即取消；两个分支重复的 commit+refresh 块合并为 `saveAndRefresh()`。225 → 115 行。
- 模板套用改用现成的 `stripOfficialRoutingFields()`（去掉 `provider`/`baseUrl`/`headers`/`apiKey`/`authHeader`），取代旧的手写 `buildModelFromChoice`。旧实现经 DTO 中转并**丢掉了 `cost`**，现在不会。

### 顺手修的真 bug

`createProductionQuickUI.input()` 把整个 options 对象当作 Pi `input(title, placeholder?, opts?)` 的 **placeholder** 传了进去，界面上会渲染成 `[object Object]`。本切片新增了两处 placeholder 使用，会把它放大，故一并修掉，并补上 `quick-adapter.test.ts` 盖住 adapter 映射。

### 与验收表的一处偏差

验收表写“模板 0 候选 → 写 `{id}` 最小条目”。实际行为是现有 `createDefaultModelConfig()` 填安全默认值（`name`、`reasoning: false`、`input: ["text"]`、`contextWindow: 128000`、`maxTokens: 16384`），**并同时 warning 告知用户用的是默认值**。

没有改这个既有行为，理由：它会明确告警，不是静默编造；而且省掉 `contextWindow` 后 Pi 侧行为未验证，贸然改可能让模型不可用。验收表口径更正为“套用带 warning 的安全默认值”。若 owner 认为 128000 这个猜测仍不可接受，单独开 issue 处理。

### 体量

`src/` 5,840 → **5,180 行**（含删自建 select 组件的 352 行）。TUI 活代码约 495 行：model-pick 175 / add-provider 130 / add-model 65 / root 45 / adapter 80。测试 19 文件 / 166 例全过。

### 自建 select 组件已删（owner 授权）

`src/tui/custom-select.ts`（231）+ `custom-select.test.ts`（49）+ `src/tui/vendor-ui.ts`（72）**全包零内部引用**，只从 `index.ts` 往外导出。既然长列表过滤没走这条路，它们就没有消费者了。共删 352 行，`index.ts` 对应导出一并移除。

**导航后果**：owner 明确“直接用方向键就行，不需要 hjkl”。删掉自建组件后，包内唯一 select 就是 Pi 原生 `ctx.ui.select`（`ExtensionSelectorComponent`）——本来就只认方向键、不支持 hjkl，所以这一条零代价满足。hjkl 随组件一起消失。

### 真机第一轮反馈（owner）

owner 实跑时输入 `opus`，得到：

```text
Warning: No official catalog or template match for opus; using safe defaults.
Error: Failed to save: Models validator is unavailable
```

**问题 A：手输 model id 没有模糊搜索——本切片引入的回归。**

旧 `quick-add-provider.ts` 的 catalog 模式用 `searchOfficialModels()` 做模糊搜索。我删模式选择器时**把搜索一起删了**，`promptModelId` 直接把文本交给 `enrichModelId()`，而它是精确 key 查找（`providerModels?.[modelId]`），`opus` 当然不命中。

修法：手输文本先过 `searchOfficialModels(text, 100)`，取去重后的 model id 给用户选，并保留一个“把 `<text>` 当自定义 id 用”的逃生口（补回旧 custom 模式的能力）。选完才进 `resolveModelConfig` 做官方源消歧——两步消歧，与 owner skill 一致。

实测又挑出一个**排序问题**：`opus` 在 active Pi 0.82.1 catalog 里共 64 对 / 48 个 distinct id，而 catalog 按 provider 迭代，若只取前 25 条会被 `amazon-bedrock` 的区域变体占满，**真正想要的 `claude-opus-4-5` 根本到不了列表里**。最终行为：搜索到 API 允许的 100 条上限、model id 去重、用现成的 `fuzzyFilter` 重排（位置惩罚 + 词边界奖励），所有结果保留；选择器每页最多显示 10 个，↑/↓ 单项移动、←/→ 整页翻动、Enter 选择。owner 先否决“只显示前 25 条”的漏项风险，随后明确每页 10 个并支持左右翻页；两项均已落实。

**问题 B：`validator_unavailable`——Pi 0.82 打破了 oracle API，与本切片无关，已发布的 0.2.2 同样中招。**

实测对比：

| | Pi 0.79.10（workspace） | Pi 0.82.1（active） |
|---|---|---|
| `AuthStorage` | function | **undefined（不再导出）** |
| `ModelRegistry.create` | static，同步 | **不存在**（构造函数改收 `ModelRuntime`） |
| `ModelRuntime` | 不存在 | class，`static create()` 是 async |
| `refresh()` | `void` | **`Promise<void>`** |

所以 `defaultOracle` 里的 `ModelRegistry.create(AuthStorage.inMemory(), temp).getError()` 在 owner 实际跑的 Pi 上必抛 TypeError → `validator_unavailable`。**两个版本没有任何共同的 JS API**，peer 范围 `>=0.79.10` 已经是假的。

修法（一个 oracle，就是正在跑的 Pi）：

1. `config-core.ts` 删掉 `AuthStorage` / `ModelRegistry` 静态 import 与 `defaultOracle`。这一步同时消掉一个更大的隔：针对不存在的导出做静态具名 import 是 **link error**，会让整个 extension 加载失败，而不只是存不了。
2. `oracle` 降为 `ConfigCoreDependencies` 的**可选**注入项（测试仍可注入假 oracle 验证那条路）；生产不传，写前只保留纯 JS 的 `validateModelsJson`（root/providers 形状 + 重复 model id）。错误优先级（invalid_config 先于 config_changed）不变。
3. `command.ts` 改成 `await ctx.modelRegistry.refresh()` 再 `getError()`。这是**权威判定**：它就是正在跑的 Pi，不需版本探测、不需临时文件；`await` 对 0.79 的 `void` 无害，对 0.82 的 Promise 才正确（之前不 await 导致 `getError()` 读到刷新前的状态）。

**代价（需 owner 知晓）**：Pi 不兼容的配置会先落盘再被报告，不再写前拦。可接受的理由：Pi 对坏的 models.json 本身宽容（只警告，仍能跑，已实测）；AI 直接改文件的主路径本来就没有写前校验；用户立即收到 Pi 原文错误。备选方案是子进程 `pi --list-models --offline`（实测 0.33s，跳版本，但要解析人读文本且会 fail-open）——owner 可推翻。

新增 `config-core.smoke.test.ts` 盯住这个回归：生产路径 commit 能写成，且结构非法仍拒写。

### 未收口：测试与运行时 Pi 版本不一致

workspace `node_modules` 是 0.79.10，而 owner 跑的是 0.82.1。typecheck 对的是与运行时不符的类型——这次就是因此没在本地暴露。建议将 devDependency 对齐实际跑的 Pi，并重审 peer 范围（归切片 4 或单开 issue）。

### 未收口：index.ts 导出面

`index.ts` 仍往外导出约 60 个符号，而这是个 extension 包，Pi 只用 default export。本切片只删了指向已删文件的导出，并补上了新 TUI 符号。整体收缩留给切片 3/4：先看三个只读动词需要导出什么，再一次定公开面。

## 最终验证与关闭

- owner 真机确认 **Add model 没问题**；`opus` 模糊搜索、完整结果集、10 行一页与左右翻页均按后续反馈落地。
- Add provider 的 credential 保存补上 Pi literal encoding：`$` → `$$`、开头 `!` → `$!`；discovery 会解码为原始 key，避免环境展开/命令执行。
- `ctx.modelRegistry.refresh()` 已 awaited，兼容 Pi 0.79 同步返回与 0.82 Promise 返回；生产不再静态 import 已删除的 Pi symbols。
- `custom-select`/hjkl 已删除；超过 10 个候选用 Pi `SelectList` + 左右分页，不截断结果。
- 切片 2 提交：`eda38a0`；最终套件由后续切片扩展到 21 files / 191 tests。
