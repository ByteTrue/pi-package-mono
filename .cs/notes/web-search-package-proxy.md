# web-search 包级 proxy，禁止 setGlobalDispatcher

## 结论

`pi-web-search` 的 proxy 是 **package-scoped**：`proxy.ts` 持有 EnvHttpProxyAgent，provider 用 `fetchWithProxy`。**不要**再 `setGlobalDispatcher`，以免劫持同进程其他扩展的 fetch。

## 触发场景

改 provider HTTP、代理优先级、`NO_PROXY`、与 generic SSRF fetch 的关系。

## 细节

- provider/API：包内 agent + `NO_PROXY`  
- generic `web_fetch`：独立 SSRF-safe dispatcher；任意目标不因 `NO_PROXY` 退回不安全直连  
- `BYTE_PI_WEB_NO_PROXY=1` 可关代理  

## 相关位置

- closed：`.cs/issues/2026/07/11/closed-web-proxy-global-side-effect.md`  
- spec：`.cs/spec/pi-web-search/index.md`  
- 旧 refactor scan：`archive/codestable-legacy/refactors/2026-07-11-web-proxy-ownership/`
