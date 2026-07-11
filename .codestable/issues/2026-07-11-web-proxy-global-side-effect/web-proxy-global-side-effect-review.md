---
doc_type: issue-review
issue: 2026-07-11-web-proxy-global-side-effect
status: passed
reviewer: subagent+ocr
reviewed: 2026-07-11
round: 1
---

# web-proxy-global-side-effect 代码审查报告

## 1. Scope And Inputs

- Report / analysis / fix-note：同目录，package-scoped boundary confirmed
- Refactor route scan：`.codestable/refactors/2026-07-11-web-proxy-ownership/`
- Diff：`proxy.ts`、index/README、9 provider imports、proxy tests
- Baseline：clean，起点 commit `eeb8d0b`

### Independent Review

- 环节 A：pi-subagents reviewer fresh，completed
- 环节 B：DeepSeek OCR；首轮 10/11 completed，失败的 `proxy.ts` 单文件重跑 completed
- Merge：所有 findings 本地事实核验
- Gate effect：none

## 2. Diff Summary

- 删除所有 `setGlobalDispatcher` / 动态 undici global loader / owned-global state
- package-owned EnvHttpProxyAgent + `fetchWithProxy`
- 9 provider 本地 import alias 迁移
- generic SSRF transport 保持独立
- global dispatcher identity / real CONNECT / auth / global fallback tests

## 3. Adversarial Pass

覆盖：漏迁 provider、import cycle、global identity、HTTP/HTTPS/ALL_PROXY、NO_PROXY、auth、invalid replacement、opt-out、route/noProxy key、并发 route switch、graceful close、npm/global Response ABI、无 proxy global fallback。

## 4. Findings

### blocking

none

### important

none

### suggestion

- route switch identity 已补持久测试；NO_PROXY/ALL_PROXY/双协议有状态测试与独立真实探针，可继续扩展为更多本地网络集成测试。
- close 无独立 spy；当前实现、graceful integration cleanup 与 undici close contract 已覆盖。

### praise

- 9 个 provider 无遗漏，调用体不变
- package route/noProxy 全部进入幂等 key
- 新 dispatcher 构造成功后才原子发布；再 graceful close 旧实例
- generic 与 provider dispatcher 按不同安全语义分离合理
- global dispatcher install/switch/opt-out identity 保持

### residual-risk

- 无本包 proxy 时委托宿主 global fetch；其他扩展主动污染 global 仍可影响 direct 请求
- `close()` 无 timeout，可能等待未消费的在途 response；当前 provider 消费/cancel 与 search deadline 降低该风险
- 9 个 live provider E2E 仍按配置 skipped

### OCR 事实核验

- 并发 CAS high 不采纳：函数在首次 await 前同步完成状态发布，await 后无状态回写；并发调用最终指向最后发布的新 agent
- close-abort high 不采纳：使用 undici graceful `close()`，不是 `destroy()`
- Response cast medium 不采纳：当前使用的 body/headers/status/text/json/ok 是 Fetch 标准结构，已被 provider/html/stream tests 与 typecheck 覆盖；包装会引入额外 stream 适配
- NO_PROXY whitespace low 不采纳：EnvHttpProxyAgent 内部按逗号与 whitespace 解析；key 差异最多导致保守重建

## 5. Test And QA Focus

- pi-web-search：88 passed，9 skipped
- 全仓：132 passed，9 skipped
- 两个 workspace typecheck：通过
- proxy tests：8 passed
- grep：9/9 provider import seam；生产源码无 `setGlobalDispatcher`
- DeepSeek OCR：11/11 source files completed

## 6. Verdict

**passed** — blocking 0、important 0、reviewer `subagent+ocr`。
