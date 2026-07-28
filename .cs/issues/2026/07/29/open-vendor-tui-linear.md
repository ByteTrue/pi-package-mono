---
kind: issue
title: "pi-vendor TUI 重写成两条直线"
type: feature
status: open
created: 2026-07-29
epic: ".cs/epics/2026/07/29/vendor-ai-first/spec.md"
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

- 隶属 epic：`.cs/epics/2026/07/29/vendor-ai-first/spec.md`（切片 2）
- 依赖：切片 1（`.cs/issues/2026/07/29/open-vendor-drop-web.md`）先删完 Web

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
4. API key（输入 → 明文写入 models.json）
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

### custom-select 接输入过滤

`fuzzy.ts` 已写好并测过，接进 `custom-select` 的分页 select：捕获可打印字符累积成 query、用 fuzzy 过滤 items、重置 `selectedIndex` 与分页、Backspace 退格、Esc 先清 query 再取消。≈20 行，顺手让 `fuzzy.ts` 不再是死码。

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

- `npm --workspace @bytetrue/pi-vendor run typecheck`
- `npm --workspace @bytetrue/pi-vendor test`：scripted UI 覆盖两条路径、模板候选 0/1/多、`/models` 失败回退、Esc 零写入
- 真机：对一个真实中转站跑 Add provider 全程，再跑一次 Add model

## 执行记录

- 
