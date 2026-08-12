---
doc_type: feature-design
feature: 2026-07-12-vendor-web-model-workflows
status: approved
updated: 2026-07-12
depends_on:
  - 2026-07-12-vendor-model-source-core
  - 2026-07-12-vendor-web-provider-workflows
roadmap: vendor-dual-ui-manager
roadmap_item: vendor-web-model-workflows
---

# vendor-web-model-workflows feature design

## 0. 原始需求引用

> Web 是完整管理器；高频是给已有供应商添加模型，也需要整体 provider/model 管理、上游模型列表和 Pi 内置模型配置。

本 feature 在 provider manager single draft 上加入完整 structured model workflow；不改变 HTTP/config/opaque 协议。

## 1. 需求澄清

### 1.1 用户与场景

- 查看/search/filter provider 下 models，新增、编辑/rename、删除。
- 从 Pi local official catalog 搜索并导入。
- 输入 custom id，使用 official/template/default enrichment。
- 从 provider `/models` discover，批量选择、enrich、去重后加入 draft。
- 最终仍和 provider edits 一次 Save & Close。

### 1.2 本 feature 不做

- 不新增模型级 CRUD HTTP API、autosave或长期任务队列。
- 不允许 browser直接 fetch provider/执行 command/读取 Pi catalog filesystem。
- 不实现 model drag reorder；visual sort/filter不改 serialized array。
- 不隐式 remap SecretRef；path-changing mutation fail closed并要求重输/删除。
- 不重做 provider form/Raw JSON/preview基础。

### 1.3 成功标准

1. Model add/edit/rename/delete只用 Config core mutation，id collision默认拒绝并显式确认。
2. Official catalog和enrichment只用 closed DTO；多来源必须用户选择，routing/credential/unknown fields不进入目标 model。
3. `/models` import使用 server hydrate + bounded discovery；browser不接触解析后 credential。
4. Import支持批量选择、deterministic dedupe、existing conflict review；单批最多100，更多可重复 import。
5. Model array serialized order只被明确 mutation改变；visual sort/filter无写 side effect。
6. Any model mutation先检查 SecretRef exact paths；会移动 surviving refs时阻止并要求重输/删除。
7. Loading/empty/error/ambiguity/partial selection可恢复，keyboard/table labels可用。

### 1.4 关键决策

1. **Table + side editor**：model table保留 array index作为 stable edit handle；model id是domain identity，不用 DOM row index猜。
2. **Shared mutation only**：add→`addModel`，edit/rename→`replaceModel`，delete→`deleteModel`；overwrite/delete confirmation显示受影响model/known-secret counts，`overwrite-confirmed`仅来自dialog。
3. **Visual sorting only**：render rows可按 id/name排序，但 actions携带原 array index+previousId；不写回排序。
4. **Secret path simulation**：每个 mutation先在 clone执行，再用 `validateSecretRefLocations` 检查 surviving refs仍在 exact path。Missing refs只在显式删除/replace删除target时允许；moved/copied refs block。
5. **Bulk import cap 100**：checkbox选中超过100时阻止，提示分批；不是 server config，不增加设置项。
6. **Enrichment pipeline**：ready rows可直接预览；official-candidates逐 row选择 source；default warning需要确认/可 edit JSON。
7. **All-or-draft, not all-or-save**：批量 enrichment某行失败时保留成功预览和失败状态，用户决定 retry/skip；Apply selected是一次 browser draft mutation，仍未写盘。

### 1.5 验收场景

1. Provider models absent/empty → empty state，Add/Search/Import可用且不自动写 `models: []`直到首个 model add。
2. Existing table search/visual sort → underlying draft order不变。
3. Add official unique model → closed DTO projected shape + shared add。
4. Official same id multiple providers → source selection required。
5. Custom id template/default → warning/preview/editor；invalid id/object不改 draft。
6. Add existing id → reject；confirm后 overwrite-confirmed replace且ordering contract保持。
7. Edit model id/fields in place → replace previous id；target conflict confirm。
8. Delete model → confirm model + known secret removal counts → exact model removed。
9. Delete/overwrite会shift surviving SecretRef-bearing model indices → blocked before applying；re-enter/remove affected headers后可继续。
10. Visual reorder不存在；Raw JSON reorder仍由 provider feature/ref preflight拦截。
11. Discover request携带 providerKey + sanitized provider；server exact-path hydrate credential，env/initial command rules生效。
12. Discover 10k ids/search/checkbox；选择≤100进入 enrichment，duplicate ids只一项。
13. Bulk rows中 ready/ambiguous/default/failure混合 → each recoverable，Apply只加入selected resolved rows。
14. Existing conflicts bulk default skip；replace selected需确认models/known-secret counts并逐项mutation/ref preflight。
15. Route timeout/too-large/credential/abort → error不终止 modal，draft保持。
16. Save后 provider+model全部一次 PUT；Cancel零写。
17. Keyboard可操作table row、checkbox、editor、candidate dialog、import/apply；focus恢复。

## 2. 方案

### 2.1 Model client state

```ts
type ModelRowHandle = { providerKey: string; index: number; previousId: string };

type ModelEditorState = {
  handle: ModelRowHandle | null;
  value: ProviderModelConfig;
  issues: UiIssue[];
};

type ImportRow = {
  id: string;
  selected: boolean;
  state: "selected-unenriched" | "ready" | "ambiguous" | "default-warning" | "failed";
  choice?: OfficialModelChoice;
  model?: WebModelConfig;
  error?: string;
};

type ModelManagerState = ProviderManagerState & {
  modelQuery: string;
  visualSort: "document" | "id" | "name";
  editor: ModelEditorState | null;
  importRows: ImportRow[];
};
```

`index`只用于找到source position并验证 `previousId`仍匹配；若 draft在dialog期间变化则返回 stale editor，重新打开，不猜。

### 2.2 Model fields

- Common/required：`id`；name/api/reasoning/thinkingLevelMap/input/cost/contextWindow/maxTokens/headers/compat按 descriptor `hasOwn`/Add setting。
- JSON fields parse后进入 editor local state；最终 model必须 JSON-compatible object且 non-empty trimmed id。
- Header SecretRef显示 configured/opaque，不 reveal。
- Official DTO 转为 `ProviderModelConfig` 时只逐字段copy closed allowlist；不 spread raw candidate。

### 2.3 Mutation + SecretRef preflight

```ts
previewModelMutation(
  before: WebModelsDraft,
  mutation: () => MutationResult<WebModelsDraft>,
  slots: SecretSlot[],
  options: { allowedRemovedPrefixes: string[] }, // only after explicit count/category confirm
): UiResult<WebModelsDraft>;
```

- Mutation fail直接映射 code。
- Success扫描known refs：exact原path一次=保留；出现0次仅在user-confirmed deleted/replaced subtree允许且confirmation显示count/category；任何other path/multiple=block。
- Delete index i若后续 model headers有ref会shift，block；append不会shift。
- Replace source same index通常safe；overwrite existing target可能删一项/shift，必须simulation。
- `allowedRemovedPrefixes`由具体confirmed delete/overwrite action生成；普通edit/add为空。Raw JSON仍走provider workflow的whole-document removal confirmation，不能自报allowlist。
- UI绝不排序/normalize `models` array。

### 2.4 Official/custom flow

- `/api/catalog?q&limit` query 1–512 UTF-8 bytes、limit默认50/max100；debounce仅client UX，不改变server validation。
- Result label provider/modelId/name；click preview，不自动 add。
- Custom exact id调用 `/api/enrich`。Ambiguous必须选 candidate；default显示warning，用户可打开 JSON editor。
- Apply使用 shared add/replace + secret preflight。
- `/api/catalog` 返回 `catalog_unavailable` 时disable official entry并显示local-catalog error；custom id与`/models` import仍可用，不需要额外state flag。

### 2.5 `/models` bulk import

1. Call `/api/discover` with selected provider key + current sanitized provider draft；runtime hydrates only trusted exact-path known credential refs before model-source resolver。
2. Display virtual/simple list? 第一版普通可搜索 table；10k rows由document fragment批量render和query filter，若实际卡顿由hardening测量再虚拟化，不预加library。
3. Select up to100；all-visible respect cap。
4. Enrich selected with concurrency 8，external cancel stops pending but keeps completed rows。
5. Ambiguous/default rows require decisions；failed rows retry/skip。
6. Apply resolved rows in deterministic discovery id order；existing skip default并显示skipped count；replace需confirm和每项mutation simulation。
7. One Apply updates browser draft once；no HTTP save。

### 2.6 HTTP/error lifecycle

- Catalog/enrich/discover requests use same session token/origin；model routes never settle session。
- Request AbortController per search/import；new search aborts old，modal Cancel aborts all。
- Errors map to user text without upstream body/credential/command output。
- `invalid_secret_ref` from discover means affected credential path moved；prompt undo/re-enter/remove，不 reload/remap。

### 2.7 UI/accessibility

```text
Provider detail
└─ Models tab
   ├─ Search | visual sort | Add model | Import /models
   ├─ model table (id/name/api/reasoning/context)
   ├─ side editor / official preview
   └─ import tray (selection/enrichment status/apply)
```

- Table caption/column headers；row action names包含 model id。
- Dialog focus trap/native dialog，close恢复 trigger；async status用 polite live region，errors assertive only when blocking。
- Checkbox label，Select visible/selected counts，no color-only states。
- Narrow layout table horizontal scroll，editor stacks；不隐藏 destructive action confirmation。

### 2.8 测试与结构

```text
src/web/client/models/
├── state.ts
├── mutation.ts
├── model-view.ts
├── editor.ts
├── catalog-flow.ts
└── import-flow.ts
```

- Pure state/mutation/import pipeline tests不需要DOM dependency。
- API route integration由model-source feature提供，本feature补client lifecycle/abort tests。
- Static render/browser manual验证table/focus/narrow/10k measured interaction；若性能可接受不做虚拟化。

## 3. 验收

### 3.1 核心不变量

1. Closed DTO only；no raw catalog spread。
2. Shared model mutation/conflict/order semantics。
3. Visual sort no document reorder。
4. Any surviving SecretRef exact path unchanged；no remap。
5. Bulk import≤100 per apply，deterministic，partial recoverable。
6. Model requests never settle modal；final Save仍whole document once。

### 3.2 明确不做反向核对

- 无 model CRUD HTTP route/autosave/background daemon。
- 无 browser fetch/command/catalog filesystem。
- 无 drag reorder/virtualization dependency。
- 无 secret reveal/remap。

### 3.3 Acceptance Coverage Matrix

| Scenario | Core/Supporting | Step | Checklist |
|---|---|---|---|
| 1/2 table/order | Core | S1/S2 | C1/C2 |
| 3/4/5 official/custom | Core | S3 | C3/C4 |
| 6/7/8 mutation | Core | S2 | C5/C6 |
| 9/10 refs/order | Core | S2 | C7 |
| 11/15 discover security | Core | S4 | C8 |
| 12/13/14 bulk | Core | S4/S5 | C9/C10 |
| 16 save integration | Supporting | S6 | C11 |
| 17 accessibility | Core | S6 | C12 |

### 3.4 Definition Of Done

- Checklist all passed；build:web/package tests/typecheck绿。
- Pure tests覆盖mutation/order/ref/import state；route/client integration覆盖abort/error。
- Browser manual覆盖catalog/custom/import/10k/filter/keyboard/narrow。
- Security scan确认no raw catalog/provider credential/upstream body。

## 4. 实施计划

1. **S1-MODEL-TABLE**：state/table/filter/visual sort/empty。
2. **S2-MODEL-CRUD**：editor/add/replace/delete/conflict/ref simulation。
3. **S3-CATALOG-CUSTOM**：catalog/enrich/candidate/default preview。
4. **S4-DISCOVER-SELECT**：discover/token/error/10k filter/≤100 selection。
5. **S5-IMPORT-ENRICH**：concurrency/ambiguity/failure/skip/replace/apply。
6. **S6-INTEGRATE-A11Y**：single draft/save/cancel/abort/focus/narrow/docs。

## 5. 验证入口

```bash
npm --workspace @bytetrue/pi-vendor run build:web
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor run typecheck
```

手工：model CRUD/conflict，official ambiguity，custom default，discover credential errors，100 bulk/10k list，secret-bearing delete shift，keyboard/narrow。

## 6. 风险

1. **Array index SecretRef shift**：mutation simulation blocks；re-entry/remove required。
2. **Bulk state complexity**：row state union + cap100 + concurrency8。
3. **10k rendering**：measure first；virtualization only if acceptance fails。

## 7. 交付物

- Structured model table/editor/catalog/import client modules/tests/assets。
- Provider manager integration/docs。
- Design/checklist/review evidence。
