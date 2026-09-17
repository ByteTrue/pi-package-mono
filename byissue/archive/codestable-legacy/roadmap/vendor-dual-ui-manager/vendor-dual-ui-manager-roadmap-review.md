---
doc_type: roadmap-review
roadmap: vendor-dual-ui-manager
status: passed
reviewed: 2026-07-12
round: 4
---

# vendor-dual-ui-manager roadmap 审查报告

## 1. Scope And Inputs

- Roadmap: `.codestable/roadmap/vendor-dual-ui-manager/vendor-dual-ui-manager-roadmap.md`
- Items: `.codestable/roadmap/vendor-dual-ui-manager/vendor-dual-ui-manager-items.yaml`
- Related docs: brainstorm；无关联 requirement / architecture / compound / drafts
- Code facts checked: pi-vendor config/model/catalog/discover/TUI modules、package/README/CI、当前 Pi `ModelRegistry` / `AuthStorage` / extension context 公共类型与实现

### Independent Review

- Round 1: Paseo `966137e0-21e3-431e-ad14-9607e588df93`，`changes-requested`
- Round 2: Paseo `c8638543-2295-497d-bcf6-60b8ac7cdd72`，`blocked / changes-requested`
- Round 3: completed，Paseo `e278306d-9beb-4df0-a96a-3b687e1c18e9`，model `deepseek-v4-pro`，verdict：无 blocking / 无 important，可进入用户 roadmap review
- Round 4: completed，joint Paseo `f4084471-b97f-4984-8dd0-167e228d870f`，safe DTO/DAG/runtime hydration/error/deadline corrections passed
- Provider diversity: round 1 `claude-opus-4-8`，round 2 `gpt-5.6-luna`，round 3 `deepseek-v4-pro`；Paseo Pi provider 无只读 mode，均使用严格只读 prompt
- Merge policy: 主 agent 逐条用 roadmap/items/doc/code/可运行 characterization 核验；错误事实 finding 不合并为 blocking
- Gate effect: technical corrections reviewed，owner-approved product scope unchanged

## 2. Roadmap Summary

- Goal: TUI 高频快捷流 + 一次性本地 Web 完整管理器
- Modules: Config core / Model source core / Web modal runtime / Static web app / TUI quick flows
- Items: 7 条；`vendor-web-modal-runtime` 唯一 minimal loop；YAML 可解析、无未知依赖、DAG 无环
- Deep contracts: Pi oracle、conditional commit、typed mutation result、safe DTO、bounded streaming discover、loopback HTTP、modal lifecycle、single draft、TUI state transitions

## 3. Round 2 Findings And Disposition

### blocking

- [x] RMR2-B01 未知字段与 Pi oracle 矛盾。
  - Disposition: **rejected on executable evidence**。对当前 Pi `0.79.10` 实际运行 `ModelRegistry.create(AuthStorage.inMemory(), path).getError()`：未知 root/provider/model 三个 case 均为 `ok`，只有 `{}` 因缺 `providers` 被拒绝。JSON Schema 未声明 `additionalProperties: false`，reviewer 对 TypeBox 默认行为判断错误。roadmap §4.1 已要求三层 characterization tests；未来 Pi 拒绝时 fail closed，但不得 strip 后重试。
- [x] RMR2-B02 mutation error code 未进入函数接口。
  - Disposition: fixed。§4.2 改为 `MutationResult<T>` discriminated union + typed `MutationError`；六个函数均返回 result，补旧 upsert 边界和完整 contract test matrix。
- [x] RMR2-B03 literal secret 浏览器策略未决。
  - Disposition: fixed by owner decision。`approval-report.md` 已批准 Option B；roadmap §4.4 定义 session-scoped SecretRef、known secret path masking、exact-path/revision hydration、invalid ref fail-closed、Raw JSON 与清理语义。

### important

- [x] RMR2-I01 Pi peer 下限未形成交付。
  - Disposition: fixed in plan。`vendor-config-core` 同步 coding-agent peer `>=0.79.10`，不抬无新 API 依赖的 pi-tui；CI/dev fixture 验证最低版本。
- [x] RMR2-I02 enrichment DTO 递归投影不明确。
  - Disposition: fixed。§4.3 使用封闭 `WebModelConfig` / `WebCompat`，`toWebModelConfig()` 逐字段重建，禁 spread/cast，移除 nested routing 与未知字段，并做序列化递归扫描。
- [x] RMR2-I03 旧 `FetchLike.json()` 无法做 body budget。
  - Disposition: fixed。§4.3 定义 `BoundedFetchResponse.body` stream seam；生产逐 chunk 计数/cancel/decode/parse，旧 json-only fake 退出新契约。
- [x] RMR2-I04 command trust 缺字段级边界。
  - Disposition: fixed。command-bearing path 仅 `apiKey` / `headers.<exact-name>`；provider 不存在/重命名/删除、path 缺失/变化均 `credential_unresolved`；server 初始 snapshot 是唯一信任源。
- [x] RMR2-I05 CI/pack 未自动验证。
  - Disposition: fixed in plan。runtime item 负责 asset 目录/build/files；hardening 更新 CI，创建真实 tarball、核对、解包启动 smoke。
- [x] RMR2-I06 config core 过宽。
  - Disposition: fixed without speculative extra feature。item 内强制 A) environment-free document/mutation、B) snapshot/oracle/revision/commit 两个可独立验收块，A 契约先冻结。

### nit / suggestion / learning

- [x] RMR2-N01 minimal page 边界：缩为只编辑已有 provider `baseUrl` + Save/Cancel，不先造临时 provider CRUD/descriptor UI。
- [x] RMR2-N02 revision shape：固定 `sha256:` + 64 lowercase hex，由 core 生成，browser opaque round-trip。
- [x] RMR2-N03 catalog input：route UTF-8 byte 检查；default 50、范围 1–100；core 不静默截断非法调用。
- [x] RMR2-S01 refresh：只由 command 在 save session result 后执行一次，Config core/runtime/TUI 不重复刷新。
- [x] RMR2-S02 TUI tests：改为状态转移断言，明确零/一次 commit、碰撞确认与 command discovery 禁止。
- [x] RMR2-L02 shutdown：绑定 `session_shutdown` 并覆盖五种 reason 的幂等 cleanup test。

## 4. Round 3 Findings

### blocking

none

### important

none

### nit

- [x] R3-N01 browser 侧 `SecretSlot` 不含 baseRevision 的文字易混淆。
  - Disposition: clarified。roadmap 明确 browser 只收 `{ref,path}` + 顶层 revision，slot baseRevision 仅在 server map；协议未变化。
- [ ] R3-N02 `enrichModelForWeb` 投影位置。
  - Disposition: accepted feature-design note。函数内部必须先调用 `toWebModelConfig()` 再返回封闭 DTO，HTTP adapter 不接触开放 `ProviderModelConfig`。
- [ ] R3-N03 fake fetch cancel 语义。
  - Disposition: accepted feature-design note。fake stream 的 `cancel()` 后续读取必须失败，contract test 覆盖。

### suggestion

- [x] R3-S01 minimal page 是否含 Raw JSON。
  - Disposition: clarified。minimal page 仅 structured `baseUrl` + Save/Cancel；Raw JSON 在 provider workflow。
- [ ] R3-S02 TUI catalog search 与 `/models` import 文案区分。
  - Disposition: accepted feature-design note。本地 catalog 不需要网络，只有 import 受 discovery/command trust 约束。

### learning

- R3-I01 slot baseRevision 不需要暴露给 browser；冲突后旧 draft 保存失败是 server 正确 fail-closed，UI 在 provider/hardening design 提示关闭并重新打开管理器。
- R3-I02 warning 回显用户已输入的 modelId 不扩大 secret 暴露；feature design 记录 modelId 被视为非 secret。
- 依赖库默认行为必须用当前版本可运行 characterization 核验，不能把启发式判断直接升级为 blocking。

### praise

- Opaque keep-value、typed mutation、三层 unknown characterization、whole-document revision、安全边界分层均获 round 3 reviewer 正面确认。

## 5. User Review Focus

- owner 已选择 opaque keep-value；整体 roadmap review 时仍可检查 placeholder/Raw JSON UX 是否符合预期。
- 整体 roadmap 仍可否决：碰撞默认拒绝、未保存 command 禁止执行、Pi peer `>=0.79.10`、TUI 固定步骤和 feature 顺序。

## 6. Evidence Confidence Ledger

| Check | Verdict | Evidence Class | Basis | Follow-up |
|---|---|---|---|---|
| Granularity Gate | pass | E+C | roadmap §2 + 多模块代码事实 | round 3 |
| Goal Coverage Matrix | pass | E | roadmap §5 | round 3 |
| DAG and minimal loop | pass | E | items 7 条、唯一 minimal、无未知依赖、DAG 无环 | round 3 |
| Interface contract usability | pass | E+C | mutation/DTO/bounded fetch/opaque hydration 均有可执行协议，round 3 无 blocking/important | feature design 按 nits 细化 |
| Module interface depth | pass | E+C | config/model-source 分离，whole-document HTTP 保持窄 | round 3 |

Summary: E=2, E+C=3, H-only core checks=none；全部核心 invariant pass。

## 7. Residual Risk

- revision 是乐观检测而非严格跨进程锁；冲突后旧页面需关闭并重新打开。
- Pi oracle 的错误是字符串，字段级 issue 只承诺本地规则。
- 未知自定义字段中的自定义 secret 不在 known secret-path masker 承诺内。
- 静态资产技术选择留给 feature design，但真实 pack smoke 是最终 gate。
- discovery 取消/失败保留整场 draft；feature design 需验证等待与重试 UX。

## 8. Verdict

- Status: passed
- Blocking: 0
- Important: 0
- Next: continue approved ChildDesignBatch；all designs return in unified owner checkpoint.
