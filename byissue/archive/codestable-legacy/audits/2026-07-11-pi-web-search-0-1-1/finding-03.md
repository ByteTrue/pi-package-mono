---
doc_type: audit-finding
audit: 2026-07-11-pi-web-search-0-1-1
finding_id: "performance-01"
nature: performance
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 03：web_fetch 在截断前完整缓冲响应，可被大响应拖垮进程

## 速答

截断只发生在响应已经被 `res.text()` / provider JSON 完整读入后；公开 URL 可返回超大或无限流，先耗尽 Pi 进程内存，再谈截断和落临时文件。

## 关键证据

- `packages/pi-web-search/src/html.ts:183-201` — generic 路径无大小检查直接 `await res.text()`
- `packages/pi-web-search/src/tools.ts:304-313` — `truncateHead(body)` 和 spill 都在完整 `body` 已生成之后
- `packages/pi-web-search/src/html.ts:202-207` — `Content-Length` 只写入 details，不参与拒绝或预算
- `packages/pi-web-search/src/providers/tavily.ts:58-64`、`jina.ts:48-51`、`firecrawl.ts:53-57` — native fetch 同样先完整读取远端 JSON/text
- `packages/pi-web-search/README.md:18` — 对用户宣称“大页面会截断到 temp file”，但没有说明下载/内存无上限

## 影响

攻击者控制的 URL、错误服务器或压缩炸弹可让单次 `web_fetch` 长时间占用内存并导致 OOM；`DEFAULT_MAX_BYTES` 只保护模型上下文，不保护网络与进程资源。

## 修复方向

按流读取并设置硬字节预算；超预算时中止下载，或边读边写受限临时文件。对可信 `Content-Length` 可提前拒绝，但不能替代流式上限。

## 建议动作

`cs-issue`，属于不可信输入导致的资源耗尽路径。

## 修复结果

`.codestable/issues/2026-07-11-web-fetch-response-budget/` 已建立固定 10 MiB 解压后预算：header 仅作 identity 预检，真实 stream bytes 为安全边界；越界 cancel；generic 与四个 native provider 的成功/错误 body 全部接入。最终 review：`subagent+ocr` passed。
