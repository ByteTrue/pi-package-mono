---
doc_type: audit-finding
audit: 2026-07-11-pi-web-search-0-1-1
finding_id: "bug-02"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 04：无效 config 被读成空对象后，/web 会静默覆盖原文件

## 速答

启动 fail-soft 把“文件不存在、不可读、JSON 损坏、schema 不合法”全部折叠为 `{}`；随后 `/web` 任一保存动作会以空配置为基底原子替换原文件，永久丢掉仍可恢复的 key / URL / proxy。

## 关键证据

- `packages/pi-web-search/src/config.ts:55-63` — 所有读/解析错误与 schema 失败都返回空 `WebConfig`，调用者无法区分 missing 与 corrupt
- `packages/pi-web-search/src/tools.ts:438-442` — `/web` 直接取得该空对象，无错误状态
- `packages/pi-web-search/src/tools.ts:487-531` — 切 provider、保存 base URL 或 API key 时都从该对象构造新配置并 `writeConfig`
- `packages/pi-web-search/src/config.ts:66-74` — 原子 rename 会可靠地用新文件替换旧文件；原子性反而使坏配置无法再从原路径恢复
- `packages/pi-web-search/src/config.test.ts` — 只测解析后的 resolver，没有“损坏配置 + /web 保存不得覆盖”场景

## 影响

用户手改 JSON 漏逗号、临时读权限问题或新版本 schema 不兼容后，只要再运行 `/web` 选择 provider，就可能丢失多个 API key、SearXNG URL 和 proxy 配置。触发频率不高，但属于配置数据损失。

## 修复方向

保留 startup fail-soft，但让 `readConfig` 返回 missing / valid / invalid 状态；交互写入遇到 invalid 时拒绝覆盖并提示路径，或先备份原文件。

## 建议动作

`cs-issue`，这是确定的数据损失路径，不应靠用户知道 fail-soft 内部语义规避。

## 修复结果

`.codestable/issues/2026-07-11-web-config-invalid-preserve/` 新增 missing / valid / invalid 三态读取：运行时保持 fail-soft，`/web` 对 invalid 在任何 UI/write 前 fail closed；malformed 原文件 byte-for-byte 保留，固定错误不泄漏 JSON/API key 片段。最终 review：`subagent+ocr` passed。
