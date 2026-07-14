---
doc_type: audit-finding
audit: 2026-07-11-pi-web-search-0-1-1
finding_id: "security-01"
nature: security
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 01：SSRF guard 可被尾点 localhost、IPv4-mapped IPv6 和 DNS 私网解析绕过

## 速答

当前 guard 只比对 URL 的 hostname 字符串，不解析最终 IP；`localhost.` 与 `[::ffff:127.0.0.1]` 会直接漏过，公网域名解析/重绑定到私网也不会被发现。

## 关键证据

- `packages/pi-web-search/src/html.ts:106-120` — 仅匹配 `localhost` / `*.localhost`、少量 IPv6 前缀和点分 IPv4；不处理尾点 FQDN、IPv4-mapped IPv6
- `packages/pi-web-search/src/html.ts:123-136` — `parseAndAssertHttpUrl` 检查字符串后直接返回 URL，没有 DNS A/AAAA 校验
- `packages/pi-web-search/src/html.ts:158-172` — 每跳 redirect 会重查 URL，但下一步 `fetch(current)` 才做 DNS 解析，仍有解析/连接时绕过
- 本机 Node 24 复现：`new URL("http://localhost./").hostname === "localhost."`；`new URL("http://[::ffff:127.0.0.1]/").hostname === "[::ffff:7f00:1]"`，二者都不命中当前规则
- `packages/pi-web-search/src/html.test.ts:26-49` — 测试覆盖普通 localhost/RFC1918，但没有上述变体或 DNS 私网解析

## 影响

默认 `exa-free` 没有 native fetch，`web_fetch` 会走 generic fetch；恶意/被污染 URL 可访问用户本机服务、RFC1918 内网或云元数据。manual redirect 修复了旧的 302 绕过，但没有关闭主机解析层绕过。

## 修复方向

统一解析 IP 字面量并拒绝全部非公网段；对每跳 hostname 做 A/AAAA 校验，并在连接阶段固定已验证地址或使用自定义 dispatcher，避免 DNS rebind 的校验/连接竞态。

## 建议动作

`cs-issue`，这是现存安全边界缺口，且有直接可复现输入。

## 修复结果

由 `.codestable/issues/2026-07-11-web-fetch-ssrf-host-resolution/` 修复：IANA 特殊地址策略、尾点/mapped/NAT64、全 DNS 答案、direct connect-time rebind、每跳 redirect 均覆盖；proxy/native 边界显式记录。最终 review：`subagent+ocr` passed。
