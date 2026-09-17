---
doc_type: issue-fix
issue: 2026-07-11-web-fetch-ssrf-host-resolution
path: fast-track
status: review-passed
fix_date: 2026-07-11
related: [.codestable/audits/2026-07-11-pi-web-search-0-1-1/finding-01.md, .codestable/audits/2026-07-11-pi-web-search-0-1-1/finding-02.md]
tags: [security, ssrf, web-fetch, dns]
---

# web_fetch SSRF hostname / DNS 绕过修复记录

## 1. 问题描述

`web_fetch` 已逐跳检查 redirect，但 hostname guard 只做字符串判断：`localhost.` 与 IPv4-mapped IPv6 可直接漏过；普通域名解析到本机/私网地址时也没有检查。

用户在当前树 audit 后选择 Finding 1 并回复“继续”，确认按快速通道处理。

## 2. 根因

- `packages/pi-web-search/src/html.ts` 旧 guard 手写少量 IPv4/IPv6前缀，没有规范化尾点 FQDN，也没有统一 IP 段判断
- generic fetch 在调用全局 `fetch` 前不解析 A/AAAA；直接连接时 DNS 校验与实际 socket 连接没有绑定

## 3. 修复方案

1. 用 Node `net.BlockList` + `isIP` 统一拒绝 loopback、link-local、RFC1918/CGNAT、保留/测试、多播及 IPv6 本地/映射范围
2. hostname 先去 IPv6 方括号与尾点；`localhost.` 归一化后按 localhost 拒绝
3. direct fetch：每跳先解析全部 DNS 地址并拒绝任一非公网答案；自建单例 undici `Agent` 用安全 `lookup` 在真实 socket 解析阶段再次校验同一批地址，保留 Node 多地址 fallback、原 hostname/SNI，并关闭 DNS check/fetch rebind 窗口
4. generic fetch 统一使用 npm `undici.fetch` 与同版本 dispatcher，避免 Node 内置 fetch / npm Agent ABI 不兼容；proxy 模式从 `proxy.ts` 读取本包已安装 URL，使用专用 `ProxyAgent` 且不让任意目标经 `NO_PROXY` 退回不安全直连

### 第一性原则 pre-pass

- 外部行为：上述绕过输入必须在任何网络请求前失败；正常公网 redirect 继续工作
- 最小范围：起点为 `html.ts` + `html.test.ts`；独立 review 证明 transport/proxy 是安全边界必需项后，扩到 `proxy.ts` / `proxy.test.ts` 与对应 README 路由说明
- 未做：不顺手处理 audit Finding 3 body 下载预算、provider native-fetch 行为或 search 输出预算；Finding 2 的 per-protocol / ALL_PROXY / 显式优先级因本修复依赖正确 transport 一并封口

## 4. 改动文件清单

- `packages/pi-web-search/src/html.ts`
  - hostname/IP 归一化与非公网段判断
  - direct DNS 预检 + connect-time 安全 lookup（保留多 A/AAAA fallback）
  - redirect 每跳 DNS 复查
  - npm undici transport 与显式 proxy dispatcher 选择
- `packages/pi-web-search/src/html.test.ts`
  - `localhost.`
  - `[::ffff:127.0.0.1]`
  - public hostname → private DNS
  - redirect 后 hostname → private DNS
  - direct fetch 使用安全 dispatcher
  - 实际 undici MockAgent dispatch + connect-time DNS rebind
- `packages/pi-web-search/src/proxy.ts`
  - 导出并维护 HTTP/HTTPS 分协议 proxy 状态；显式 proxy / ALL_PROXY 正确传给全局 Env agent；opt-out/失败切换状态一致；关闭本模块旧 dispatcher
- `packages/pi-web-search/src/proxy.test.ts`
  - 分协议路由、无效替换、opt-out 状态
  - 本地真实 CONNECT：`NO_PROXY` 不绕过、认证头正确
- `packages/pi-web-search/README.md`
  - 明确 provider 与 generic web_fetch 的 NO_PROXY 安全差异

## 5. 验证结果

- 修复前定向测试：20 项中新增 4 项失败（literal 两项 + DNS 两项），证明复现有效
- 修复后 `npm --workspace @bytetrue/pi-web-search test`：**62 passed，9 skipped**；全仓：**106 passed，9 skipped**
- `npm --workspace @bytetrue/pi-web-search run typecheck`：通过
- `git diff --check`：通过
- 正常 public redirect 既有测试继续通过
- transport smoke：固定公网 IP + 原 hostname/SNI 的 direct HTTPS → 200；本机显式 proxy `127.0.0.1:7890` → `https://example.com` 200
- 独立 review round 1 捕获并复现 Node 内置 fetch / npm Agent ABI blocker；已改为同版本 `undici.fetch` 并用真实 MockAgent dispatch 防假绿
- 独立 review round 2：修复特殊 IPv6 漏封、NAT64 公网误封、失败响应 body 未 cancel、proxy opt-out 状态与 NO_PROXY 安全不变量；新增 mixed DNS 与 proxy 状态测试
- 独立 review round 3：按 IANA 当前 special-purpose registry 补 Dummy IPv6 / SRv6 / 2001::/23 例外 / 192.88.99.2，修正 ORCHIDv2 公网误封；保留 NAT64 公网映射；修复 HTTP/HTTPS 双代理、真实 CONNECT 测试、content-type body cancel 与 global dispatcher 释放
- 独立 review round 4/5：补齐整个 `::ffff:0:0/96`（含 mapped-public）拒绝；最终 subagent verdict = passed，0 blocking / 0 important
- 两个 workspace typecheck 与 `git diff --check`：通过；根目录无 `typecheck` script（已用 workspace 命令替代）
- OCR：切换 OpenAI-compatible `deepseek-v4-pro` 后，最终 `html.ts` / `proxy.ts` 均 completed；真实 medium 已修，误报由本地配置边界或固定 undici 8.5.0 源码反证

## 6. 遗留事项

- 显式 HTTP proxy 模式下，目标 DNS 最终由 proxy 解析；本包不能在不破坏 proxy remote-DNS 的前提下把远端解析结果固定到本地校验值。此时本包仍拒绝 `localhost.`、IP literal 和 redirect literal，但 proxy 自身必须作为受信边界。
- Tavily / Exa / Jina / Firecrawl 的 native fetch 由第三方服务取目标 URL，不使用本地 generic transport；第三方 SSRF 防护属于 provider 边界，未在本 issue 扩范围。
- review gate 已通过（`reviewer: subagent+ocr`）；待 audit 状态回写与 scoped commit，不自动 push。
