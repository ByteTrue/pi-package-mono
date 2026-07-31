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
- 修改后用 bundled script 做本地 lint；需要 runtime 确认时让用户 reload Pi 并实际选择模型。

通用 mutation tool 明确不存在：配置修改属于 AI 自己的 edit 能力。

### Bundled script

| 子命令 | 调用方 | 输出/边界 |
|---|---|---|
| `catalog <query> [limit]` | AI | 从 active Pi catalog 搜索并移除 routing/credential 字段；默认 50，范围 1–100 |
| `discover <provider-key> [configured-model-id]` | AI | 按 provider 默认路由或指定模型的 effective api/baseUrl/headers + provider authHeader 探查；OpenAI/Anthropic/Google 协议分支；只输出排序去重后的 id |
| `lint` | AI | 本地 strict JSON、root/providers shape、model id/duplicate 检查；不宣称 runtime 可用 |
| `set-key <provider-key>` | 用户终端 | 无回显输入，只更新一个 key，原子 `0600` 写入 |

AI 通过 bash 按需执行前三项，因此没有常驻 tool schema。`set-key` 只能把命令交给用户，不能由 AI 执行或把 secret 放进 stdin/argv。

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
- commit 顺序：revision 格式 → 可选 oracle → current bytes/revision → stale check → atomic write；
- 写入 canonical `JSON.stringify(value, null, 2) + "\n"`；随机 128-bit temp 名；create/write/rename 期间保持 `0600`；失败清理 temp；
- mutation pure functions 继续使用 `MutationResult<T>` + explicit `ConflictPolicy`，不隐式 upsert。

Pi 0.79 与 0.82 没有共同的独立 `ModelRegistry` 构造 API，所以生产写前只做本地 shape/duplicate 校验。TUI 保存后使用其现成 command context：`await ctx.modelRegistry.refresh()` 再 `getError()`；Skill 脚本不依赖 Pi runtime API，并明确只称为 lint。不静态 import 已移除的 `AuthStorage` 等窄 Pi API。

### 保存后语义

TUI 一次成功操作执行一次 conditional atomic commit，再一次 awaited registry refresh。refresh 后若 Pi 报错，配置已落盘且错误明确展示；不伪装成写前 rollback。Skill 修改后只做本地 lint；需要 runtime 确认时由用户 reload Pi 并实际选择模型。

## 模型来源

### Active catalog

Skill script 的 catalog 从 `PI_VENDOR_PI_ROOT` 或 PATH `pi` 定位 active Pi installation。Search query UTF-8 ≤512 bytes；limit 默认 50，范围 1–100；按 exact/prefix/substring 稳定排序，并移除 provider/baseUrl/headers/apiKey/authHeader。TUI 继续复用 package 内现有 closed DTO catalog core。

### Discovery 安全边界

- Skill script：按 effective API 选择 list URL/auth/response shape：OpenAI-compatible `data[].id` + Bearer；Anthropic `/v1/models` + `x-api-key`/version；Google `/v1|v1beta/models` + `x-goog-api-key` + `models[].name`；`authHeader` 或显式 header 优先。
- 可传 configured model id 使用 model-level api/baseUrl/headers；异构 provider 由 Skill 按 effective route 分组后各探一次。
- 所有 discovery 结果只作 positive evidence：出现可证明该 route 列出该 id，缺失不能推出上游不支持（list API 可能不完整或分页）。禁止据此生成“configured but absent upstream”结论。
- http/https only；拒绝 username/password；redirect error；fetch 15 秒；credential command 10 秒/64 KiB；response 2 MiB chunk-counted；只输出 id 或本地错误。
- TUI：继续使用 package 内 bounded-discover core，同样按 provider API 分支，并保留 overall deadline、exact-path command preflight 与 typed errors。

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
- 当前转向 epic：`.cs/epics/2026/07/29/vendor-ai-first/spec.md`
- 讨论：`.cs/talks/2026-07-29-vendor-ai-first.md`
- 被取代的双界面历史：`.cs/epics/2026/07/12/vendor-dual-ui-manager/spec.md`
- 被取代的 Web 产品化历史：`.cs/epics/2026/07/14/vendor-web-productization/spec.md`
