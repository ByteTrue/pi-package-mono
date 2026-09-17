---
doc_type: audit-finding
audit: 2026-07-11-pi-web-search-0-1-1
finding_id: "bug-01"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: fixed
---

# Finding 02：显式 proxy 可能被小写 env 覆盖，ALL_PROXY 被报告已安装但实际未使用

## 速答

代码声称 config proxy 优先并支持 `ALL_PROXY`，但它只改大写 env；固定版本 undici 先读小写 env 且完全不读 `ALL_PROXY`，因此返回值与实际路由可不一致。

## 关键证据

- `packages/pi-web-search/src/proxy.ts:20` — 检测列表包含大小写 HTTP(S)_PROXY 与 ALL_PROXY
- `packages/pi-web-search/src/proxy.ts:50-62` — 显式 config 只覆盖 `HTTP_PROXY` / `HTTPS_PROXY`，随后把 `ALL_PROXY` 也视为有效 proxy
- `packages/pi-web-search/src/proxy.ts:73-77` — 无参数创建 `new EnvHttpProxyAgent()`，并把检测到的字符串记为 `installedProxy`
- `node_modules/undici/lib/dispatcher/env-http-proxy-agent.js:26,33`（lockfile 固定 undici 8.5.0）— 读取顺序是 `http_proxy ?? HTTP_PROXY`、`https_proxy ?? HTTPS_PROXY`，无 `ALL_PROXY`
- `packages/pi-web-search/README.md:72-80` — 文档声称支持 `ALL_PROXY`，并称显式 config 是最可靠、优先于启动环境
- `packages/pi-web-search/src/proxy.test.ts:8-22` — 仅测 no-op / opt-out，未验证真实 dispatcher 选择

## 影响

环境已有小写 proxy 时，用户在 `/web` 配置的显式 proxy 可能不生效；只有 `ALL_PROXY` 时函数返回“已应用”但请求直连。在受限网络中表现为 provider 持续失败；若旧小写 proxy 不可信，也会把流量送到非预期代理。

## 修复方向

直接把 `httpProxy` / `httpsProxy` / `noProxy` 传给 `EnvHttpProxyAgent`；明确映射或移除 `ALL_PROXY` 支持，并补真实路由/构造参数测试。

## 建议动作

`cs-issue`，这是可由当前依赖实现直接证明的功能与路由错误。

## 修复结果

在 Finding 1 的安全 transport review-fix 中一并封口：显式配置直接传 Env agent、大小写 env 与 `ALL_PROXY` 归一为 HTTP/HTTPS 分协议状态、跨协议 redirect 每跳选 route；真实 CONNECT / Basic auth / NO_PROXY 测试通过。记录见 `.codestable/issues/2026-07-11-web-fetch-ssrf-host-resolution/`。
