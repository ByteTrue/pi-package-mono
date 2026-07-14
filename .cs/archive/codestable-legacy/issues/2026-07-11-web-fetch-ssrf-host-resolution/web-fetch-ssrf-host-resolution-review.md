---
doc_type: issue-review
issue: 2026-07-11-web-fetch-ssrf-host-resolution
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-11
round: 6
---

# web-fetch-ssrf-host-resolution 代码审查报告

## 1. Scope And Inputs

- Source finding: `.codestable/audits/2026-07-11-pi-web-search-0-1-1/finding-01.md`
- Fix note: `web-fetch-ssrf-host-resolution-fix-note.md`
- Diff：`html.ts` / `html.test.ts` / `proxy.ts` / `proxy.test.ts` / README + CodeStable 产物
- Baseline：修复前已有当前 audit 文档；代码改动均可归因于本 issue
- Evidence：包内 62 tests、全仓 106 tests、9 live E2E skipped；两个 workspace typecheck；direct/proxy HTTPS smoke 200；本地真实 CONNECT + Basic auth + NO_PROXY 测试

### Independent Review

- 环节 A：`pi-subagents reviewer` fresh context，completed
- 环节 B：OCR completed；切换 custom provider 为 OpenAI-compatible `deepseek-v4-pro` 后，最终按 `proxy.ts` / `html.ts` 单文件范围完成审查
- 合并策略：每轮 subagent / OCR finding 均由主 agent 复现后修；最终 subagent round 5 为 `passed`
- Gate effect：none；Task reviewer + OCR 均完成，最终 findings 经本地事实核验合并

## 2. Diff Summary

- `html.ts`
  - IANA special-purpose public/non-public IP policy与明确公网例外
  - 尾点 hostname、NAT64、IPv4-mapped IPv6
  - 全 DNS 答案预检 + connect-time 安全 lookup
  - npm undici 同版本 direct/proxy transport
  - redirect 每跳按协议重选 dispatcher；错误 body cancel
- `proxy.ts`
  - HTTP/HTTPS 分协议 route；显式、大小写 env、ALL_PROXY
  - opt-out / invalid replacement 状态一致
  - 只关闭本模块自建旧全局 dispatcher
- Tests
  - 真实 MockAgent dispatch、connect-time rebind
  - 本地真实 CONNECT、proxy auth、NO_PROXY 不绕过
  - mixed DNS、NAT64、IANA special ranges、body cancel

## 3. Adversarial Pass

已主动攻击：

- `localhost.`、mapped-private / mapped-public
- DNS public→private / mixed A+AAAA / redirect DNS / connect-time rebind
- NAT64 public 与 private embedded IPv4
- Node BlockList 把 mapped range错误扩散到普通 IPv4
- Node 内置 fetch 与 npm undici Agent ABI
- HTTP_PROXY / HTTPS_PROXY 跨协议 redirect
- NO_PROXY 直连绕过、proxy auth、opt-out、无效替换
- redirect / non-2xx / binary content-type body 释放

结果：最终 subagent 无 blocking / important。

## 4. Findings

### blocking

none（代码层）

### important

none（最终 subagent round 5）

### nit

- OCR low：`html.ts` 顶部重复注释，已删除

### suggestion

- 后续可补 HTTP→HTTPS redirect 使用两个真实本地 proxy 的集成测试；当前分协议状态测试 + 每跳代码审查已覆盖。
- OCR medium“禁止私网 proxy”不采纳：本项目显式支持受信本地代理（当前即 `127.0.0.1:7890`），proxy 地址来自本机配置/env，不是远端 URL 输入
- OCR medium“socks5: 不受 undici 支持”不采纳：固定 undici 8.5.0 源码 `proxy-agent.js:143,167` 明确支持 `socks5:` 与 `socks:`

### praise

- Round 1 独立 reviewer 抓到 Node 内置 fetch / npm Agent ABI 真 blocker，未被 mock 测试假绿带过
- 最终 transport 使用同一 npm undici；direct lookup 在真实 socket 解析阶段校验且保留多地址
- proxy 真实 CONNECT / auth / NO_PROXY 安全不变量已自动化

### residual-risk

- proxy 模式的目标 DNS 由受信 proxy 解析，本地无法固定远端解析结果
- Tavily / Exa / Jina / Firecrawl native fetch 属第三方服务 trust boundary
- TUN fake-IP `198.18/15` 在未显式配置 proxy 时会按非公网地址拒绝；应配置可信 proxy

## 5. Test And QA Focus

- `npm test`：106 passed，9 skipped
- `npm --workspace @bytetrue/pi-vendor run typecheck`：通过
- `npm --workspace @bytetrue/pi-web-search run typecheck`：通过
- `git diff --check`：通过
- direct HTTPS（固定 public IP + SNI）：200
- explicit proxy HTTPS：200
- 本地 CONNECT：NO_PROXY 仍经过 proxy，Basic auth 正确，binary body cancel

## 6. Verdict

**passed**

- Task reviewer：0 blocking / 0 important
- OCR：最终两个人写源码文件均 completed；真实 medium 已修，误报有依赖源码反证
- 可进入 audit 状态回写与 scoped commit；不自动 push
