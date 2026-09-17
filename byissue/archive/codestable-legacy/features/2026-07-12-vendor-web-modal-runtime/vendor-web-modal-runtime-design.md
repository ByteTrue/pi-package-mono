---
doc_type: feature-design
feature: 2026-07-12-vendor-web-modal-runtime
roadmap: vendor-dual-ui-manager
roadmap_item: vendor-web-modal-runtime
status: approved
summary: 从 /vendor web 启动受保护的一次性本地浏览器 modal，完成 baseUrl 编辑、条件保存或取消的最小闭环
tags: [pi-vendor, web, local-server, security, browser]
---

# vendor-web-modal-runtime Design

## 0. 术语约定

- **Web session**：一次 `/vendor web` 调用拥有的 loopback server、token、初始 snapshot、SecretRef map、browser result 和 cleanup 生命周期。
- **Opaque draft**：完整 Models document 的浏览器副本；known literal `apiKey` / `headers.*` 已替换为 session-scoped SecretRef。
- **SecretRef**：`pi-vendor-secret:` + 128-bit random base64url；只有 server 内存 map 知道原 path/value/baseRevision。
- **Terminal result**：`saved` 或 `cancelled`；二者只 resolve 一次并触发幂等 cleanup。
- **Minimal page**：只选择已有 provider、编辑其 `baseUrl`、Save/Cancel；不包含 Raw JSON、CRUD、field descriptor UI 或 model source。

## 1. 决策与约束

### 1.1 需求摘要

为 `pi-vendor` 建立第一个端到端 Web 闭环：用户执行 `/vendor web`，浏览器打开静态页面，现有配置以 opaque draft 加载；用户改一个已有 provider 的 `baseUrl` 后 Save，server hydrate secret、调用 Config core 条件提交，Pi command 刷新 model registry 并退出。Browser Cancel、TUI Esc、session shutdown 均零写入并关闭 server。

成功标准：roadmap §4.4–4.6 的 minimal routes、SecretRef、security headers、browser lifecycle、response-before-close 和 single refresh 有 HTTP/session/asset 可运行证据。

### 1.2 明确不做

- 不实现 provider create/rename/delete、可选字段、Raw JSON、model table、catalog/enrich/discover routes。
- 不常驻、不固定端口、不监听 `0.0.0.0`、不支持多 session、多用户或自动保存。
- 不在 browser 读取文件、环境变量、命令输出或 secret 原值。
- 不引入运行时 Web framework/server dependency；不实现 TUI quick 主菜单。
- 不自动 merge `409 config_changed`；旧页面提示关闭并重新执行 `/vendor web`。

### 1.3 复杂度档位

本地一次性管理 UI 默认档位；安全边界、凭证最小暴露和 cleanup 提升为高完整性。流量/性能低，但任何 auth/secret/body-limit 失败必须 fail closed。

### 1.4 关键决策

1. **Node stdlib server**：使用 `node:http`、`node:crypto`、`node:child_process`；不加 Express。
2. **Random loopback capability URL**：监听 `127.0.0.1:0`，token 放 URL fragment；client 存当前 tab `sessionStorage` 后移除 fragment，API 用 Bearer。
3. **Committed static build**：client 使用 browser TypeScript + Config core pure helpers，由 build-time `esbuild` 生成无远程依赖的静态 JS/CSS/HTML，产物提交并位于 package `src/**` 可发布路径；esbuild 只进 devDependencies。
4. **Opaque keep-value**：mask/hydrate保护所有 Pi known API/header paths；commit hydration消费整个draft，另暴露 package-internal non-consuming `hydrateProviderCredentials` 给后续 Model source route，只返回 ephemeral provider copy，不改slot map/phase。
5. **Whole-document commit**：browser 仅改 draft baseUrl；PUT 返回整个 opaque draft + expected revision，server hydrate 后调用 `commitModelsSnapshot`。不添加 CRUD HTTP API。
6. **Bordered waiting UI**：command 用一个可取消等待 component；browser result 调用 done，Esc stop session。浏览器打不开时显示可复制 capability URL。
7. **唯一 refresh 点**：HTTP 先成功响应、session resolve saved，随后 command 调用一次 `ctx.modelRegistry.refresh()` 并检查 `getError()`；Config core/server/client 均不刷新。
8. **Single active session**：extension runtime 持有一个 module-scoped active-session slot；command 在任何 await 前同步 claim，已占用则只显示既有 capability URL。Session `finally` 仅在 identity 相同时清 slot，避免旧 session 清掉新 session。
9. **First-terminal-action-wins state machine**：session 状态固定 `open → saving → saved` 或 `open → cancelled`；terminal transition 在任何 await/commit 前同步 claim。Cancel/Esc/shutdown 若先 claim，后续 PUT 不可写；save 若先进入 saving，后续 cancel 不改写结果，只触发 close-after-response。失败可恢复的 save 将 `saving → open`。

### 1.5 Top 3 风险与证据计划

1. **SecretRef 被移动/伪造/泄漏**：exact JSON Pointer + baseRevision + one-use map；wrong/moved/copied/cross-session cases 全部 400 且零写。
2. **server 在异常路径泄漏资源**：Save/Cancel/Esc/browser-open failure/session_shutdown/HTTP error 都穿过同一 idempotent stop；端口关闭和 listener 清理有 integration tests。
3. **源码可用但 npm asset 缺失**：build output 位于 package files 覆盖范围；build + pack dry-run + 从 runtime asset resolver 读取 fixture 证明。

非显然依赖：`vendor-config-core` 的 snapshot/commit/classifier；Pi TUI `ctx.ui.custom` / BorderedLoader；当前平台 browser opener 命令。

关键假设：页面关闭本身不能可靠通知 server；TUI 等待 UI 始终保留 Esc 取消。没有无人值守 timeout，避免长编辑被误杀。

## 2. 名词与编排

### 2.1 名词层

#### 现状

- `/vendor` command 忽略 args，只进入 TUI provider editor；没有 Web runtime、active session 或 shutdown cleanup。
- package 只发布 `src/**` 与 README，无 Web build/asset resolver。
- Pi 提供 command context、`ctx.mode`、`modelRegistry`、custom UI 和 `session_shutdown` event，但无通用 open-browser API。

#### 变化

```ts
// 来源：roadmap §4.4/4.5
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

Internal nouns:

```ts
type SecretSlot = { ref: SecretRef; path: string };
type StoredSecretSlot = SecretSlot & {
  originalValue: string;
  baseRevision: ConfigRevision;
};

type WebSessionPhase = "open" | "saving" | "saved" | "cancelled" | "closed";

type WebSessionState = {
  snapshot: ModelsSnapshot;
  draft: WebModelsDraft;
  secrets: Map<SecretRef, StoredSecretSlot>;
  phase: WebSessionPhase;
  closeAfterResponse: boolean;
};

type VendorWebRouteContext = {
  initialSnapshot: ModelsSnapshot;
  hydrateProviderCredentials(providerKey: string, provider: ProviderConfig): ProviderConfig;
  // exact-path validation; non-consuming; throws only safe invalid_secret_ref
};
```

HTTP protocol final shape只含：`GET /api/state`、`PUT /api/config`、`POST /api/cancel` 与静态 assets。

##### Interface 设计检查

- **Module**：Web session runtime（全新）隐藏 server/token/secret/browser/cleanup；client 只知 final HTTP DTO。
- **Interface facts**：single session、terminal result once、response before stop、Bearer + exact Origin/Host、2 MiB inbound、save terminal/conflict non-terminal。
- **Seam**：`startVendorWebSession` 是 command seam；`openBrowser` production + fake 是 true external adapter；HTTP 是 browser/Node 权限边界。
- **Depth / locality**：删 runtime 后端口、token、mask/hydrate、cleanup 会散回 command/client，故 module 有足够 depth。
- **Dependency strategy**：server=in-process；filesystem 通过 Config core；browser=true external；assets=local-substitutable fixture。
- **Adapter**：production browser opener + test fake；不为 node:http 造 pass-through adapter。
- **Test surface**：HTTP integration + session result + fake opener + actual asset resolver。

### 2.2 编排层

```mermaid
sequenceDiagram
  participant U as User/TUI
  participant C as /vendor command
  participant S as Web session
  participant B as Browser
  participant K as Config core
  participant R as Pi registry

  U->>C: /vendor web
  C->>S: startVendorWebSession()
  S->>S: snapshot + mask + listen 127.0.0.1:0
  S-->>B: open capability URL
  C->>C: show cancellable waiting UI
  B->>S: GET state + Bearer
  S-->>B: opaque draft + revision + slots
  B->>S: PUT edited baseUrl + expected revision
  S->>S: validate/hydrate SecretRefs
  S->>K: commitModelsSnapshot()
  K-->>S: new snapshot
  S-->>B: 200 saved
  S-->>C: resolve saved; cleanup
  C->>R: refresh(); getError()
  C-->>U: saved/refreshed or saved/reload-failed
```

#### 现状

Command 以同步 TUI wizard 持有 draft，直接 read/upsert/write；Cancel 只从循环返回。没有跨浏览器 session 状态，也没有 shutdown hook。

#### 变化

- `args.trim()==="web"` 进入 Web session；空 args 保持现有 TUI，其他参数显示 usage。
- `/vendor web` 仅在 `ctx.mode === "tui"` 可启动；RPC/JSON/print 不尝试 `ctx.ui.custom` 或 browser opener，返回明确 unsupported-mode 提示。
- Server 启动顺序：snapshot → mask → create server → listen → compose URL → browser opener。任一步失败都 stop/clear secrets。
- Client 只持 opaque draft，minimal form 只更新选中 provider 的 `baseUrl`；保存整个 document。
- PUT 顺序：auth/method/content-type/body limit → parse → validate SecretRefs → hydrate → Config core commit → send 200 → settle/cleanup。
- `config_changed` 返回 409 且不 settle，提示关闭/重开；`invalid_secret_ref` 返回 400 且不 settle，提示撤销 path-changing edit 或重新输入/删除受影响 secret，绝不建议 reload/remap。Minimal page 不移动 path，后续 provider/model UI 必须在 mutation 前 preflight。其他 recoverable errors 保留 draft。
- Page Cancel 返回 204 后 settle cancelled；TUI Esc 直接 stop；shutdown 处理 quit/reload/new/resume/fork。
- PUT 在读/解析/SecretRef validation 后、调用同步 Config commit 前执行 `open → saving` claim；claim 失败返回 `session_busy/session_closed`。Validation/conflict 等可恢复失败把 `saving → open`；commit success 变 `saved`。Cancel/Esc/shutdown 只有从 `open` claim 成功才产生 cancelled；若 phase=`saving`，不覆盖 save，只标记 close-after-response。

#### 流程级约束

- Token 至少 128 bit，不写日志/session message；fallback URL 只通过非 LLM-context notify/wait UI 显示。
- Static HTML/favicon 可无 token，API 全要求 Bearer；无 CORS；Host 必须是实际 `127.0.0.1:port`。PUT/POST 必须携带 exact Origin；GET 若携带 Origin 必须 exact，同源浏览器省略 Origin 时允许，Bearer 仍必需。
- CSP：`default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`；全响应 no-store。
- SecretRef prefix 由 session 随机 map 判定，不凭 prefix hydrate；duplicate/moved/unknown/cross-revision/ref 残留均 `invalid_secret_ref`。
- Masker 用 RFC 6901 遍历 provider/apiKey、provider headers、每个 model array index headers、modelOverrides key headers；所有 provider/model/header keys 正确 escape。未知字段仍原样进入 draft且不承诺 secret masking。
- `hydrateProviderCredentials` 只hydrate指定provider的 apiKey/headers exact refs，返回ephemeral clone；moved/unknown/cross-session ref fail closed，原值不进入browser/response/log。它是后续authenticated model-route的internal seam，不在minimal feature注册model routes。
- Structured secret fields若出现 ref，只显示 configured/unchanged；minimal page不渲染这些输入，但 state/PUT 已完整保护。
- 同一 session 的重复 GET state 返回同一 initial snapshot/ref map，不重发新 refs；terminal result 后 client 删除 sessionStorage token，server 清空 map。
- `stop()` 可重复调用；settled 后新 API 返回 session closed，不再读写。
- Active-session slot check/claim 不跨 await；duplicate command、settle/finally 与 shutdown 交错由 identity-aware tests 证明。
- Static assets 只通过固定 route manifest（exact pathname → preloaded/read-only bytes + MIME）提供；不把 URL path 拼接到 filesystem path，不支持目录遍历或任意文件读取。
- Runtime 跟踪 active sockets/requests；settle 后先让 terminal response finish，再 `server.close()` 并关闭 idle/剩余连接。Stop/shutdown 不截断已经 claim 的同步 commit，但禁止新请求。
- 浏览器 opener 子进程 detached/unref、stdio ignore；macOS=`open`、Windows/WSL=`cmd start`、Linux=`xdg-open`，显式 browser env 只接受单一 executable path、不经 shell；失败返回 false 不抛裸错误。
- `modelRegistry.refresh()` throw 或 `getError()` 非空都只影响 post-save 状态：明确提示“文件已保存但 Pi reload 失败”，不得把成功写入谎报为 cancelled/failed write。

### 2.3 挂载点清单

- Slash command：`/vendor web` — 新增 Web modal 直接入口；空参数旧 TUI 保持。
- Extension lifecycle：extension factory 初始化时只注册一次 `session_shutdown` handler；handler 对 module-scoped active session 调用幂等 stop，不能在每次 command 内重复注册。
- npm package static resources：package 内 Web asset root — 新增并由 runtime resolver 读取。
- package scripts：`build:web` / prepack asset generation — 新增构建挂载点。

### 2.4 推进策略

1. Static structure：确定 client source/build/output/asset resolver，最小页面可从 package layout 加载。
2. Opaque draft：实现 mask/hydrate/SecretRef validation 纯逻辑并冻结安全 invariant。
3. HTTP runtime：接入 state/config/cancel、auth/Origin/Host/body/CSP/no-store 和 Config core。
4. Session lifecycle：接入 random port、browser opener、terminal result、stop/shutdown。
5. Command orchestration：接入 `/vendor web`、等待 UI、Esc、single active session、单次 registry refresh。
6. Integration/polish：完成真实 HTTP、asset、keyboard/focus、错误态和 pack dry-run 证据。

### 2.5 结构健康度与微重构

#### 评估

- 文件级 — `command.ts`：约 92 行且已是薄编排；Web 细节若直接加入会重新变胖，必须只保留 args route + session orchestration 调用。
- 文件级 — `vendor-ui.ts`：约 72 行，仅 TUI wrapper；不承载 Web waiting/session 状态。
- 目录级 — `src/` 已有 17 个平铺文件，本 feature 会新增 server/browser/client/assets/tests 多个同域文件，继续平铺会明显恶化。

#### 结论：微重构（重组目录）

##### 方案

- 搬什么：不搬现有文件；把本 feature 新增的 runtime/browser/security/client/assets 统一落入新的 Web 子目录。
- 搬到哪：Web 子目录按 server/client/assets 职责命名；command 只 import 一个 session 入口。
- 行为不变怎么验证：创建子目录本身不改旧 TUI；空 `/vendor` 现有路径测试/typecheck 保持，新增 `/vendor web` 单独验证。
- 步骤序列：先建立目录与 asset resolver，再逐层加入新能力；不把无关现有模块迁入。

##### 建议沉淀的 convention

- 规则：pi-vendor 的 Web runtime/client/assets 统一归 Web 子目录，package 根 `src/` 只保留入口与既有能力模块。
- 适用范围：仅 `packages/pi-vendor`。
- implement 验证后再决定是否走 `cs-keep`，design 阶段不归档。

## 3. 验收契约

### 3.1 关键场景

1. `/vendor web` in TUI → 监听 `127.0.0.1` 随机端口并打开带 fragment token URL。
2. Missing/wrong token、Origin/Host/method/content-type/body 超限 →稳定 4xx、零配置写、无 secret body。
3. GET state → provider apiKey、provider/model/modelOverride literal header values 被 unique SecretRef 替换；env/command reference 原文可见但未解析。
4. SecretRef 原 path/原 revision → hydrate；moved/copied/unknown/cross-session/cross-revision/ref 残留 → `invalid_secret_ref`、零写。
4a. Internal provider credential hydration → exact refs非消费恢复到ephemeral copy；invalid ref零runner/fetch，slot map/state不变。
5. Minimal page 选择已有 provider、编辑 baseUrl、Save → HTTP 200 后 server close，command refresh 一次且 `getError()` 为空。
5a. `/vendor web` 在 RPC/JSON/print → 不启动 server/browser/custom UI，返回 unsupported-mode。
6. Config core 409 → session 不 settle、draft 保留、页面提示关闭重开。
7. Page Cancel、TUI Esc、五种 session_shutdown reason → cancelled、零写、端口/listener/secret map 清理。
7a. PUT 与 Cancel/Esc/shutdown 交错 → first terminal claim wins：cancel-first 零写，save-first 只保存一次且不被改写成 cancelled；重复 PUT/Cancel 返回 busy/closed。
8. Browser opener false → TUI 显示 capability URL，session 可继续 Save/Cancel/Esc。
9. Browser opener/session API/registry refresh 异常 → 无 orphan server/process；refresh throw/getError 明确报告 saved-but-reload-failed，不篡改写入结果。
10. Static responses CSP/no-store、无远程 URL；未知/遍历 asset path 404 且不能读取 package 其他文件；页面 label/focus/keyboard Save/Cancel 可用。
10a. Empty providers → 页面显示空态，Save disabled，Cancel/Esc 可用。
11. Build output/asset resolver 在源码布局与 npm pack dry-run file list 中存在。
11a. Server settle 后 terminal response 完整送达，listening socket、idle/active connections 最终全部关闭。
12. Empty `/vendor` 旧 TUI 路径不受此 feature 改写；无 Raw JSON/provider CRUD/model routes。

### 3.2 明确不做的反向核对

- API route 不出现 catalog/enrich/discover/provider/model CRUD。
- Server 不监听 `0.0.0.0`、不设置 CORS、不持久化 secret/draft/token。
- Client 不含 remote script/style/font/image URL，不调用 filesystem/env/command。
- Minimal page 不出现 Raw JSON 或 optional-field editor。
- 不新增 runtime Web framework dependency。

### 3.3 Acceptance Coverage Matrix

| Scenario | Covered By Step | Evidence Type | Command / Action | Core? |
|---|---|---|---|---|
| Asset/build/package layout | S1 / S6 | build + pack listing | build:web / npm pack dry-run | yes |
| SecretRef mask/hydrate safety | S2 | unit/property cases | vendor test | yes |
| HTTP auth/security/save/conflict | S3 / S6 | real-port integration | vendor test | yes |
| Browser/session/cleanup | S4 / S5 | fake opener + lifecycle test | vendor test | yes |
| Registry refresh once | S5 | orchestration test | vendor test | yes |
| Minimal page keyboard/error UX | S1 / S6 | browser manual + client state test | manual checklist | yes |
| Existing `/vendor` unchanged | S5 / S6 | command regression | test/manual | yes |

### 3.4 DoD Contract

| ID | 要求 | 证据 | 阻塞级别 |
|---|---|---|---|
| DOD-DESIGN-001 | roadmap §4.4–4.6 minimal contracts 全覆盖 | design review | blocking |
| DOD-IMPL-001 | steps 全 done，static assets 与 server/session evidence 落盘 | checklist/evidence | blocking |
| DOD-REVIEW-001 | security + lifecycle code review passed | review report | blocking |
| DOD-QA-001 | HTTP/session/build/typecheck/tests + 手工 browser 核心场景通过 | QA report | blocking |
| DOD-ACCEPT-001 | npm asset、roadmap 回写、residual risk 核验 | acceptance | blocking |

Validation Commands:

| ID | 命令 | 目的 | 核心性 | 失败处理 |
|---|---|---|---|---|
| CMD-001 | `npm --workspace @bytetrue/pi-vendor run build:web` | 生成静态资产 | core | fix-or-block |
| CMD-002 | `npm --workspace @bytetrue/pi-vendor test` | mask/HTTP/session/command contracts | core | fix-or-block |
| CMD-003 | `npm --workspace @bytetrue/pi-vendor run typecheck` | Node/browser/public 类型 | core | fix-or-block |
| CMD-004 | `npm pack --workspace @bytetrue/pi-vendor --dry-run` | package file list 含 assets | supporting | fix-or-block |

Required Artifacts: design-review、implementation evidence、security code review、browser QA evidence、acceptance。

### 3.5 自我批判结论

- Minimal page 明确只做 baseUrl，不偷做 full provider manager；后续不会重写 API/session contract。
- 最弱依赖是 SecretRef hydration，先做纯逻辑并以 moved/copied/revision cases 证明，再接 HTTP。
- Server close ordering、browser failure、shutdown reason 与 refresh once 都有独立证据，不靠 happy path。
- 选择 Web 子目录避免重新把 command.ts 变胖，也不借机移动无关现有文件。

## 4. 与项目级架构文档的关系

本 feature 落地后会形成 package 内稳定的一次性 local Web session 与 opaque secret 协议。Acceptance 应评估记录 ADR；当前不修改 requirements/architecture。
