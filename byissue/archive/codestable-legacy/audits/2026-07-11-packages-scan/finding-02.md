---
doc_type: audit-finding
audit: 2026-07-11-packages-scan
finding_id: "security-02"
nature: security
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 02：/web 把 API key 明文写入 config.json

## 速答

交互配置把用户粘贴的 API key 原样写入 `~/.pi/byte-pi-web/config.json`，默认文件权限跟随 umask，无 0600 强制，也无「仅写 env 引用」路径。

## 关键证据

- `packages/pi-web-search/src/tools.ts:455-472` — 提示粘贴 key 后 `apiKeys: { ...config.apiKeys, [meta.name]: input.trim() }` 并 `writeConfig`
- `packages/pi-web-search/src/config.ts:61-64` — `writeFileSync(CONFIG_PATH, JSON.stringify(...))`，无 mode
- `packages/pi-web-search/src/config.ts:77-82` — 运行时优先 env，但 UI 路径仍鼓励落盘明文
- 对比：`packages/pi-vendor/src/models-json.ts:57-62` 默认 `apiKey: "$ENV_VAR"` 模板更偏 env 引用

## 影响

- 备份/同步/多用户读 home 时泄露搜索 API key
- 日志或错误若打印 config 会连带泄露（当前 show 有 mask，但文件本身明文）
- 触发：用户通过 `/web` 配置 Tavily/Exa/Brave/Jina/Firecrawl/Bocha

## 建议动作

`cs-issue`：默认写入 `$ENV_NAME` 或只提示 export；若必须落盘则 `writeFileSync(..., { mode: 0o600 })` 并在 README 标明风险。
