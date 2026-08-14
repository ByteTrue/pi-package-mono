# pi-vendor

## 定位

`@bytetrue/pi-vendor` 是 **AI-first** 的 Pi provider/model 配置包，维护 `$PI_CODING_AGENT_DIR/models.json`（默认 `~/.pi/agent/models.json`）。

日常 CRUD、审计与修复由随包分发的 `skills/pi-vendor/SKILL.md` 驱动，AI 使用普通 read/edit 工具做窄修改，并按需执行 bundled `scripts/vendor.mjs`。包不注册 AI tool，只提供 Skill 脚本与一个零模型也能进入的冷启动 TUI。Web 管理器、SecretRef/mask 协议、浏览器资产与 Web lifecycle 已删除。

## 用户表面

### AI Skill

Pi 从 package manifest 自动发现 `skills/pi-vendor/SKILL.md`。Skill 负责：

- 查看、增加、更新、删除、发现和审计 provider/model/modelOverrides；
- 区分目标 provider 与官方模板来源 provider；
- 模板有歧义时要求用户明确选择，不静默猜测；
- 不编造 cost、context、capabilities、compat 等元数据；
- 任何回复、diff 或工具参数都不复现 `apiKey`；
- 每次修改后必须运行 active Pi 的 `pi --list-models --offline`，检查两条输出流没有 `errors loading models.json` warning，并验证目标模型列表变化；exact sync 还必须执行 Skill 固定 Node 模板生成且用户确认的 plan 文件、写前 stale assertion、写后 exact-set assertion 与 discovery union assertion。

通用 mutation tool 明确不存在：配置修改属于 AI 自己的 edit 能力。

### Bundled script

AI-facing script 固定只有两个只读查询：

| 子命令 | 调用方 | 输出/边界 |
|---|---|---|
| `catalog <keyword> [limit]` | AI | 从 active Pi catalog 模糊搜索并移除 routing/credential 字段；空格、连字符和下划线差异可归一匹配；输出 `source: official-catalog` 与 `officialProvider`；默认 50，范围 1–100 |
| `discover <provider-key>` | AI | 从 provider route 固定派生四种 API adapter，再追加并去重 model-level effective overrides；每条 route 只输出 API、状态和排序去重后的 upstream ID，标记 `source: upstream-discovery` |

`compare`、`lint` 与 AI-facing CRUD 子命令不存在。`set-key <provider-key>` 是独立的用户终端密钥入口：无回显输入，只更新一个 key，原子 `0600` 写入；它不属于 AI 查询协议。

AI 不得用 `catalog all`、手工 route 循环或完整输出 `models.json` 替代这两个查询。Exact sync 的本地结构化 set 运算属于 Skill 固定 Node 模板，不是第三个 bundled 命令；模板内部只读取目标 provider 的 `models`，只输出 model ID plan，且固定执行计划生成、写前 stale、写后 exact-set、最终 discovery-union 四次断言。`modelOverrides` 不进入 exact sync。`set-key` 只能把命令交给用户，不能由 AI 执行或把 secret 放进 stdin/argv。

### `/vendor` 冷启动 TUI

根菜单固定两项：

1. **Add provider**：provider key → base URL → API format（4 个常用值 + Custom）→ plaintext API key → `/models` discovery / 手输 id → 官方模板候选 → 保存。
2. **Add model**：选择已有 provider → 从 discovery / 手输 id 接入同一条选模与保存路径。

每次只添加一个 provider/model，成功即结束；批量工作交给 AI。模型候选每页最多 10 行，`←/→` 翻页、`↑/↓` 移动。Esc 为零写入取消。没有 mode selector、What next 循环、删除 TUI 或 Web 入口。

## API key

`apiKey` 作为 literal 存入 `models.json`。普通 key 是明文；若包含 Pi 配置元字符，落盘前必须编码 `$` → `$$`、开头 `!` → `$!`，防止后续被环境展开或命令执行。Skill 不让用户把 key 发进聊天，而给出 bundled `skills/pi-vendor/scripts/vendor.mjs set-key` 命令；脚本在用户终端无回显输入，只更新一个 provider，写前检查原始 bytes 未并发变化，随机临时文件 + rename 原子写，目标与临时文件均为 `0600`。

TUI 也直接收集 key，并按同一 literal encoding 落盘。不存在 env/command-only 产品承诺，也不存在浏览器 SecretRef。

## 配置与保存

### Document/core

- strict JSON；拒绝 BOM、comments 与非 object root；root 必须含 object `providers`；
- revision 为原始 bytes 的 `sha256:…`；
- commit 顺序：revision 格式 → 本地 shape/duplicate 校验 → current bytes/revision → stale check → atomic write；
- 写入 canonical `JSON.stringify(value, null, 2) + "\n"`；随机 128-bit temp 名；create/write/rename 期间保持 `0600`；失败清理 temp；
- mutation pure functions 继续使用 `MutationResult<T>` + explicit `ConflictPolicy`，不隐式 upsert。

Pi 0.79 与 0.82 没有共同的独立 `ModelRegistry` 构造 API，所以不构造 package-local oracle。TUI 保存后使用其现成 command context：`await ctx.modelRegistry.refresh()` 再 `getError()`。Skill 修改后调用 active Pi CLI 的 `pi --list-models --offline`，由当前安装版本完成 strict JSON 与 registry 验证；Pi 对 malformed models.json 可能 warning 后仍 exit 0，所以 Skill 必须检查两条输出流而非只看状态码。不静态 import 已移除的 `AuthStorage` 等窄 Pi API。

### 保存后语义

TUI 一次成功操作执行一次 conditional atomic commit，再一次 awaited registry refresh。refresh 后若 Pi 报错，配置已落盘且错误明确展示；不伪装成写前 rollback。Skill 每次 mutation 后必须运行 `pi --list-models --offline`，要求无 models.json loading warning，并确认目标 model ID 按请求出现或消失；失败时继续修复或恢复自己的改动，不得以不可加载配置结束。Exact sync 还要求 configured sorted ID set 与 confirmed `after` 完全相等，并要求再次 discovery 的 successful ID union 同样等于 `after`；Pi status 0 不能替代集合断言。provider-only mutation 至少要求无 warning；路由或认证变化要求所有 intended route 为 `ok`。真实 generation 因可能消耗额度，仅在用户明确要求时执行。

## 模型来源

### Active catalog

Skill script 的 catalog 从 `PI_VENDOR_PI_ROOT` 或 PATH `pi` 定位 active Pi installation。Search query UTF-8 ≤512 bytes；limit 默认 50，范围 1–100；token 与去除空格/连字符/下划线后的文本参与匹配，按 exact/prefix/substring 稳定排序，并移除 routing/credential 字段。Skill 把“千问 3.7”一类自然称呼当成搜索意图，必要时改用 `qwen 3.7` 等 catalog 关键词重试；匹配只产生候选，不静默决定 canonical ID。TUI 直接加载同一官方 catalog：autocomplete 只保留去重后的 model id；保存候选时复制官方 model config 并移除 provider/baseUrl/headers/apiKey/authHeader。

### Discovery 安全边界

- `discover <provider-key>` 先从 provider-level baseUrl/headers/authHeader 固定派生 OpenAI Completions、OpenAI Responses、Anthropic Messages 与 Google Generative AI 四种 adapter route，再追加每个 configured model 引入的不同 effective override；按 api/baseUrl/headers/authHeader 去重后并发探查。
- 单 route 失败只在该 route 返回 `status: error`，其他成功 route 仍可用；不得把失败或未列出解释成上游不支持。credential echo 使整个 discovery fail closed。
- discovery 中出现的 ID 是该 route 的 positive evidence；脚本不计算 configured/unconfigured/not-listed/unsupported 集合。普通列表场景 Skill 也不得推断这些集合；只有用户明确要求 exact sync 且所有 intended route 为 `ok` 时，才可通过本地结构化 set 运算生成 mutation plan。
- http/https only；拒绝 username/password；redirect error；fetch 15 秒；credential command 10 秒/64 KiB；response 2 MiB chunked；AI-facing 输出只包含来源标签、route API、状态与模型 ID，不包含 apiKey、resolved credential、headers 或完整配置。
- TUI：继续使用 package 内 bounded-discover core，同样按 provider API 分支，并保留 overall deadline、exact-path command preflight 与 typed errors。

### Exact synchronization

Exact sync 的唯一写入授权是 Skill 固定 Node 模板生成并排序的 `{"before":[],"add":[],"remove":[],"after":[]}` plan 文件。`after` 是成功 intended routes 的 model ID 去重并集，`add = after - before`，`remove = before - after`；Agent 必须原样展示 plan JSON，禁止在自然语言中手抄或改写 ID。新增项仍逐个经过 catalog source 选择，删除与 final set 必须由用户确认，整批选择解决前保持只读。固定模板分别拒绝写前 `plan_stale`、写后 `plan_after_mismatch` 与最终 `discovery_union_mismatch`；Pi 可加载不能替代这些断言。`modelOverrides` 不参与 exact sync，必须走定向 update/delete。

## 模板与路由

- 同 id 跨 official provider 可重复；必须让用户选择模板来源。
- 目标 provider 与模板来源 provider 是两个概念，复制模板时不复制官方 baseUrl/headers/credentials。
- `anthropic-messages` 模型挂在 provider-level `/v1` base URL 时，model-level baseUrl 去掉尾部 `/v1`；其他 adapter 无明确需求不加 override。
- 无官方模板时允许 custom model，但只记录用户明确知道的事实，不把“safe defaults”包装成官方事实。

## 包边界

- runtime public entry 只有 default extension registration；内部 config/model-source/TUI 类型不承诺 npm library API。
- package manifest 分发 `src/**`、`skills/**` 与 README；无 build step、Web asset、server 或 lifecycle hook。
- peer：`@earendil-works/pi-coding-agent >=0.79.10`；`@earendil-works/pi-tui` 跟随 Pi package 的 `*` peer 约定。

## 明确不做

- Web UI、loopback manager、browser modal、remote management；
- List verb（Pi `/model` / `--list-models` 已覆盖）；
- general mutation tools；
- TUI 批量、编辑、删除或 key management workspace；
- auth.json / OAuth 管理；
- 自研实时过滤 select（Pi 原生 selector + 必要时分页足够）。

## 验证

```bash
npm --workspace @bytetrue/pi-vendor run typecheck
npm --workspace @bytetrue/pi-vendor test
npm --workspace @bytetrue/pi-vendor pack --dry-run
```

真机 smoke 还应确认：package skill 被发现、bundled script 可从 packed package 执行、extension 不注册 AI tools、`/vendor` 的 Add provider/Add model、candidate 左右分页、Esc 零写入、保存后 awaited refresh/getError。所有 smoke 使用 isolated `PI_CODING_AGENT_DIR`，不得读写用户配置。

## 证据

- README：`packages/pi-vendor/README.md`
- 当前转向 epic：`codestable/epics/003-x-vendor-ai-first/spec.md`
- 讨论：`codestable/talks/003-vendor-ai-first.md`
- 被取代的双界面历史：`codestable/epics/001-x-vendor-dual-ui-manager/spec.md`
- 被取代的 Web 产品化历史：`codestable/epics/002-x-vendor-web-productization/spec.md`
