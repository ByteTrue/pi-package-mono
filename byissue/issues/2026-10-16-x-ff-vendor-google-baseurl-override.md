---
kind: issue
title: "快改：pi-vendor 支持 google-generative-ai 模型级 /v1beta baseUrl 覆盖与探测对齐"
type: ff
created: 2026-10-16
---

# 快改：pi-vendor 支持 google-generative-ai 模型级 /v1beta baseUrl 覆盖与探测对齐

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。  
> **自检（四答即可，可合成短段，勿空标题凑节）：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

---

Pi 的 `google-generative-ai` 适配器在存在 `baseUrl`（含从 provider 继承）时固定向 `@google/genai` 传 `httpOptions.apiVersion = ""`，SDK 不会自动追加 `/v1beta`。当网关 provider 的 `baseUrl` 为 `http://host:port/v1` 或无版本后缀时，若不配置模型级 `baseUrl: ".../v1beta"`，请求会打到 `/v1/models/<id>:streamGenerateContent` 导致 404。本次将 `google-generative-ai` 的模型级 `baseUrl` 覆盖与 `discover` 探测规则补齐：

1. **TUI 自动路由覆盖（`model-pick.ts`）**：新增 `toGoogleV1Beta(baseUrl)`，当模型 `api === "google-generative-ai"` 且 provider `baseUrl` 不以 `/v1beta` 结尾时，自动将尾部 `/v1` 替换为 `/v1beta`（或无版本后缀时追加 `/v1beta`）写入模型级 `baseUrl`；若 provider `baseUrl` 已以 `/v1beta` 结尾则不写覆盖。
2. **Discovery 路径与去重对齐（`bounded-discover.ts` & `vendor.mjs`）**：修正 `google-generative-ai` 在 `/v1` 结尾 provider 下的探测 URL 为 `/v1beta/models`（原误保留为 `/v1/models`），并在 `vendor.mjs` 的 `routeKey` 中按归一后的有效 `discoveryUrl` 去重（避免 provider 级 `/v1` 与模型级 `/v1beta` 或去 `/v1` 覆盖产生重复探测 route）。
3. **Skill 契约与审计规则（`SKILL.md`）**：在配置模型、精确同步、更新路由与配置审计四处同步写入 **Google Generative AI `baseUrl` Rule**。

- 改动：`packages/pi-vendor/src/tui/model-pick.ts`、`packages/pi-vendor/src/tui/model-pick.test.ts`、`packages/pi-vendor/src/model-source/bounded-discover.ts`、`packages/pi-vendor/src/model-source/bounded-discover.test.ts`、`packages/pi-vendor/skills/pi-vendor/scripts/vendor.mjs`、`packages/pi-vendor/src/vendor-script.test.ts`、`packages/pi-vendor/skills/pi-vendor/SKILL.md`、`packages/pi-vendor/src/skill-contract.test.ts`
- 验证：`npm --workspace @bytetrue/pi-vendor run typecheck` + `npm --workspace @bytetrue/pi-vendor test`（205 passed）+ `npm --workspace @bytetrue/pi-vendor pack --dry-run` + 本机 `pi --list-models --offline` 与 `vendor.mjs discover bytetrueapi`（4 条 route 全部 `ok`，含 `google-generative-ai`）
- byissue：已同步 `byissue/spec/pi-vendor/index.md`
