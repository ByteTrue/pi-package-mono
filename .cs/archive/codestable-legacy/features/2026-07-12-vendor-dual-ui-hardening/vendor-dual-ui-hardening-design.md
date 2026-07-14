---
doc_type: feature-design
feature: 2026-07-12-vendor-dual-ui-hardening
status: approved
updated: 2026-07-12
depends_on:
  - 2026-07-12-vendor-tui-quick-workflows
  - 2026-07-12-vendor-web-model-workflows
roadmap: vendor-dual-ui-manager
roadmap_item: vendor-dual-ui-hardening
---

# vendor-dual-ui-hardening feature design

## 0. 原始需求引用

> 最终 TUI 是简单高频轻量逻辑，Web 是完整管理器。

本 feature 不再增加管理能力，只收口两个 UI、发布资产、错误/可访问性/跨平台证据和文档，证明整个 epic 可交付。

## 1. 需求澄清

### 1.1 用户与场景

- 新用户从 README 理解 `/vendor` 与 `/vendor web` 的职责并完成一次保存。
- 现有用户升级后旧 `models.json`（unknown/missing/override/secret refs）无损可管理。
- CI 从真实 npm tarball 证明静态资产和 runtime 路径可用。
- TUI/Web 在错误、空态、窄终端/浏览器、纯键盘和 browser opener failure 下可恢复。

### 1.2 本 feature 不做

- 不新增 provider/model field、HTTP route、mutation、discovery provider、autosave、mouse或daemon。
- 不以 hardening 名义重写已通过的 module contracts。
- 不发布 npm、bump version、commit/push；外部动作另需授权。
- 不引入 E2E/browser framework，除非现有手工/static/pure/integration证据无法验证 blocking acceptance。

### 1.3 成功标准

1. 所有前序 feature checklist实现状态可追溯且 package/workspace suite绿。
2. CI构建 Web、创建真实 tarball、核对 files、解包并从 packed layout启动一次 server/static/state/cancel smoke。
3. TUI两条 quick path、Web provider/model path、opaque secret、bounded discovery和single refresh有端到端证据。
4. 纯键盘、focus、labels、dialog/error/empty/loading/conflict、narrow terminal/browser通过QA矩阵。
5. macOS/Windows/WSL/Linux opener adapters有deterministic tests；真实当前平台+fallback URL手工验证。
6. README/API behavior与当前实现一致，明确安全/并发限制和恢复方式。
7. 无 legacy full TUI、direct write/upsert/fetch、remote Web asset、secret leak或stale generated asset。

### 1.4 关键决策

1. **Evidence-first hardening**：先运行组合矩阵找缺口，只修 acceptance failure；不预做“大清理”。
2. **Real tarball smoke**：CI脚本执行 build→`npm pack --json`→extract→用 repo Pi/jiti loader从 extracted `src`启动 runtime，GET known asset/state、POST cancel并检查清理。
3. **No snapshot-only QA**：TUI state counts、real loopback HTTP、pure reducers、browser manual各覆盖其真实边界。
4. **Generated asset reproducibility**：CI build后要求 `git status --porcelain -- packages/pi-vendor/src/web/generated` 为空（捕获tracked change与untracked asset），再pack；stale/missing committed asset fail。
5. **Documentation is acceptance**：README写职责、quick steps、Web lifecycle、SecretRef不Reveal、literal new secret exposure、command execution trust、409/invalid ref恢复、revision不是锁。
6. **Residual risk stays explicit**：unknown custom secret不mask、check-to-rename竞态、browser close需Esc；不伪装成已解决。

### 1.5 验收场景

1. Clean install/workspace build → package tests/typecheck全绿。
2. CI Web build后generated diff clean；tarball files含assets且无tests/node_modules/unwanted source maps/remote dependency。
3. Extracted tarball runtime从packed path启动，known asset 200+CSP/no-store，unknown path 404，state token auth，cancel后socket关闭。
4. `/vendor` Add model happy path一次commit/refresh；Add provider happy path一次commit/refresh。
5. Every Esc/Cancel/Add another zero commit；conflict confirm only path to overwrite。
6. `/vendor web` provider create/edit/rename/delete/Raw/preview/save；model CRUD/catalog/custom/discover/bulk/save。
7. Literal provider/model/modelOverride secrets masked；env/command raw ref visible but output never visible；moved ref requires re-entry/remove。
8. Invalid config/409/validator unavailable/read/write/upstream timeout/large/credential/abort states recover as designed。
9. Session save-vs-cancel/shutdown race first-terminal wins，five shutdown reasons clean。
10. Browser opener success/failure/duplicate active session；fallback URL only non-LLM UI。
11. TUI narrow terminal root/flows readable；Web narrow viewport does not hide save/cancel/destructive confirm。
12. Keyboard-only all core controls，focus visible/restored，labels/errors/live regions present。
13. 10k discovery filter/select≤100/import保持可操作；无未经测量的虚拟化依赖。
14. Existing built-in override/custom provider/unknown fields/missing models按 current Pi oracle；Pi允许comment而Config core strict JSON的既有限制必须明确测试/文档化，不得误称无损支持。
15. README fresh-user walkthrough matches actual labels/commands/errors。

## 2. 方案

### 2.1 QA matrix 与 artifacts

```text
.codestable/features/2026-07-12-vendor-dual-ui-hardening/
├── vendor-dual-ui-hardening-design.md
├── vendor-dual-ui-hardening-checklist.yaml
├── vendor-dual-ui-hardening-design-review.md
├── qa-report.md                 # implementation stage
└── acceptance-report.md         # implementation stage
```

QA report逐场景记录 command、测试名、手工步骤、结果/截图路径；不贴 secret/fallback token URL。

### 2.2 Pack smoke

```text
scripts/pack-smoke.mjs
  mkdtemp
  npm pack --workspace @bytetrue/pi-vendor --json --pack-destination temp
  verify JSON file list allowlist/denylist
  extract tgz
  resolve jiti from installed coding-agent package paths via createRequire（no new dev dependency）
  start on 127.0.0.1:0 with temp models path + fake opener
  request fixed asset/API state/cancel
  assert headers/status/cleanup
  rm temp in finally
```

- `prepack`只build assets，不运行递归 pack。
- Smoke不触发真实browser、command credential或用户配置。
- Package `files`与asset resolver都以packed layout为事实，不回退cwd。
- CI Linux Node 22运行；platform opener其它分支用 injected spawn fake。
- Smoke不能假设root-hoisted `jiti`；以`require.resolve("@earendil-works/pi-coding-agent/package.json")`目录作为`require.resolve("jiti", { paths })`起点，模拟真实Pi peer loader。

### 2.3 CI workflow

`ci.yml`顺序：npm ci → package build:web → generated status clean check → workspace typecheck/test → real pack smoke。任何失败阻塞。

最低 Pi peer fixture：用声明的 `0.79.10`执行 config oracle characterization/typecheck，不只安装latest。若 npm workspace难以隔离，test脚本直接加载当前lock中0.79.10并断言版本，避免维护第二套lockfile。

### 2.4 Cross-surface regression

- 一个组合 test fixture含：built-in override、custom provider、missing models、unknown root/provider/model、literal/env/command、provider/model/modelOverride headers。
- TUI scripted flow和Web runtime/client都从同fixture clone，最终logical JSON比较（忽略format但不忽略missing/unknown）。
- Save后registry refresh only once；reload error独立于write result。
- Model source leak scanner递归检查所有 HTTP JSON + user error text。

### 2.5 Accessibility/UX QA

- Web browser manual用当前默认浏览器；记录desktop/narrow、keyboard tab order、dialog focus return、error focus、live status。
- TUI用宽/窄终端手工 transcript；不要求mouse。
- Browser close无法通知server：README和UI等待页明确“回 Pi 按 Esc 取消”。
- 视觉 polish遵循已有设计系统，不重写功能；所有新增文案与实际state code一致。

### 2.6 Documentation

README更新：

```text
Quick TUI workflows
Full Web manager
How Save/Cancel works
Credentials and Opaque keep-value
/models discovery and command trust
Conflicts and recovery
Security boundaries / limitations
Development + build/pack verification
```

不展示真实配置secret、capability URL或本机路径。

### 2.7 Cleanup guard

- AST/import scans：TUI无legacy editor/direct `writeModelsJson`/upsert；browser无fetch external/provider credential resolver；model-source无raw response leak。
- 删除仅限本 epic产生的 obsolete files/imports/assets；pre-existing unrelated dead code只记录不改。
- Generated assets exactly one canonical directory，不保留old copies。

## 3. 验收

### 3.1 核心不变量

1. Actual tarball可启动，不只source tree。
2. All security basics at first surface remain，不因polish回归。
3. TUI/Web shared semantics and single-write invariant。
4. No secret/original command output in browser/log/evidence。
5. Accessibility basics and recoverability proven。
6. Documentation honest about residual limits。

### 3.2 明确不做反向核对

- 无新feature/routes/fields/dependencies unless blocking acceptance proves necessary。
- 无发布/version/commit/push。
- 无 broad refactor/dead-code cleanup。

### 3.3 Acceptance Coverage Matrix

| Scenario | Core/Supporting | Step | Checklist |
|---|---|---|---|
| 1/2/3 build/pack | Core | S1/S2 | C1/C2/C3 |
| 4/5 TUI | Core | S3 | C4 |
| 6 Web E2E | Core | S3 | C5 |
| 7 security | Core | S3 | C6 |
| 8/9 errors/race | Core | S3 | C7 |
| 10 opener | Supporting | S4 | C8 |
| 11/12 UX/a11y | Core | S4 | C9 |
| 13 performance | Supporting | S4 | C10 |
| 14 compatibility | Core | S3 | C11 |
| 15 docs | Core | S5 | C12 |

### 3.4 Definition Of Done

- Checklist all passed，前六feature review/checklists linked。
- CI real pack smoke绿，generated clean。
- QA/acceptance reports含15场景且无secret evidence。
- README当前且命令可运行。
- Code review gate无 blocking/important，owner acceptance另行请求。

## 4. 实施计划

1. **S1-BASELINE-MATRIX**：运行组合suite，建qa report，定位真实缺口。
2. **S2-PACK-CI**：build reproducibility、real tarball smoke、CI/peer fixture。
3. **S3-CROSS-SURFACE**：TUI/Web/config/source/error/race/compat组合修复与证据。
4. **S4-UX-A11Y-PLATFORM**：browser/TUI narrow/keyboard/opener/10k测量。
5. **S5-DOCS-CLEANUP**：README、asset/legacy scans、reports。
6. **S6-FINAL-GATES**：full tests、code review、QA、acceptance package。

## 5. 验证入口

```bash
npm --workspace @bytetrue/pi-vendor run build:web
npm --workspace @bytetrue/pi-vendor run typecheck
npm --workspace @bytetrue/pi-vendor test
npm run typecheck --workspaces --if-present
npm test
node packages/pi-vendor/scripts/pack-smoke.mjs
```

以及 `git diff --check`、generated clean、manual browser/TUI matrices。

## 6. 风险

1. **Hardening变scope扩张**：只修acceptance failure；新feature回planning。
2. **Pack smoke依赖source cwd**：extract + jiti load + cwd-independent assertions。
3. **Evidence泄密**：fixtures only，token/secret redaction scan。

## 7. 交付物

- CI + pack smoke + generated asset guards。
- Cross-surface regression/security/accessibility evidence。
- Updated README。
- QA/acceptance reports and final review evidence。
