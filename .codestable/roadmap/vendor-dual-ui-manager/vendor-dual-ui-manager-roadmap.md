---
doc_type: roadmap
slug: vendor-dual-ui-manager
status: active
created: 2026-07-12
last_reviewed: 2026-07-12
tags: [pi-vendor, tui, web-ui, models-json, ux]
related_requirements: []
related_architecture: []
---

# pi-vendor 双界面管理器

## 1. 背景

`@bytetrue/pi-vendor` 当前把 provider 选择、字段编辑、模型管理和保存组织成多层 TUI 菜单。新增供应商和给已有供应商添加模型都要穿过低频字段与多次返回操作；菜单还始终展示未配置的可选字段。既有拆分已经把 `command.ts` 分成 provider/model/UI 模块，但没有改变交互模型，且 TUI 状态机仍缺自动化覆盖。

本 epic 将产品重构为两层体验：`/vendor` 提供任务导向的高频快捷流；完整管理能力放入一次性本地 Web modal。两套 UI 共用同一套配置、模型发现与 enrichment 语义，避免各自实现一套规则。

输入材料：`.codestable/brainstorms/vendor-dual-ui-manager/brainstorm.md`。

### 目标完成信号

1. `/vendor` 首屏直接提供快速添加模型、快速添加供应商和打开 Web 管理器，不再先进入完整 provider 字段表单。
2. `/vendor web` 能打开一次性浏览器 modal；Save/Cancel/TUI Esc/session shutdown 都能终止会话并关闭 server。
3. Web 管理器能完成 provider 与 model 的新增、编辑、重命名和删除，并支持官方 catalog 匹配与 OpenAI-compatible `/models` 导入。
4. 常用字段始终可编辑；可选字段只在已配置时显示，并可通过 `Add setting…` 添加；Raw JSON 能覆盖表单未表达的合法配置。
5. 保存使用配置 revision 做陈旧快照检测；冲突时返回 `409 config_changed`，不得静默覆盖。已有 known literal API key / provider-model-modelOverride headers 通过 opaque keep-value 不进入浏览器；成功写入保持原子替换与 `0o600`。
6. 未修改的未知顶层、provider 和 model 字段能无损 round-trip；原本缺失的字段不会仅因打开编辑器而被补写。
7. 保存后当前 Pi 进程调用 `modelRegistry.refresh()` 并确认 `getError()` 为空，不要求用户再打开 `/model`。
8. workspace CI 的 typecheck/test 全绿，发布 tarball 包含静态 Web 资产；TUI 与浏览器关键路径各有自动化或明确人工证据。

## 2. 范围与明确不做

### 本 roadmap 覆盖

- 可被 TUI 与 Web 共用的 `models.json` 快照、校验、revision、提交、provider/model 操作、官方 catalog 与上游模型发现能力。
- 只监听 loopback 的一次性 Node HTTP server、浏览器启动、Save/Cancel/Esc/session shutdown 生命周期。
- 构建后随 npm 包发布的纯静态 Web 管理页面。
- Web 中完整的 provider/model 管理、变更预览与 Raw JSON 逃生口。
- `/vendor` 任务导向快捷菜单和 `/vendor web` 直接入口。
- 数据安全、错误态、空态、键盘可用性、响应式布局、回归测试、README 与打包收口。

### 明确不做

- 不给 Pi TUI 自行实现终端鼠标协议或坐标命中测试；当前 Pi 没有一等鼠标组件 API。
- 不做常驻 daemon、固定本地端口、数据库、WebSocket、多用户协作或自动保存。
- 不监听 `0.0.0.0`，不提供远程管理面板；SSH 用户可自行转发 loopback 端口。
- 不管理 `auth.json`、`/login` OAuth、扩展 `streamSimple` 实现或 Pi 包安装配置；本 epic 只管理 `models.json` 可表达的 provider/model 数据。
- 不新增 OpenAI-compatible `/models` 之外的供应商发现协议。
- 不把完整 Pi schema 动态反射成通用表单引擎；未知或未来字段通过无损 round-trip 与 Raw JSON 承接。
- 不拆成新的 npm 包；能力继续归属 `@bytetrue/pi-vendor`。

### Granularity Gate

| 判断项 | 结论 |
|---|---|
| 为什么不是 single feature | 同时涉及共享配置事务、模型发现、一次性 HTTP runtime、静态 Web 应用、TUI 重构和发布/QA，存在明确依赖 DAG 与跨模块协议。 |
| 为什么不是 brainstorm | 双界面职责、一次性 browser modal、静态前端和字段显隐策略已经由 owner 确认；剩余工作是接口与交付拆解。 |
| roadmap 边界 | 只重构 `pi-vendor` 的 `models.json` 管理体验；不扩展到认证、常驻服务、远程管理或 Pi 核心 TUI。 |
| 最小闭环 | `vendor-web-modal-runtime` 完成后，用户可从 `/vendor web` 打开静态页面，修改已有 provider 的 `baseUrl`，并安全 Save/Cancel 后返回 Pi；Raw JSON 与完整 provider workflow 留给后续 item。 |

### 方案深度 pre-pass

- 这是长期维护且会写用户配置的核心路径，配置校验、冲突检测、原子写入、token 与生命周期必须做实，不能用仅供 demo 的占位实现。
- 第一条用户可见闭环刻意限制为“已有 provider 的 Web 编辑与保存”，是最窄端到端路径；provider/model 完整工作流后续扩展同一页面，不另起临时 UI。
- HTTP、浏览器进程和上游 `/models` 是可替换外部边界，测试允许注入临时路径、fake opener 和 fake fetch；配置合并、revision 与 enrichment 核心逻辑不得由 fake 代替。
- 不引入运行时 Web 框架或通用 schema-form 引擎；只有当 feature design 证明原生静态实现会制造更高维护成本时，才允许增加构建期 UI 依赖，发布产物仍必须是静态资产。

## 3. 模块拆分（概设）

```text
pi-vendor dual UI
├── Config core：配置快照/校验/提交、字段描述和 provider/model 纯变更
├── Model source core：官方 catalog、enrichment 和受限的上游模型发现
├── Web modal runtime：loopback HTTP、鉴权、浏览器和一次性会话生命周期
├── Static web app：完整 provider/model draft 编辑与 Save/Cancel
└── TUI quick flows：高频任务入口与 Web modal 启动适配
```

### 3.1 Config core

- **职责**：集中处理 `models.json` 的读取、Pi 兼容性校验、未知字段保留、revision、条件提交、字段描述及 provider/model 纯变更；不持有 UI 状态，不访问上游网络。
- **承载的子 feature**：`vendor-config-core`、`vendor-web-provider-workflows`。
- **触碰的现有代码 / 模块**：`models-json.ts`、`model-list.ts` 及其测试；当前 Pi `ModelRegistry` / `AuthStorage` 公共 API。
- **Depth 判断**：deep。调用方只处理快照、领域变更结果和显式错误；文件格式、字段缺失语义、Pi compatibility oracle、原子写入与冲突语义集中在内部。

### 3.2 Model source core

- **职责**：集中处理 official catalog 查询、安全 enrichment DTO、配置值解析和 OpenAI-compatible `/models` 发现预算；不写配置文件，不决定 UI 选择。
- **承载的子 feature**：`vendor-model-source-core`、`vendor-web-model-workflows`、`vendor-tui-quick-workflows`。
- **触碰的现有代码 / 模块**：`official-catalog.ts`、`enrich.ts`、`openai-models.ts` 及其测试。
- **Depth 判断**：deep。Pi catalog 布局、credential/header 解析、redirect/timeout/body budget 和敏感字段投影隐藏在窄结果类型之后。

### 3.3 Web modal runtime

- **职责**：为单次管理会话提供受 token 保护的本地 HTTP API、静态资产、浏览器启动、结果 Promise 与清理；不实现 provider/model 表单规则。
- **承载的子 feature**：`vendor-web-modal-runtime`、`vendor-model-source-core`、`vendor-dual-ui-hardening`。
- **触碰的现有代码 / 模块**：新增 runtime/server/browser 模块，`command.ts` 与 package 发布清单。
- **Depth 判断**：deep。`command.ts` 只需启动会话并等待结果，不感知端口重试、HTTP 路由、鉴权和资源清理细节。

### 3.4 Static web app

- **职责**：持有本次 modal 的浏览器内 draft，呈现 provider/model 管理、字段显隐、Raw JSON、搜索、确认和变更预览；不直接访问文件系统、环境变量、命令输出或上游凭证。
- **承载的子 feature**：`vendor-web-modal-runtime`、`vendor-web-provider-workflows`、`vendor-web-model-workflows`、`vendor-dual-ui-hardening`。
- **触碰的现有代码 / 模块**：新增静态 Web 源码与发布资产；构建时复用 Config core 的环境无关纯变更函数。
- **Depth 判断**：deep。页面通过少量文档级 API 完成整次事务，不把每个输入事件映射成后端 CRUD 请求。

### 3.5 TUI quick flows

- **职责**：提供快速添加模型、快速添加供应商、打开完整 Web 管理器和取消；复用 Config core 与 Model source core，不再承载完整 provider 设置编辑器。
- **承载的子 feature**：`vendor-tui-quick-workflows`、`vendor-dual-ui-hardening`。
- **触碰的现有代码 / 模块**：`command.ts`、`provider-menu.ts`、`models-menu.ts`、`vendor-ui.ts`、`custom-select.ts`。
- **Depth 判断**：保留轻薄 adapter。TUI 只负责编排交互；配置变更、校验与模型来源语义必须留在共享 core，避免形成第二个业务实现。

## 4. 模块间接口契约 / 共享协议（架构层详设）

### 4.1 配置快照、Pi 兼容性校验与条件提交

**方向**：TUI / Web modal runtime → Config core
**形式**：进程内函数调用

**契约**：

```ts
type ConfigRevision = "missing" | `sha256:${string}`;

type ModelsSnapshot = {
  models: ModelsJson;
  revision: ConfigRevision;
};

type ConfigIssue = {
  path: string;
  code: "invalid_structure" | "duplicate_model_id" |
        "pi_incompatible" | "validator_unavailable";
  message: string;
};

readModelsSnapshot(path?: string): ModelsSnapshot;
validateModelsJson(models: unknown): ConfigIssue[];
commitModelsSnapshot(
  input: { models: ModelsJson; expectedRevision: ConfigRevision },
  path?: string,
): ModelsSnapshot;
```

验证真相源固定为**当前运行 Pi 的公共 API**：Config core 把 candidate 写入权限为 `0o600` 的临时文件，使用 `ModelRegistry.create(AuthStorage.inMemory(), tempPath).getError()` 做 compatibility oracle，然后清理临时文件。不得复制 Pi 私有 TypeBox schema。package 的 Pi peer 下限随本 epic 提升到 `>=0.79.10`；若公共 oracle 不可构造，返回 `validator_unavailable` 并拒绝写入。

本包只在 oracle 前增加两类本地规则：根值必须是对象且包含 `providers` 对象；同一 provider 的 `models` 不得有重复的精确 `id`。Pi oracle 的字符串错误统一映射为 `path: "$"`、`code: "pi_incompatible"` 的稳定 issue，不承诺解析 Pi 私有错误文本为字段级 path。

当前 Pi `0.79.10` 的 characterization 结果是：未知顶层、provider、model 字段均被 oracle 接受，只有缺失根 `providers` 被拒绝。`vendor-config-core` 必须把三个未知字段层级各写一条 oracle test，防止未来 Pi 版本变化后被静默 strip；若未来运行 Pi 拒绝某个未知字段，保存应返回 `pi_incompatible`，仍不得删除该字段后重试。

错误必须可区分：

- `invalid_config`：本地规则或 Pi compatibility oracle 不通过，携带 `ConfigIssue[]`。
- `config_changed`：当前原始文件字节 revision 与 `expectedRevision` 不同。
- `read_failed` / `write_failed`：文件系统错误，消息不得包含配置内容。

**约束**：

- revision 对读取到的原始 UTF-8 字节计算 SHA-256；文件不存在使用 `missing`，不对格式化后的对象计算。
- commit 先运行完整校验，再在写入前重新读取 revision；任一步失败都不写文件。
- 乐观检查无法阻止外部编辑器在“检查后、rename 前”的极短竞态，但原子 rename 保证文件不会半写；文档不得宣称它是严格跨进程锁。
- 写入继续使用同目录临时文件、原子 rename 和 `0o600`。
- 读取和 draft clone 不得自动补齐原本不存在的 `models`、`name`、`authHeader`、`compat` 等字段。只有用户动作可以新增字段。
- 未知顶层/provider/model 字段必须原样保留；合法性最终由当前 Pi oracle 判断。
- 缺失文件由 `readModelsSnapshot` 表示为 `{ providers: {} }` + `missing`；Raw JSON 的 `{}` 不等同缺失文件，会因缺 `providers` 被拒绝。
- `sha256:` 后固定为 64 个 lowercase hex；该值只能由 core 生成。HTTP 把 revision 当 opaque token，浏览器不得构造或正规化。

**共享字段描述**：

```ts
type FieldDescriptor<K extends string> = {
  key: K;
  label: string;
  kind: "text" | "secret-text" | "boolean" | "json";
  common: boolean;
  required: boolean;
};

listProviderFields(): readonly FieldDescriptor<
  "name" | "baseUrl" | "api" | "apiKey" | "headers" |
  "authHeader" | "compat" | "modelOverrides"
>[];

listModelFields(): readonly FieldDescriptor<
  "id" | "name" | "api" | "baseUrl" | "reasoning" |
  "thinkingLevelMap" | "input" | "cost" | "contextWindow" |
  "maxTokens" | "headers" | "compat"
>[];
```

provider 的 common 字段固定为 `baseUrl/api/apiKey`；model 的 common/required 字段固定为 `id`。其他已知字段仅在对象已有该 key 时显示，或通过 `Add setting…` 添加。字段描述同时供 TUI 和 Web 构建使用。

**Interface 设计检查**：

- **Module / interface**：Config core 暴露小函数；调用方只知道 snapshot、issues、revision 和显式错误。
- **Seam placement**：所有 TUI/Web 写入都穿过 `commitModelsSnapshot`；Pi oracle 位于写入之前。
- **Depth / locality**：revision、compatibility、权限与原子写入变化集中在 Config core。
- **Dependency strategy**：文件系统为 local-substitutable，测试传入临时路径；Pi validator 是当前进程已安装的真实依赖。
- **Adapter**：`path` 已提供最小文件测试 seam；不创建 pass-through repository class。

### 4.2 Provider / model 纯变更与冲突语义

**方向**：TUI / Static web app → Config core
**形式**：可在 Node 与静态前端构建中复用的环境无关纯函数

```ts
type ConflictPolicy = "reject" | "overwrite-confirmed";

type MutationErrorCode =
  | "invalid_provider_key" | "invalid_model_id"
  | "provider_not_found" | "model_not_found"
  | "provider_exists" | "model_exists";

type MutationError = {
  code: MutationErrorCode;
  path: string;
  message: string;
};

type MutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MutationError };

createProvider(models: ModelsJson, key: string, config: ProviderConfig): MutationResult<ModelsJson>;
renameProvider(
  models: ModelsJson,
  fromKey: string,
  toKey: string,
  options?: { conflict?: ConflictPolicy },
): MutationResult<ModelsJson>;
deleteProvider(models: ModelsJson, key: string): MutationResult<ModelsJson>;

addModel(models: ModelsJson, providerKey: string, model: ProviderModelConfig): MutationResult<ModelsJson>;
replaceModel(
  models: ModelsJson,
  providerKey: string,
  previousId: string,
  model: ProviderModelConfig,
  options?: { conflict?: ConflictPolicy },
): MutationResult<ModelsJson>;
deleteModel(models: ModelsJson, providerKey: string, modelId: string): MutationResult<ModelsJson>;
```

**约束**：

- UI 输入的 provider key 与 model id 先 `.trim()`；trim 后为空分别报 `invalid_provider_key` / `invalid_model_id`。身份匹配大小写敏感，不做 case folding。
- create/add 在目标已存在时一律拒绝；不得隐式 upsert。
- rename/replace 默认 `reject`。只有 UI 已显示破坏性确认并显式传入 `overwrite-confirmed` 时，才允许覆盖目标。
- rename 覆盖后旧 key 不保留；replace 覆盖后数组中只保留一个新 id，其他 model 相对顺序保持，replacement 占原 source 的位置。
- delete/replace 找不到源对象时返回 `*_not_found`，不得静默成功。
- Raw JSON 不调用这些动作函数，但 4.1 的 duplicate-id 校验保证它不能绕过 model identity invariant。
- 确认对话属于 UI adapter；“是否允许覆盖”由 core 的显式 policy 表达，不能只藏在某个 TUI 分支。
- 纯函数实现只维护一份，TUI 直接 import，Web 构建把同一模块打入静态资产；不得在浏览器另写一套冲突规则。
- contract tests 必须覆盖 provider rename、model replace、目标已存在、源不存在、trim 后为空、`overwrite-confirmed` 以及覆盖后顺序保持。
- 旧 `upsertProvider` / `upsertModel` 不再作为 UI 入口；迁移后删除或仅作为已验证 mutation 内部实现，调用方不得直接绕过 `MutationResult`。

**Interface 设计检查**：

- **Module / interface**：六个动作覆盖 v1 provider/model identity 变化，错误码足以驱动两套 UI。
- **Seam placement**：seam 位于 UI intent 与 document mutation 之间；whole-document HTTP 不因此膨胀成 CRUD API。
- **Depth / locality**：碰撞、trim、覆盖和顺序语义集中在纯函数。
- **Dependency strategy**：in-process、无 IO；Node 与 browser build 共用源码。
- **Adapter**：无 adapter；这是跨两个 UI 的真实共享计算模块。

### 4.3 Model source、安全 DTO 与上游发现预算

**方向**：TUI / Static web app（经 HTTP）→ Model source core
**形式**：进程内函数；Web 通过 4.4 的 model-source routes 间接调用

```ts
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

type WebChatTemplateKwarg =
  | string | number | boolean | null
  | { $var: "thinking.enabled" | "thinking.effort"; omitWhenOff?: boolean };

type WebCostTier = {
  inputTokensAbove: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

type WebCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tiers?: WebCostTier[];
};

type WebCompat = {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?: "openai" | "openrouter" | "together" | "deepseek" |
    "zai" | "qwen" | "chat-template" | "qwen-chat-template" |
    "string-thinking" | "ant-ling";
  chatTemplateKwargs?: Record<string, WebChatTemplateKwarg>;
  cacheControlFormat?: "anthropic";
  supportsStrictMode?: boolean;
  supportsLongCacheRetention?: boolean;
  sendSessionIdHeader?: boolean;
  supportsEagerToolInputStreaming?: boolean;
  sendSessionAffinityHeaders?: boolean;
  supportsCacheControlOnTools?: boolean;
  forceAdaptiveThinking?: boolean;
  zaiToolStream?: boolean;
  supportsTemperature?: boolean;
  allowEmptySignature?: boolean;
};

type WebModelConfig = {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
  input?: Array<"text" | "image">;
  cost?: WebCost;
  contextWindow?: number;
  maxTokens?: number;
  compat?: WebCompat;
};

type OfficialModelChoice = {
  provider: string;
  modelId: string;
  model: WebModelConfig;
};

type WebModelEnrichmentResult =
  | { kind: "ready"; source: "official" | "template" | "default";
      model: WebModelConfig; warning?: string }
  | { kind: "official-candidates"; modelId: string;
      candidates: OfficialModelChoice[] };

type BoundedFetchResponse = {
  ok: boolean;
  status: number;
  // upstream statusText is deliberately unavailable to error mapping
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
};

type BoundedFetch = (
  input: string,
  init: { method: "GET"; headers: Record<string, string>;
          redirect: "error"; signal: AbortSignal },
) => Promise<BoundedFetchResponse>;

searchOfficialModels(query: string, limit?: number): Promise<OfficialModelChoice[]>;
enrichModelForWeb(modelId: string): Promise<WebModelEnrichmentResult>;
discoverModelIds(
  provider: ProviderConfig,
  options: { initialProvider?: ProviderConfig; signal?: AbortSignal;
             fetchImpl?: BoundedFetch },
): Promise<string[]>;
```

**安全投影**：HTTP adapter 的 `toWebModelConfig()` 必须逐字段构造封闭 DTO，禁止 spread/cast/unknown copy。`cost.tiers` 和 compat 的当前安全行为字段也逐层重建；characterization fixtures 覆盖 `tiers/zaiToolStream/supportsTemperature/allowEmptySignature`。`openRouterRouting`、`vercelGatewayRouting`、`baseUrl`、`headers`、`apiKey`、`authHeader` 和其他 unknown 字段不进入 DTO。序列化 tests 递归扫描 forbidden key。TUI 可用完整 candidate，但写入前仍移除 routing fields。

**上游发现固定边界**：

- 只接受 `http:` / `https:` base URL，最终请求为 OpenAI-compatible `/models`。
- `discoverModelIds` 进入 credential resolution 即建立唯一 overall deadline `15_000 ms` 并组合 caller signal；command 上限 `min(10s, remaining)`、stdout `64 KiB`。Decoded body `2 MiB`，逐 chunk 计数/cancel/decode/parse，不用 `response.json()`。
- `redirect: "error"`，不自动跟随 3xx，避免 credential 跨 origin 转发。
- 先解析 provider `headers`；若没有大小写不敏感的 `Authorization` header，则解析 `apiKey` 并发送 `Authorization: Bearer <key>`。`authHeader: true` 明确要求可解析 key；`authHeader: false` 不禁用 OpenAI `/models` 的标准 Bearer 行为。已有 Authorization header 优先且不重复添加。
- command-bearing surface 固定为 `apiKey` 与每个 exact header name。先收集并按 structured path/raw equality preflight **全部** raw `!command`；任一 provider/path/value 不可信则 runner/fetch 调用0。全部通过后才uncached执行；raw value不trim，Pi template/env/escape语义与current characterization一致。
- 优先级 caller abort > overall deadline > command-local failure > fetch/read/parse。Typed local error code固定 `invalid_request/catalog_unavailable/credential_unresolved/upstream_timeout/upstream_too_large/upstream_failed/aborted`；message只用本地常量，可选safe status，不含URL/statusText/secret/output/body。Request断连取消privileged work但不settle session。
- `/models` id trim后 non-empty/UTF-8≤1024；invalid/oversize忽略；保留 first-seen 前10,000 unique，随后用明确 code-unit comparator排序。

**Interface 设计检查**：

- **Module / interface**：浏览器只接收 allowlist DTO；现有 enrichment union 不直接跨 HTTP。
- **Seam placement**：catalog 路径、credential 解析和 fetch 藏在 Model source core；初始 snapshot 信任判断由 server 提供，不能由浏览器自报。
- **Depth / locality**：Pi catalog 布局、认证组合、预算和敏感字段变化集中在 core。
- **Dependency strategy**：catalog 为 local-substitutable；上游 endpoint 为 true external。
- **Adapter**：production 使用原生 fetch + `ReadableStream` bounded reader；测试 fake 必须实现 `body` chunk/取消行为。旧的仅暴露 `json()` 的 `FetchLike` 不属于新契约。

### 4.4 一次性 Web HTTP 协议

**方向**：Static web app → Web modal runtime
**形式**：同源 loopback HTTP JSON

启动 URL 使用 `http://127.0.0.1:{randomPort}/#token={randomToken}`。fragment 不发送给 server；前端读取 token 后存入当前 tab 的 `sessionStorage`、从地址栏移除，并在 API 请求中发送 `Authorization: Bearer {token}`。

```ts
type SecretRef = `pi-vendor-secret:${string}`; // suffix: 128-bit random base64url

type SecretSlot = {
  ref: SecretRef;
  path: string; // RFC 6901 JSON Pointer
};

type WebModelsDraft = ModelsJson; // known literal secrets replaced by SecretRef strings

type ApiError = {
  error: {
    code: "unauthorized" | "invalid_request" | "invalid_secret_ref" |
          "invalid_config" | "validator_unavailable" | "config_changed" |
          "credential_unresolved" | "upstream_timeout" |
          "upstream_too_large" | "upstream_failed" | "catalog_unavailable" |
          "read_failed" | "write_failed";
    message: string;
    issues?: ConfigIssue[];
  };
};
```

**最小 runtime routes（`vendor-web-modal-runtime` 必须完成）**：

```text
GET /api/state
200 { models: WebModelsDraft, revision: ConfigRevision,
      secretSlots: SecretSlot[],
      providerFields: FieldDescriptor[], modelFields: FieldDescriptor[] }

PUT /api/config
Request  { models: WebModelsDraft, expectedRevision: ConfigRevision }
200 { revision: ConfigRevision }
400 invalid_secret_ref | invalid_config |
409 config_changed | 500 write_failed

POST /api/cancel
204；响应完成后 resolve cancelled 并停止接受新操作
```

**Opaque keep-value 协议（owner 2026-07-12 选择 Option B）**：

- server 从初始 snapshot 构造 draft：Pi known secret-bearing paths（provider `apiKey`、provider `headers.*`、`models[i].headers.*`、`modelOverrides.<id>.headers.*`）中被 config-value 语义判定为 literal 的原值，替换为每 slot 独立的 128-bit 随机 `SecretRef`；env interpolation / `!command` 原始引用可见，但解析结果不可见。
- browser 只收到 `{ref, path}` 与顶层 `revision`；每个 slot 的 `baseRevision` 仅在 server session map。原值只留在 `ref -> {path, originalValue, baseRevision}`；path 使用 RFC 6901，对 provider/modelOverride/header keys 与 model array index 正确编码。
- structured input 遇到 SecretRef 显示“configured (unchanged)”而不是 ref；Raw JSON 显示 opaque ref，不提供 Reveal existing secret。
- `PUT` hydration 仅在 ref 位于其原始 exact path 且 `expectedRevision` 等于 slot 的 base revision 时恢复原值。ref 被移动、复制到第二处、伪造、来自其他 session/revision，或保留在未知 path，均返回 `invalid_secret_ref` 且不写文件。
- 原 path 被删除表示移除 secret；用户输入非 ref 新字符串表示替换。新 literal secret 会短暂存在于当前 tab，这是主动编辑所必需的暴露。
- hydration 后必须扫描确认没有任何当前 prefix 的 ref 残留，再执行 §4.1 validator/revision/commit。Save/Cancel/session shutdown 都清空 slot map。
- 未知自定义字段仍原样进入 browser draft；本协议只保护 Pi 已知 secret-bearing path。Pi schema 新增 secret-bearing path 时，field descriptors、masker 与 characterization tests 必须同一 feature 更新。

**Model source routes（由 `vendor-model-source-core` 增量加入）**：

```text
GET /api/catalog?q={query}&limit={n}
200 { entries: OfficialModelChoice[] }
400 invalid_request | 500 catalog_unavailable

POST /api/enrich
Request  { modelId: string }
200 WebModelEnrichmentResult

POST /api/discover
Request  { providerKey: string, provider: ProviderConfig }
200 { ids: string[] }
400 credential_unresolved | 408 upstream_timeout |
413 upstream_too_large | 502 upstream_failed
```

server 按 `providerKey` 从 initial snapshot 取得 raw `initialProvider`；并用 session SecretRef map 对 browser provider draft 做 exact-path、non-consuming credential hydration后再调用 Model source。Browser不能声明trusted；invalid ref时runner/fetch为0。

**通用约束**：

- 仅监听 `127.0.0.1` 且端口为 `0`；不设置 CORS 响应头，拒绝不匹配本 server origin 的 `Origin` 与异常 `Host`。
- 除静态 HTML/favicon 外，所有 API 都要求至少 128-bit 随机 token；只接受声明的方法，写请求只接受 `application/json`。
- 入站请求体上限 `2 MiB`；catalog query 最长 512 UTF-8 bytes，limit 缺省为 50、合法范围 1–100。HTTP route 按 UTF-8 bytes 计数并拒绝超限/非整数输入；core 也断言 bounded limit，不静默截断非法调用。
- 静态页面不加载远程脚本、样式、字体或图片；响应设置 CSP（含 `frame-ancestors 'none'`）与 `Cache-Control: no-store`；配置值渲染必须用 text/value API，禁止拼接 `innerHTML`。
- `PUT /api/config` 成功和 `/api/cancel` 都是终止动作；先完整发送响应，再幂等清理。冲突不是终止动作，页面保留 draft 供复制、重载或重试。
- API 错误不得回显配置正文、解析后的 secret、命令输出或上游响应 body。

**Design It Twice 结论**：

- **选定：whole-document draft + 单次条件提交**。接口少、与一次性 modal 的内存 draft 一致、天然保留未知字段。
- **否决：输入框级 provider/model CRUD API**。它要求 server 维护第二份 draft 并扩大协议面；共享纯变更函数已解决两套 UI 语义复用，未来只有出现长驻多人编辑时才重评 CRUD API。

**Interface 设计检查**：

- **Module / interface**：runtime 暴露文档级 state/save/cancel；model-source feature 仅增加搜索/发现端点。
- **Seam placement**：HTTP seam 位于浏览器沙箱与 Node 权限边界；文件、环境、命令和上游凭证不下放前端执行。
- **Depth / locality**：端口、token、headers、错误映射与 server 清理集中在 runtime。
- **Dependency strategy**：同进程 loopback；集成测试通过真实随机端口和临时配置文件。
- **Adapter**：HTTP 本身是真实 browser/Node 边界，不增加 pass-through client interface。

### 4.5 Web modal 会话生命周期与 registry refresh

**方向**：TUI command → Web modal runtime
**形式**：进程内函数 + Promise

```ts
type VendorWebResult =
  | { kind: "saved"; snapshot: ModelsSnapshot }
  | { kind: "cancelled" };

type VendorWebSession = {
  url: string;
  waitForResult(): Promise<VendorWebResult>;
  stop(): void;
};

startVendorWebSession(options?: {
  modelsPath?: string;
  openBrowser?: (url: string) => Promise<boolean>;
}): Promise<VendorWebSession>;
```

**约束**：

- `/vendor web` 和 TUI 的“Open full manager”调用同一入口；同一命令只创建一个 server。
- Pi 显示可取消等待界面；TUI Esc 调用 `stop()` 并得到 `cancelled`。
- Save 成功后先返回 HTTP 成功，再 resolve `saved`；Cancel、TUI Esc、启动失败和 `session_shutdown` 幂等清理 listener、server 和未完成请求。
- extension 在 `session_shutdown` 绑定同一幂等 `stop()`，覆盖 `quit/reload/new/resume/fork`；每个 reason 都有 cleanup test。
- 浏览器打不开时显示含 token fragment 的可复制 URL，并继续允许 Esc 取消；notify 内容不得进入 LLM context。
- 当前支持的 Pi peer（`>=0.79.10`）公开 `ctx.modelRegistry.refresh()` / `getError()`。Config core 的 commit 保持纯文件操作；唯一 post-save orchestration 是：HTTP 成功响应 → session resolve `saved` → command 调用一次 `refresh()` → 检查 `getError()` → 分别报告“文件已保存且已刷新”或“文件已保存但 Pi reload 失败”的脱敏错误。TUI/Web 不得各自再刷新，也不把手工 `/model` 当正常路径。

**Interface 设计检查**：

- **Module / interface**：一个启动入口隐藏 server 与 browser 的完整生命周期。
- **Seam placement**：browser opener 是 OS 外部边界；测试注入 fake，runtime server 走真实端口。
- **Depth / locality**：调用方不处理 child process、端口或 HTTP close ordering。
- **Dependency strategy**：browser opener 为 true external；server 与 registry 为 in-process。
- **Adapter**：production opener + test fake 均真实需要，不建立通用 platform framework。

### 4.6 Web draft、字段显隐与可访问性

**方向**：Config core descriptors / pure mutations → Static web app
**形式**：`GET /api/state` 数据 + 构建时共享模块 + 浏览器内状态

```ts
type WebDraft = {
  baseRevision: ConfigRevision;
  models: WebModelsDraft;
  selectedProvider: string | null;
  dirty: boolean;
};
```

**约束**：

- provider common 固定 `baseUrl/api/apiKey`；model common/required 固定 `id`。optional 字段仅当 `Object.hasOwn(config, key)` 时显示，`Add setting…` 只列尚不存在的已知字段。
- `models` 使用专门表格/工作流，不作为 provider JSON 文本字段重复展示。
- Raw JSON 编辑整份 sanitized browser draft：已有 literal secret 显示 SecretRef，浏览器只检查 JSON 语法；server 先按 §4.4 hydration，再做权威校验。
- structured secret input 将 SecretRef 渲染为“configured (unchanged)”且不提供 Reveal；用户输入新值、清空或删除后，按 opaque 协议替换/移除。
- provider/model create/rename/delete 必须调用 4.2 打入浏览器 bundle 的同一纯函数；删除、`overwrite-confirmed` 均要求显式确认。
- 结构化表单与 Raw JSON 始终写同一 `WebDraft.models`，不得维护两份可分叉状态。
- 每个 Web feature 对其新增控件同时交付 label、纯键盘操作、可见 focus、错误关联和确认焦点恢复；最终 hardening 只做组合复核，不延期 accessibility basics。

### 4.7 TUI quick v1 可验收流程

**根菜单顺序**：`Add model`（默认选中）→ `Add provider` → `Open full manager in browser` → `Cancel`。

**已有 provider 快速加 model**：

1. 选择 provider。
2. 选择来源：`Search or enter model id`（默认）或 `Import from /models`。
3. 搜索/选择 official model，或输入 custom id；official 多来源时必须选来源，default enrichment 时允许编辑生成 JSON。
4. id 已存在时 core 返回 `model_exists`；UI 只提供“确认替换”或“返回”，确认后以 `overwrite-confirmed` 重试。
5. 显示变更摘要，默认动作 `Save`；另有 `Add another` 与 `Cancel`。只有 Save 调用条件提交并刷新 registry。

**新 provider 最短向导**：

1. 输入非空 provider key；已存在时拒绝覆盖，并提示改走 `Add model`。
2. 输入 `http/https` base URL。
3. 选择 API format，默认 `openai-completions`，允许当前 Pi 支持值或显式 custom value。
4. 输入非空 API key / env ref / command ref 原始字符串。
5. 通过同一 model selector 添加至少一个 model；model `api` 默认继承 provider。新/修改的 command-backed credential 不能用于 `/models` discovery，用户必须手工输入首个 model id。
6. 显示 provider + 首个 model 摘要，默认动作 `Save`，Cancel 丢弃全部 draft。

**导航语义**：任意中间步骤 Esc 返回上一步；根菜单 Esc/Cancel 不写文件；最终 Cancel 丢弃当前 draft。两条流程都不能进入完整 provider optional-field 表单，低频配置转 Web。状态转移 tests 必须断言：根菜单默认选中 Add model；每个 Esc 返回层级；Cancel 与 Add another 都不 commit；Save 恰好一次 commit；`model_exists` 未确认不能重试 overwrite；新 command-backed credential 不触发 discovery。不得只做菜单文本 snapshot。
## 5. 子 feature 清单

1. **vendor-config-core** — 建立配置快照、Pi compatibility oracle、条件提交、字段描述及 provider/model 共享纯变更。
   - 所属模块：Config core
   - 依赖：无
   - 状态：planned
   - 对应 feature：未启动
   - 备注：feature design 固定两个验收块：A）环境无关 document/mutation core；B）snapshot/oracle/revision/commit core，A 的类型与测试先冻结再接 B。覆盖字段缺失、三层未知字段、duplicate id、mutation result、atomic `0o600` 与当前 Pi oracle；同步 `@earendil-works/pi-coding-agent` peer 为 `>=0.79.10`，`pi-tui` 无新 API 依赖故不抬下限。

2. **vendor-web-modal-runtime** — 交付一次性 loopback server、静态最小管理页、浏览器启动与安全 Save/Cancel 闭环。
   - 所属模块：Web modal runtime、Static web app
   - 依赖：`vendor-config-core`，因为 state/save 必须经过共享校验与提交契约
   - 状态：planned
   - 对应 feature：未启动
   - 备注：这是最小闭环；routes 仅含 state/config/cancel，最小页面加载 opaque-sanitized 单一 draft、编辑已有 provider 的 `baseUrl`、Save/Cancel，不实现临时 CRUD/descriptor UI/变更预览。static asset 目录、构建/复制和 package `files` 归本项；token、origin/host、CSP、no-store、opaque hydration、accessibility basics 与幂等清理不延期。

3. **vendor-model-source-core** — 建立安全 official DTO、enrichment 与有 deadline/body/count/redirect/command 信任边界的 `/models` 发现。
   - 所属模块：Model source core、Web modal runtime
   - 依赖：`vendor-config-core` 提供 ProviderConfig/稳定错误；`vendor-web-modal-runtime` 提供 route table、initial snapshot/SecretRef hydration 与 session-preserving adapter
   - 状态：planned
   - 对应 feature：未启动
   - 备注：增量加入 catalog/enrich/discover routes；覆盖慢首字节/慢读取/超限/非 JSON/redirect/cancel、header/Bearer 组合、provider 不存在/重命名/删除、apiKey 与逐 header path 新增或变化 command 的 fail-closed，以及序列化响应无 secret/unknown 字段。

4. **vendor-tui-quick-workflows** — 按 4.7 固定步骤交付快速添加模型、快速添加供应商和 Web 直达入口。
   - 所属模块：TUI quick flows
   - 依赖：`vendor-config-core`、`vendor-model-source-core` 提供共享语义；`vendor-web-modal-runtime` 提供 Web 会话入口
   - 状态：planned
   - 对应 feature：未启动
   - 备注：完整 provider 设置编辑移出 TUI；mock `ctx.ui` 证明步骤、必填、碰撞确认、Save/Cancel/Esc 与单次写入。

5. **vendor-web-provider-workflows** — 完成 Web provider 新增、重命名、删除、字段显隐、`Add setting…`、Raw JSON 与变更预览。
   - 所属模块：Static web app、Config core
   - 依赖：`vendor-web-modal-runtime` 提供页面与提交闭环；`vendor-config-core` 的纯变更打入 browser bundle
   - 状态：planned
   - 对应 feature：未启动
   - 备注：表单与 Raw JSON 共用单一 draft；删除/覆盖显式确认；未知字段和字段缺失无损 round-trip；新增控件同时满足基础可访问性。

6. **vendor-web-model-workflows** — 完成 Web model 表格 CRUD、官方 catalog enrichment、custom id 与 OpenAI-compatible `/models` 导入。
   - 所属模块：Static web app、Model source core、Config core
   - 依赖：`vendor-web-provider-workflows` 提供稳定 provider 页面骨架；`vendor-model-source-core` 提供安全 DTO 与发现 routes
   - 状态：planned
   - 对应 feature：未启动
   - 备注：official ambiguity 由用户选择来源；导入批量选择和去重；model identity 碰撞使用 4.2 语义；不得把 routing/credential/unknown catalog 字段带入目标 model。

7. **vendor-dual-ui-hardening** — 收口双界面的错误/空/冲突状态、可访问性、跨平台启动、发布资产、回归证据与文档。
   - 所属模块：跨 Config core、Model source core、Web modal runtime、Static web app、TUI quick flows
   - 依赖：直接依赖 `vendor-tui-quick-workflows` 与 `vendor-web-model-workflows`；前六项经这两条链路传递完成
   - 状态：planned
   - 对应 feature：未启动
   - 备注：覆盖 HTTP integration、TUI 状态转移、窄终端/浏览器、纯键盘、browser fallback、malformed config；更新 `.github/workflows/ci.yml`，创建真实 tarball、核对资产清单、解包后从安装布局启动 server smoke；同步 README。前序 feature 的基础安全/可访问性不得延期。

**最小闭环**：第 2 条 `vendor-web-modal-runtime` 完成后，用户已经能从 Pi 启动一次性浏览器管理页，修改现有配置并通过当前 Pi compatibility oracle 与 revision 检查安全保存或取消；model source 不再阻塞该闭环。

### Goal Coverage Matrix

| Goal / completion signal | Covered by item(s) | Verification entry | Evidence type | Core? |
|---|---|---|---|---|
| `/vendor web` 打开一次性 modal，Save/Cancel/Esc 后 server 关闭 | vendor-web-modal-runtime, vendor-dual-ui-hardening | server integration tests + Pi 手工路径 | test + manual transcript | yes |
| 保存通过当前 Pi validator、不覆盖陈旧配置，并保持 atomic/0o600/未知字段/字段缺失 | vendor-config-core, vendor-web-modal-runtime | `npm --workspace @bytetrue/pi-vendor test` | test | yes |
| 已有 known literal secret 不进入浏览器，SecretRef 只能 exact-path/revision hydration | vendor-web-modal-runtime, vendor-web-provider-workflows, vendor-dual-ui-hardening | masker/hydration contract tests + Raw JSON 手工路径 | test + manual transcript | yes |
| provider/model create/rename/delete 的碰撞语义在两套 UI 一致 | vendor-config-core, vendor-tui-quick-workflows, vendor-web-provider-workflows, vendor-web-model-workflows | mutation contract tests + diff review | test + diff review | yes |
| `/vendor` 按 4.7 步骤提供两条快捷新增流程 | vendor-tui-quick-workflows, vendor-dual-ui-hardening | TUI mock tests + `/vendor` 人工路径 | test + manual transcript | yes |
| Web 完成 provider 全生命周期和确认的字段显隐策略 | vendor-web-provider-workflows, vendor-dual-ui-hardening | 浏览器 provider 场景清单 | test + screenshot/manual transcript | yes |
| Web 完成 model CRUD、catalog 和有预算的 `/models` 导入 | vendor-model-source-core, vendor-web-model-workflows, vendor-dual-ui-hardening | fake fetch/catalog tests + 浏览器模型场景 | test + screenshot/manual transcript | yes |
| 保存后当前 Pi registry refresh 且 `getError()` 为空 | vendor-web-modal-runtime, vendor-tui-quick-workflows | Pi 手工保存后打开模型选择 | test/manual transcript | yes |
| npm 发布物包含静态资产且 CI 全绿 | vendor-dual-ui-hardening | workspace typecheck/test + pack smoke | command output | yes |
| Web 键盘可用、错误/空/冲突状态可恢复 | 各 Web item, vendor-dual-ui-hardening | browser QA checklist | manual transcript + screenshots | no |
## 6. 排期思路

先做 `vendor-config-core`，把字段缺失、Pi compatibility、identity 冲突、revision 和安全写入固化。第二条只依赖 config core，立即建立真实浏览器最小闭环；catalog、credential command 与外部网络不再阻塞已有 provider 的 state/edit/save。

最小闭环后独立完成 `vendor-model-source-core`，再让 TUI quick 与 Web model 共用其安全 DTO/发现预算。TUI quick 优先解决当前最高频路径；Web provider 先于 Web model，提供稳定的 provider 页面与 draft 骨架。最后 hardening 收口完整组合，但基础安全与可访问性必须由首次引入相关 surface 的 feature 同步交付。

技术 DAG（只画直接依赖）：

```text
vendor-config-core ─────► vendor-web-modal-runtime ─────► vendor-web-provider-workflows
        │                           │                                  │
        └───────────────────────────┼──► vendor-model-source-core      ▼
                                    │              │       vendor-web-model-workflows
                                    │              │                  ▲
                                    └──────────────┴──► vendor-tui-quick-workflows

vendor-model-source-core ───────────────────────────────► vendor-web-model-workflows
vendor-tui-quick-workflows ─┐
                            ├──► vendor-dual-ui-hardening
vendor-web-model-workflows ─┘
```

`vendor-tui-quick-workflows` 与 `vendor-web-provider-workflows` 在技术上可并行，但默认串行推进以避免同一 package 的命令入口和静态资源集成同时修改；只有隔离 worktree 且 4.1–4.5 契约已冻结时才并行。

### Top 3 风险与缓解

1. **配置或 secret 暴露/丢失**：Config core 用当前 Pi oracle、mutation conflicts、revision 与原子 `0o600` 写；首次 Web runtime 落实 loopback、token、origin/host、CSP、no-store、body limit、opaque keep-value 和无 secret 错误。已有 known literal secret 默认不进入 browser。
2. **两套 UI 行为漂移**：字段描述和 mutation functions 在 Node/browser 共用源码；model source 只返回 allowlist DTO；HTTP 保持 whole-document 提交，不复制成 CRUD 路由。
3. **外部发现或发布资产拖垮 Pi**：Model source 固定 deadline/body/count/id/redirect/command 信任边界；hardening 从实际 pack 文件清单或解包目录启动 server，验证资产存在且可解析。

### 非显然依赖

- Pi 扩展由 Node/jiti 加载，不能依赖 Bun server；CI Node 22 是最低验证环境。
- Config core 依赖当前 Pi 公共 `ModelRegistry` / `AuthStorage` 作为 compatibility oracle；本 epic 把 peer 下限提升到 `>=0.79.10`，不复制私有 validator。
- official catalog 通过 Pi 安装目录中的生成文件加载，这一布局必须藏在 Model source core。
- Pi 没有通用“打开浏览器”扩展 API，需要轻量 OS opener；SSH/headless 只显示带 token fragment 的 URL。
- 当前 Pi 已公开 `ctx.modelRegistry.refresh()` / `getError()`；保存后直接刷新是主路径，不再把 `/model` 手工刷新当正常流程。
- 当前 TUI 只有纯逻辑测试，command/menu 状态机没有自动化覆盖；quick feature 必须补最薄的 mock UI safety net。

### 关键假设与已确认决策

- owner 已接受 Web modal 打开期间 `/vendor` 命令等待 Save/Cancel；Pi 不并发处理另一场 provider 编辑。
- owner 于 2026-07-12 选择 Opaque keep-value：已有 known literal API key/header 原值不进入 browser（含 provider、model 与 modelOverride header paths）；Raw JSON 显示 session-scoped SecretRef，按 §4.4 exact-path hydration。决策历史见 `approval-report.md`。解析后的环境变量与命令输出绝不进入浏览器。
- 第一版不自动合并 `409 config_changed`；页面保留 draft并提示重载/复制，避免猜测字段级 merge。
- 原生静态页面或构建期小型 UI 库均可接受，最终选择由 Web feature design 依据维护复杂度决定；运行时不引入 Web framework/server dependency。

### 基线与验证入口

- package：`npm --workspace @bytetrue/pi-vendor test`
- package typecheck：`npm --workspace @bytetrue/pi-vendor run typecheck`
- peer 下限：CI/dev fixture 使用声明的 `@earendil-works/pi-coding-agent@0.79.10` 完成 install/typecheck/validator characterization
- workspace CI 对齐：`npm run typecheck --workspaces --if-present && npm test`
- 发布资产：创建真实 `npm pack --workspace @bytetrue/pi-vendor` tarball，核对 files、解包到临时目录，并从解包布局启动一次 server/static asset smoke；该命令加入 CI，而非只做 `--dry-run`
- TUI 人工入口：`/vendor` 的 quick add provider/model、Web open、Save/Cancel/Esc。
- Web 人工入口：provider/model CRUD、Raw JSON、catalog、`/models`、冲突、malformed config、浏览器打不开 fallback。

每条 feature 都必须把可重复测试写入对应 test 文件；浏览器视觉与真实 Pi 交互无法由现有 Vitest 证明的部分，保留最短人工 transcript/screenshot 作为 acceptance evidence，不为此默认引入大型 E2E 框架。

### 交付物与知识回写点

- 代码与测试落在 `packages/pi-vendor/src/**`，静态资产必须进入该 workspace 的 npm files 清单。
- 各 feature design/review/QA/acceptance 落在 `.codestable/features/YYYY-MM-DD-{slug}/`，acceptance 回写本 roadmap items 状态。
- 当 revision/HTTP 安全/静态资产发布约定经实现验证稳定后，acceptance 评估是否通过 `cs-domain` 记录 ADR；不要在 roadmap 阶段提前固化。
- 若 catalog 路径、浏览器 opener 或 Pi registry refresh 暴露可复用坑，acceptance 用 `cs-keep` 沉淀；若成为每次实现都必须知道的硬约束，再用 `cs-note` 更新 attention。

## 7. 观察项

- `.codestable/reference/solution-depth-conventions.md` 与 `agent-conventions.md` 在项目骨架中缺失；本次规划读取了已安装 `cs-onboard` 的对应 canonical reference。该文档同步不属于本 epic，建议后续通过 CodeStable 接入/整理流程补齐。
- 当前 `normalizeProviderConfig` 会把缺失的 `models` 变为 `[]`；`vendor-config-core` 必须用字段缺失 characterization tests 纠正，避免破坏 built-in provider override 语义。
- 当前 `/models` 导入只解析简单 `$ENV_VAR` 或 literal、无响应预算并总是发送 Bearer；`vendor-model-source-core` 按 4.3 的认证、command 信任与预算契约替换该行为。
- 当前 README 声称可编辑 headers，但 TUI provider 菜单没有对应入口；Web provider workflow 应以 Pi 当前 schema 为准，README 在 hardening 时统一校正。
- 当前 `replaceModelAtIndex` 把 id 改成已有 id 时会静默合并；新 mutation contract 改为默认拒绝，只有 UI 明确确认后才能 `overwrite-confirmed`，旧行为需 characterization 后迁移。
