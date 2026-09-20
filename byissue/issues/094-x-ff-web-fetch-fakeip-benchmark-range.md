---
kind: issue
title: "web_fetch 误伤 fake-ip TUN 代理：放行 198.18.0.0/15"
type: ff
status: closed
created: 2026-09-20
---

# web_fetch 误伤 fake-ip TUN 代理：放行 198.18.0.0/15

mihomo/Clash TUN 的 fake-ip DNS 会把本机所有域名解析成 `198.18.0.0/15`（RFC 2544 benchmark 保留段）内的假 IP，真实连接由 TUN 网卡透明代理。`web_fetch` 的 SSRF 防护把这一整段列为非公网地址，导致 fake-ip 环境下任何域名都报 `Refusing to fetch hostname … resolved to private/loopback address: 198.18.x.x`，而 curl 不做此校验所以正常。该段不是真实内网服务段，从 blocklist 移除；169.254.169.254、10/8、172.16/12、192.168/16、127/8 等 SSRF 关键段全部保留。

- 改动：`packages/pi-web-search/src/html.ts` — `NON_PUBLIC_IPS` 移除 `["198.18.0.0", 15]`，原地注释说明放行原因（fake-ip TUN 代理）。
- 改动：`packages/pi-web-search/src/html.test.ts` — accepts 用例补 `http://198.18.0.1/` IP 字面量放行断言。
- 验证：包内 `vitest` 全绿（12 文件 108 过）；本机 mihomo TUN 环境实测 `fetchUrlOrThrow('https://pi.dev/changelog')` 修复前复现报错、修复后 200 / 125KB（tsx 临时脚本，已清理）。
- byissue：无影响——spec 只承诺「direct route 在 DNS、redirect、connect-time 守 SSRF 边界」，未枚举网段清单；README「private, loopback, link-local, metadata, and other non-public」表述仍准确。旧 bug `008`（SSRF host resolution）结论不受影响：metadata/内网段照挡。

## 发布记录（2026-09-20）

- 版本 `0.4.0` → `0.4.1`；提交 `4918cbf`（fix），byissue 记录 `3503130`；tag `pi-web-search-v0.4.1` 触发 release.yml（Trusted Publishing OIDC，带 provenance）。
- Release run `35489728497`：success；main CI run `35489728453`：success。
- npm registry 确认：`dist-tags.latest` = `0.4.1`，tarball `pi-web-search-0.4.1.tgz` 已发布。
