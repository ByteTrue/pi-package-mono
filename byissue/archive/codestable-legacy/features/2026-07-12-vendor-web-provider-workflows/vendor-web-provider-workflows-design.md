---
doc_type: feature-design
feature: 2026-07-12-vendor-web-provider-workflows
status: approved
updated: 2026-07-12
depends_on:
  - 2026-07-12-vendor-config-core
  - 2026-07-12-vendor-web-modal-runtime
roadmap: vendor-dual-ui-manager
roadmap_item: vendor-web-provider-workflows
---

# vendor-web-provider-workflows feature design

## 0. 原始需求引用

> Web 做完整管理；常用字段始终显示，可选字段只在已配置时显示并提供 Add setting…，另留 Raw JSON。

本 feature 将 minimal baseUrl page 扩展为 provider 完整生命周期；structured model CRUD/catalog/import 留给下一 feature。

## 1. 需求澄清

### 1.1 用户与场景

- 从 provider sidebar 选择、新增、重命名、删除 provider。
- 编辑 common connection/auth fields；按需添加 optional setting。
- 查看整份 sanitized Raw JSON 和 before/after preview。
- 最后一次 Save & Close 或 Cancel；无 autosave。

### 1.2 本 feature 不做

- 不实现 structured model table/CRUD/catalog/import。
- 不增加 provider/model CRUD HTTP API；仍 whole-document PUT。
- 不 reveal SecretRef 或执行 env/command。
- 不实现自动 merge `409`、long-lived server 或 remote assets。
- 不引入前端 framework；使用现有 esbuild + vanilla TS/native HTML。

### 1.3 成功标准

1. Provider create/rename/delete 调用 Config core shared mutations，碰撞默认拒绝且破坏性操作显式确认。
2. `baseUrl/api/apiKey` common inputs 始终可见但不因空 input 自动补 key；optional fields按 `Object.hasOwn`/Add setting 显示。
3. Structured form 与 Raw JSON 操作同一 `WebDraft.models`；切换不分叉，未知/缺失字段保留。
4. SecretRef structured 显示 unchanged，Raw JSON 显示 opaque ref，无 reveal；ref 移动在 client preflight/server hydration fail closed。
5. Save 使用已有 revision/opaque PUT；Cancel 零写；错误可关联字段/全局提示并保留 draft。
6. Keyboard/labels/focus/confirmation basics 与 provider controls 同步交付。

### 1.4 关键决策

1. **Single client store**：baseline sanitized draft、current draft、secretSlots、selection、dirty/errors；DOM 只是投影。
2. **共享纯 mutation 打入 bundle**：browser import environment-free Config core mutation/descriptor module；Node-only snapshot/oracle 不进入 bundle。
3. **Native UI**：semantic sidebar/nav/form/table-free provider detail、`<dialog>` confirmation、`<details>` Before/After；不加 React/Preact。
4. **Before/After 而非自研 line diff**：稳定 JSON serialize 的 baseline/current 双栏 + provider/field change summary，避免引入 diff dependency/LCS。
5. **Exact-path SecretRef 不 remap**：provider rename若source subtree仍有ref则阻止并要求重输/删除；target overwrite/delete或field clear会移除secret，必须在确认中显示受影响slot数量/field category。不得新增secretMoves API。
6. **Visual order ≠ serialized order**：provider sidebar 可排序显示，但 object/model 实际顺序不被 UI 自动重写，降低 SecretRef path/无关 diff。

### 1.5 验收场景

1. State loaded → provider sidebar + selected detail；common fields visible，absent optional hidden。
2. Add setting → only missing known optional list；add creates selected key with type-appropriate empty value，remove deletes key。
3. Common absent input remains absent until user change；clear existing common deletes key rather than writes empty string。
4. Create provider non-empty unique key → blank provider draft selected；no implicit overwrite。
5. Rename no conflict/no refs → shared rename mutation；selection follows key。
6. Rename target exists → reject；destructive confirmation显示target models/known secret slot counts后才`overwrite-confirmed`。
7. Rename subtree contains SecretRef → blocked before mutation，lists affected known secret paths；after refs replaced/removed rename succeeds。
8. Delete provider → confirm provider/model/known secret counts → shared delete；remaining provider selected deterministically。
9. Edit apiKey/header SecretRef unchanged → ref preserved；new text replaces；clear/remove deletes。
10. Raw JSON valid → replaces same store and reselects provider if possible；invalid JSON stays in editor with parse error。
11. Raw JSON moves/copies/forges ref → preflight error；missing ref视为secret removal并先确认count/categories；server authoritative，invalid_ref零写。
12. Before/After preview shows sanitized baseline/current and summary，never secret original。
13. Save success terminal；invalid_config issues focus/associate relevant field when path known；409 prompts close/reopen，draft remains copyable。
14. Cancel/close confirmation when dirty → explicit discard；clean Cancel immediate zero write。
15. Pure keyboard create/edit/add/remove/confirm/save/cancel works with visible focus and labels。

## 2. 方案

### 2.1 Client state 与 actions

```ts
type ProviderManagerState = {
  baseline: WebModelsDraft;
  draft: WebModelsDraft;
  revision: ConfigRevision;
  secretSlots: SecretSlot[];
  selectedProvider: string | null;
  rawText: string | null;
  dirty: boolean;
  errors: UiIssue[];
};

type ProviderAction =
  | { type: "create"; key: string }
  | { type: "rename"; from: string; to: string; conflict: ConflictPolicy }
  | { type: "delete"; key: string }
  | { type: "set-field"; key: string; field: ProviderFieldKey; value: unknown }
  | { type: "remove-field"; key: string; field: ProviderFieldKey }
  | { type: "apply-raw"; text: string }
  | { type: "select"; key: string | null };

reduceProviderAction(state: ProviderManagerState, action: ProviderAction): UiResult<ProviderManagerState>;
validateSecretRefLocations(draft: WebModelsDraft, slots: SecretSlot[]): UiResult<{ removed: SecretSlot[] }>;
```

Reducer 是纯函数并复用 `createProvider/renameProvider/deleteProvider`；不执行 fetch/DOM/PUT。所有 draft clones 保持 JSON document semantics。

### 2.2 Provider field semantics

- Common displayed：`baseUrl`、`api`、`apiKey`；empty display 不代表 field exists。
- `api` 使用 native text input + datalist of current common formats（非封闭 enum），始终允许custom string；descriptor kind仍为text。
- Optional known：`name`、`headers`、`authHeader`、`compat`、`modelOverrides`；`models` 不作为 provider JSON field editor重复展示。
- `Add setting…` 从 descriptors 过滤 `Object.hasOwn(provider, key)`；JSON fields 用 textarea + parse，boolean 用 checkbox。
- 所有optional已存在时 `Add setting…` disabled并说明“all settings added”，不显示空菜单。
- Setting remove 是显式 action；common clear 视为 remove，避免 Pi schema 中 empty string。
- Unknown fields不出 structured form但 Raw JSON/Before-After 原样保留。
- API key 使用 password input；SecretRef 不放入 value，显示 configured unchanged badge。Env/command raw reference仍按原字符串展示但不解析。
- Headers/modelOverrides JSON 中 SecretRef 只显示 opaque string，不提供 reveal。
- JSON editors旁解释 opaque ref表示“configured unchanged”，移动会失败、删除会移除secret；不显示ref token以外的敏感信息。

### 2.3 Provider identity 与 SecretRef

- Create/rename key `.trim()`、case-sensitive；error 使用 Config mutation code。
- Rename preflight 计算 old provider RFC6901 prefix，查找仍出现在 draft exact path 的 `secretSlots`。有 ref 时 blocking UX 给出 field categories，不显示 ref/original value。
- User 可在 old provider form/Raw JSON 把这些 refs 替换为新 literal/ref string或删除 secret；随后 rename会移动新输入值（用户主动暴露）而非 opaque ref。
- Delete/overwrite/field clear使ref消失是secret removal，必须在action/Raw Apply确认里展示count/category，不显示ref/original；确认后missing path可由server解释为remove。
- Delete后从sorted sidebar选择删除位置上的next provider；无next则previous；空列表为null。Visual sort不改document。
- Client拒绝ref非原path、出现次数>1、unknown；missing单独返回removed列表用于确认。Server仍authoritative。

### 2.4 Raw JSON 与 preview

- Enter Raw mode：`JSON.stringify(draft, null, 2)`；Apply 成功才替换 store。
- Apply local checks：JSON syntax、root/providers shape、known ref exact locations；若refs missing先显示secret-removal confirm，Pi semantics只在Save server oracle。
- Structured/Raw switch前若 rawText dirty未 apply，要求 Apply/Discard/Stay。
- Preview：provider add/delete/rename不可可靠从任意 Raw JSON推断时只显示 added/removed/changed provider keys；下方显示 sanitized Before/After `<pre>`。
- HTML render 全部使用 `textContent`/input value；禁止 innerHTML config interpolation。

### 2.5 HTTP/save/cancel

- 继续使用 runtime `GET state` / `PUT config` / `POST cancel`；不新增 route。
- Save 前 local reducer/secret location/JSON checks；PUT 发送 sanitized draft + original revision。
- 400 issues：known JSON pointer 尽量映射 field，其他 global summary；409 保留 draft并提示“关闭页面并重新打开 manager”。
- Success 清 token/store并进入 terminal saved view；Cancel dirty 时 local confirm后 POST。

### 2.6 UI hierarchy 与可访问性

```text
header: Pi Vendor Manager | Unsaved status | Preview | Save & Close
sidebar: Search providers | + Add provider | provider list
main: provider key + Rename/Delete
      Connection (baseUrl/api)
      Authentication (apiKey)
      Optional settings + Add setting…
      Raw JSON (whole document)
footer/status: errors / Cancel
```

- Desktop two-column；narrow browser stack sidebar then detail，不做 mobile app chrome。
- 每个 input 有 label/help/error id；error focus第一个 invalid control。
- `<dialog>` 打开后 focus first safe action，关闭恢复 trigger；Escape 等同 Cancel dialog而非直接 destructive action。
- Native buttons/forms，visible `:focus-visible`，状态不仅靠颜色。

### 2.7 文件与测试

```text
src/web/client/
├── state.ts                 # pure reducer/secret validator
├── provider-view.ts         # semantic DOM rendering
├── raw-view.ts
├── preview.ts
├── api-client.ts            # existing minimal client expanded only in UI usage
├── app.ts
└── styles.css
```

- State/mutation/Raw/SecretRef tests 在 Node 环境运行，不需要 DOM emulator。
- Rendering/accessibility 用 browser manual checklist + static DOM assertions；不为一页加入 Playwright/jsdom dependency。
- `build:web` 继续生成 committed assets；remote URL scan保持。

## 3. 验收

### 3.1 核心不变量

1. Single draft store；no autosave。
2. Shared mutation handles provider identity/conflict。
3. Missing/unknown fields remain missing/preserved。
4. Existing known secret original never reaches DOM/browser；SecretRef exact path。
5. Provider rename cannot implicitly move opaque refs。
6. Destructive actions confirm；Cancel zero write。
7. No structured model CRUD。

### 3.2 明确不做反向核对

- 无 model table/catalog/discover。
- 无 new HTTP CRUD routes。
- 无 secret reveal/remap。
- 无 framework/remote asset/autosave/merge。

### 3.3 Acceptance Coverage Matrix

| Scenario | Core/Supporting | Step | Checklist |
|---|---|---|---|
| 1/2/3 fields | Core | S2 | C1/C2 |
| 4/5/6 identity | Core | S3 | C3/C4 |
| 7/9/11 SecretRef | Core | S3/S4 | C5/C6 |
| 8 delete | Core | S3 | C7 |
| 10 Raw JSON | Core | S4 | C8 |
| 12 preview | Supporting | S5 | C9 |
| 13 save/errors | Core | S6 | C10 |
| 14/15 cancel/a11y | Core | S6/S7 | C11/C12 |

### 3.4 Definition Of Done

- Checklist 全 passed；pure state tests + package suite/typecheck/build:web绿。
- Provider CRUD/field/raw/secret/save scenarios有测试/手工证据。
- Browser keyboard/narrow/error screenshots/transcript留证。
- Route/import scan证明没有 model-source routes或structured model UI。

## 4. 实施计划

1. **S1-STATE-BASE**：baseline/current store、actions、API load，minimal UI不回归。
2. **S2-FIELDS**：sidebar/common/optional/Add setting/remove。
3. **S3-PROVIDER-CRUD**：create/rename/delete/conflict/confirm/selection。
4. **S4-RAW-SECRET**：Raw apply、SecretRef preflight、rename blocking。
5. **S5-PREVIEW**：summary + sanitized Before/After。
6. **S6-SAVE-ERRORS**：PUT/cancel/errors/conflict/terminal states。
7. **S7-A11Y-POLISH**：keyboard/focus/narrow/static scans/docs。

## 5. 验证入口

```bash
npm --workspace @bytetrue/pi-vendor run build:web
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor run typecheck
```

手工：provider create/rename/delete，optional fields，literal/env/command secret display，Raw JSON invalid/ref move，409，keyboard/narrow viewport。

## 6. 风险

1. **Provider rename + opaque refs**：block until re-entry/removal；no implicit remap。
2. **Raw/structured divergence**：single store + Apply gate。
3. **Frontend scope growth**：vanilla/native，model features deferred。

## 7. 交付物

- Provider manager state/reducer/views/tests/assets。
- Updated Web client and docs。
- Design/checklist/review evidence。
