---
doc_type: issue-fix
issue: 2026-07-11-web-proxy-global-side-effect
path: standard
status: review-passed
fix_date: 2026-07-11
related: [web-proxy-global-side-effect-analysis.md, ../../audits/2026-07-11-pi-web-search-0-1-1/finding-09.md, ../../refactors/2026-07-11-web-proxy-ownership/web-proxy-ownership-scan.md]
tags: [proxy, global-state, isolation, transport]
---

# pi-web-search package-scoped proxy 修复记录

## 1. 实际采用方案

采用用户确认的 package-scoped transport：

- `proxy.ts` 不再调用 `setGlobalDispatcher`
- route/noProxy 状态由本包持有
- provider/API 请求通过 `fetchWithProxy`
  - 有本包 proxy：npm undici fetch + package-owned EnvHttpProxyAgent
  - 无本包 proxy：委托 `globalThis.fetch`，保持既有 direct/mock 行为
- 9 个 provider 以 `fetchWithProxy as fetch` 本地 alias 迁移，调用体不改
- generic SSRF fetch 继续使用 `html.ts` 专用 safe direct / ProxyAgent 策略
- `installProxyDispatcher` 名称与返回值保留，但语义改为配置本包 transport

### 第一性原则 pre-pass

- 用户已明确接受移除 global side effect，这是 issue 行为修正，不伪装成 refactor
- 不向 provider constructor/factory 扩散 dispatcher 参数
- 不改 provider request/response、fallback、proxy precedence、NO_PROXY 语义
- package-owned dispatcher 在 route/noProxy 变化与 clear 时 close

## 2. 改动文件清单

- `packages/pi-web-search/src/proxy.ts`
  - package route / EnvHttpProxyAgent / fetch seam
  - 删除动态 undici loader、global dispatcher 安装/恢复状态
- `packages/pi-web-search/src/providers/*.ts`（9 个）
  - 本地 import alias，现有 fetch 调用体不变
- `packages/pi-web-search/src/proxy.test.ts`
  - install / route switch / opt-out 不改变 global dispatcher identity
  - package fetch 真实 CONNECT + auth
  - 无 proxy 委托 global fetch
- `packages/pi-web-search/src/index.ts`、README
  - package-scoped ownership 说明

## 3. 验证结果

- tests-first：旧实现 global identity 测试失败，`fetchWithProxy` 不存在
- proxy tests：8 passed
- pi-web-search：88 passed，9 skipped
- 全仓：132 passed，9 skipped
- 两个 workspace typecheck：通过
- grep：9 个 provider 文件均 import `fetchWithProxy as fetch`
- 真实 CONNECT/auth、HTTP/HTTPS routes、NO_PROXY、invalid replacement、opt-out 全部通过
- `git diff --check`：通过

## 4. 遗留事项

- 无本包 proxy 时委托 `globalThis.fetch`；若其他扩展主动修改 global dispatcher，本包 direct 请求仍会继承宿主环境，这是“未主动污染”而非“隔离所有外部全局状态”
- generic 与 provider 各持有一个用途不同的 package dispatcher cache：generic 必须忽略 NO_PROXY 并执行 SSRF 策略；provider 必须 honor NO_PROXY，不能合并成同一 agent
- `installProxyDispatcher` 的 global side effect 被移除，是本 issue 明确确认的公开行为修正
- 独立 subagent：0 blocking / 0 important；DeepSeek OCR 11 个源码最终均 completed，0 accepted comments（4 条 proxy 评论均由执行顺序/undici API/既有 tests 反证）；review gate passed。待 audit/refactor route 回写与 commit，不 push。
