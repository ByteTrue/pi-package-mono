---
doc_type: feature-design
feature: 2026-07-12-vendor-tui-quick-workflows
status: approved
updated: 2026-07-12
depends_on:
  - 2026-07-12-vendor-config-core
  - 2026-07-12-vendor-model-source-core
  - 2026-07-12-vendor-web-modal-runtime
roadmap: vendor-dual-ui-manager
roadmap_item: vendor-tui-quick-workflows
---

# vendor-tui-quick-workflows feature design

## 0. 原始需求引用

> TUI 里的菜单放简单高频轻量的逻辑，完全体放在 Web；当前添加新供应商、添加新模型都别扭。

上位规划冻结根菜单和两条 v1 happy path：Add model（默认）/ Add provider / Open full manager / Cancel；完整 provider/model 管理移到 Web。

## 1. 需求澄清

### 1.1 用户与场景

- 高频已有 provider：尽快添加一个 model，必要时继续添加，最终只保存一次。
- 新 provider：收集最小可运行字段与至少一个 model，一次性保存。
- 低频完整编辑：从根菜单直接打开已设计的 browser modal。
- 所有中间步骤可 Esc 返回；Cancel 永不写配置。

### 1.2 本 feature 不做

- 不保留完整 provider optional-field 编辑器、model edit/delete 管理器或 Raw JSON。
- 不实现 Web 页面、SecretRef、HTTP routes 或 browser lifecycle。
- 不改变 Config core mutation/commit 或 Model source 网络/credential 规则。
- 不实现 TUI mouse 支持。
- 不自动 merge `config_changed`。

### 1.3 成功标准

1. 根菜单顺序固定，Add model 默认选中。
2. 已有 provider 路径支持 local catalog/custom id 与 `/models` import；冲突必须确认。
3. 新 provider 必填 key/baseUrl/api/apiKey/首个 model；已存在 key 拒绝覆盖。
4. Add another、每层 Esc、Cancel 都零 commit；最终 Save 恰好一次 conditional commit + 一次 registry refresh。
5. 完整旧编辑器从可达 TUI 路径移除；Web 直达复用 `startVendorWebSession`。
6. Scripted UI tests 覆盖状态转移而非只做菜单 snapshot。

### 1.4 关键决策

1. **任务状态机，不做字段菜单**：根 action 进入独立 quick flow；draft 始终是完整 `ModelsJson` clone。
2. **真实 UI port**：定义窄 `VendorQuickUi`，production adapter 包装 Pi `ctx.ui.select/input/editor/confirm/notify`，test adapter 是 scripted fake；不建立通用 TUI framework。
3. **Command 是唯一写入编排**：workflow 只返回 `save/cancelled/open-web`；command 才调用 `commitModelsSnapshot`，成功后 refresh 一次。
4. **共享 domain/source**：identity/conflict 只调用 Config core `MutationResult`；official/custom/discover 只调用 Model source，不直接 import generated catalog 或 fetch。
5. **一步一层导航**：Pi UI 返回 `undefined` 表示 Esc；flow 显式回上一步，不通过递归重新进入 command。
6. **Import 第一版选择一个**：`/models` 返回可搜索列表，用户选一个后可在 summary 选择 Add another；不增加复杂 multi-select。
7. **结构微重构先行**：只把会保留的 `custom-select.ts`、`vendor-ui.ts` 移到 `src/tui/`并先保持测试；待quick flows可达后直接删除旧 `provider-menu.ts/models-menu.ts`，不先搬运即将删除的代码。`command.ts`保留根层薄编排。

### 1.5 关键假设

- 三个依赖 feature 的 design/implementation 先完成；本 feature 不复制未实现 seam。
- `ctx.mode === "tui"` 才能进入 quick UI；其他 mode 返回明确 unsupported 提示。
- API format 默认 `openai-completions`；内置 choices 只做高频值，并始终允许 custom string。

### 1.6 验收场景

1. `/vendor` → Add model 默认选中。
2. Add model → 选择已有 provider → catalog/custom → model ready → Save → 一次 commit/refresh。
3. Official id 多来源 → 必须选 catalog source；未选择不改变 draft。
4. Custom id 无 official/template → 显示 safe-default warning，允许 editor 调整 model JSON 后继续。
5. Import `/models` → bounded discovery 成功 → 选一 id → enrichment → summary。
6. `model_exists` → 只有 confirm replacement 后以 `overwrite-confirmed` 重试；拒绝则回 model selector。
7. Summary Add another → draft 保留、零 commit；下一 model 完成后 Save 仍只 commit 一次。
8. Add provider → non-empty unique key → http/https baseUrl → API format → raw apiKey/ref → 至少一 model → Save。
9. Existing provider key → `provider_exists`，不提供覆盖；返回 key input。
10. New/modified `!command` + import → `credential_unresolved`，提示手工/catalog 输入首个 id；不执行 command。
11. 每层 Esc 回上层；根 Esc/Cancel、summary Cancel → 零 commit/refresh。
12. Config validation/conflict/write failure → 明确脱敏错误，draft 不被旧 upsert 静默保存。
13. Open full manager → quick UI 退出后复用唯一 active Web session 路径。
14. RPC/JSON/print → 不调用 custom/select/input，不写配置。

## 2. 方案

### 2.1 模块与接口

```ts
type QuickRootAction = "add-model" | "add-provider" | "open-web" | "cancel";

type QuickFlowResult =
  | { kind: "save"; models: ModelsJson; expectedRevision: ConfigRevision }
  | { kind: "open-web" }
  | { kind: "cancelled" };

type VendorQuickUi = {
  select<T>(title: string, options: readonly { label: string; value: T }[]): Promise<T | undefined>;
  input(title: string, initial?: string): Promise<string | undefined>;
  editJson<T>(title: string, value: T): Promise<T | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, level: "info" | "warning" | "error"): void;
};

type QuickFlowDeps = {
  ui: VendorQuickUi;
  searchOfficialModels(query: string, limit?: number): Promise<OfficialModelChoice[]>;
  enrichModelForTui(modelId: string): Promise<ModelEnrichmentResult>; // Node-only raw candidate API
  discoverModelIds(provider: ProviderConfig, options: DiscoverOptions): Promise<string[]>;
};

runVendorQuickFlow(snapshot: ModelsSnapshot, deps: QuickFlowDeps): Promise<QuickFlowResult>;
```

`ModelEnrichmentResult` 不跨 HTTP；TUI 可使用完整 official candidate，但写入 model 前必须调用 model-source 的 routing strip/clone helper。UI port 不接触 filesystem、registry 或 credentials。
`DiscoverOptions` 与 `ModelEnrichmentResult` 直接import自 Model source，不在TUI重声明；TUI raw result保留official candidate/source，最终必须调用其routing-strip helper。Pi adapter把现有 `customSelect` null/result wrapper归一为 `undefined`/T。
Catalog search有意使用closed `OfficialModelChoice`做label/preview；只有`enrichModelForTui`走raw result。Contract tests证明raw candidate可含routing，而最终mutation model已strip。

### 2.2 目录与挂载点

```text
packages/pi-vendor/src/
├── command.ts                   # args/mode/read/run/commit/refresh/web orchestration
├── tui/
│   ├── quick-flow.ts            # root state machine
│   ├── add-model-flow.ts
│   ├── add-provider-flow.ts
│   ├── pi-ui-adapter.ts
│   ├── custom-select.ts
│   └── vendor-ui.ts
└── ... shared config/model-source/web modules
```

第一步只移动 retained TUI primitives/tests并更新imports。旧 provider/models menus留原位直到quick flow替换后直接删除；不保留双实现。

### 2.3 根与保存编排

```text
/vendor (TUI only)
  readModelsSnapshot once
  runVendorQuickFlow(snapshot)
    cancelled -> no-op
    open-web -> start existing Web modal orchestration
    save -> commitModelsSnapshot(expectedRevision)
            -> refresh once
            -> report saved / saved-but-reload-failed
```

- Root options exact order：Add model / Add provider / Open full manager in browser / Cancel。
- `ConfigCoreError` 按稳定 code 映射 UI；不得显示 config body、secret、command output。
- `config_changed` 不重读后自动覆盖；提示重新打开 flow。

### 2.4 Add model 状态机

1. **Provider**：从 snapshot provider keys 排序选择；无 provider 时显示空态并引导 Add provider/Cancel。
2. **Source**：
   - `Search catalog or enter model id`（默认、本地、不需要网络）；
   - `Import from /models`（网络，受 exact command trust）。
3. **Catalog/custom**：输入 query；展示 official choices（label 包含 `provider/modelId`）和 `Use "<query>" as custom id`。Custom enrichment ambiguous 时选择来源；default warning 后进入 JSON editor；invalid editor result 不改 draft。
4. **Import**：调用 `discoverModelIds(currentDraftProvider, { initialProvider, providerEnv })`；providerEnv由server-side/TUI `ctx.modelRegistry.authStorage`提供，选择一个id后走`enrichModelForTui`。
5. **Mutation**：`addModel`。`model_exists` 时 confirm；确认后 `replaceModel(previousId=id, conflict="overwrite-confirmed")`。
6. **Summary**：Save（默认）/ Add another / Cancel。Add another 回 provider 或 model source但保留 draft；不 commit。

### 2.5 Add provider 状态机

1. Provider key `.trim()` 非空；`createProvider`/preflight 返回 exists 时只允许重新输入/返回。
2. Base URL 用 `new URL()`，仅 http/https，拒绝 username/password。
3. API format：`openai-completions` 默认；高频 choices + Custom。
4. API key 原始字符串必填；literal/env/template/command 均不在 TUI 解析/显示结果。
5. 首个 model：复用 model selector。New provider 的 command-backed apiKey/header 因 initial provider 缺失不能 `/models` import；catalog/custom 可用。Model api 缺失时继承 provider api。
6. 先组装 provider + model，再调用 `createProvider`；summary Save/Add another/Cancel 与 Add model 共用。

### 2.6 导航与错误

- 每个 subflow 返回 `back/cancel/value` typed outcome；Esc 只退一层。
- 网络失败保留当前 draft，允许 retry/change source/back。
- Editor 返回值必须经 local model object/id check 与 Config mutation；不信任 cast。
- Pi adapter 的所有 title/error 使用短文本，secret field 使用 masked input（若 Pi input 不支持 password，则明确提醒输入会可见，禁止回显）。
- Import 与 catalog 文案明确区分 local / network。

### 2.7 测试 seam 与结构健康

- Scripted `VendorQuickUi` 记录 state transitions、选项顺序、notifications。
- Config deps 使用真实 pure mutation + fake commit spy；Model source 使用 deterministic fake。
- Command test 注入 snapshot/flow/commit/web/registry adapters，断言 only Save commits once。
- 长函数阈值：单个 flow transition handler ≤80 行；若超出按 state helpers 拆，不创建 one-class-per-screen。

## 3. 验收

### 3.1 核心不变量

1. Root order/default 固定。
2. Cancel/Esc/Add another 永不 commit；Save 恰好一次。
3. Collision overwrite 只能来自显式 confirm。
4. New provider 必有 key/baseUrl/api/apiKey/至少一 model。
5. Local catalog 不触发 network；`/models` 走 Model source trust/budget。
6. Existing unknown/missing fields 由 whole draft + shared mutation 保留。
7. Current full editor 从 reachable TUI 移除。

### 3.2 明确不做反向核对

- 无 Web UI/HTTP/SecretRef 实现。
- 无 delete/edit manager 或 optional provider field form。
- 无 direct fetch/catalog-layout/config write。
- 无 mouse。

### 3.3 Acceptance Coverage Matrix

| Scenario | Core/Supporting | Step | Checklist |
|---|---|---|---|
| 1/11/14 root/navigation/mode | Core | S2/S5 | C1/C7/C9 |
| 2/3/4 catalog/custom | Core | S3 | C2/C3 |
| 5/10 network import/trust | Core | S3/S4 | C4 |
| 6 conflict confirm | Core | S3 | C5 |
| 7 single commit | Core | S3/S5 | C6 |
| 8/9 provider flow | Core | S4 | C7/C8 |
| 12 errors/conflict | Core | S5 | C9 |
| 13 Web handoff | Supporting | S5 | C10 |

### 3.4 Definition Of Done

- `vendor-tui-quick-workflows-checklist.yaml` 全部 passed。
- Scripted state tests 覆盖 14 场景，明确零/一次 commit assertions。
- Legacy full editor 无 reachable import/option；unused code 删除。
- Package tests/typecheck 全绿，手工 TUI transcript 留证。
- 不越界实现 Web/provider/model full manager。

## 4. 实施计划

1. **S1-TUI-MOVE**：behavior-equivalent move TUI modules/tests to `src/tui/`；先绿测试。
2. **S2-ROOT-STATE**：UI port + root menu/mode/navigation。
3. **S3-ADD-MODEL**：catalog/custom/import/enrichment/conflict/summary。
4. **S4-ADD-PROVIDER**：minimal fields/first model/command restriction。
5. **S5-COMMAND-COMMIT**：single conditional commit/refresh/Web handoff/errors。
6. **S6-REMOVE-LEGACY**：删除 unreachable full editor，补 regression/manual transcript。

## 5. 验证入口

```bash
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor run typecheck
```

手工：`/vendor` 两条 happy path、每层 Esc、conflict confirm、Add another、Web handoff、narrow terminal。

## 6. 风险

1. **State loop 回退错误**：typed outcomes + scripted transition tests。
2. **旧 upsert/直接 write 残留**：import/AST scan + command commit spy。
3. **TUI 变复杂**：根 4 options，flow 只收必须字段；低频一律 Web。

## 7. 交付物

- `src/tui/**` quick flows/UI adapter/tests。
- Updated thin `command.ts` and exports/imports。
- Removed unreachable legacy full-editor code。
- Design/checklist/review evidence。
