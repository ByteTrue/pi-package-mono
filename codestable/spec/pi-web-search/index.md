# pi-web-search

## 这一层是什么

`@bytetrue/pi-web-search` 给 Pi agent 提供高频 `web_search` / `web_fetch`，并用 `/web` 在 TUI 内完成 provider、key、base URL 与 proxy 配置。

## 它负责什么

- **`web_search`**：查询 → 规范化标题 / URL / 摘要；默认 **exa-free**，无需 key。
- **可选 provider**：省略 `provider` 时使用 `/web` 当前配置；提供时用于本次调用。一次调用只联系一个 provider。
- **`web_fetch`**：无论 search provider 是谁，raw 与 extracted 都只走 package 的 SSRF-safe generic transport。
- **完整 TUI 配置**：安装后无需读 GitHub 或手写 JSON，即可在 `/web` 配 provider、key、base URL、proxy；`/web --show` 查看脱敏状态。
- **代理凭据显示**：proxy URL 可含 userinfo 供 transport 使用，但 `/web --show`、provider menu、placeholder 与 notification 只显示脱敏 scheme/host/port。
- **配置**：`~/.pi/byte-pi-web/config.json`（`PI_CONFIG_DIR` 可覆盖）；env key/base URL 优先于文件。
- **代理**：package-scoped transport，不调用 `setGlobalDispatcher`。
- **安全与预算**：URL 禁止 embedded credentials；direct route 在 DNS、redirect、connect-time 守 SSRF 边界；显式 proxy 模式仍拒绝 private hostname/IP literal，但 proxy 是目标 DNS 的受信边界；search provider body 2 MiB，generic fetch decoded body 10 MiB；每次 provider attempt 15 秒；结果字段与总量有 UTF-8 预算；超限取消 stream。
- **写入安全**：配置原子写 `0600`；损坏配置不被 `/web` 覆盖；旧 `autoFallback` 在下次保存时删除且不影响其它字段。

## 它不负责什么

- 不管理 `models.json` / 模型 provider（那是 pi-vendor）。
- 不做隐式跨 provider fallback。
- 不把 search provider 选择耦合到 URL fetch transport。
- 不把 DuckDuckGo 当默认；当前默认是 exa-free。
- 不新增第三个 Agent tool。

## 统一语言

- **exa-free**：默认、免 key 的 Exa MCP free search。
- **optional provider**：`web_search(provider=...)` 为单次可选覆盖；省略即使用 `/web` 当前配置。
- **readConfigResult 三态**：`missing` | `valid` | `invalid`；`/web` 写路径 fail-closed，运行时 `readConfig` 可 soft-fail 为 `{}`。
- **package-scoped proxy**：仅本包 provider 路由使用的 proxy dispatcher。
- **generic SSRF fetcher**：`web_fetch` 唯一传输；任意目标不会因 `NO_PROXY` 退回不安全直连。

## 使用路径

| 想完成的事 | 怎么走 |
|---|---|
| 零配置搜索 | 安装后直接 `web_search`（默认 exa-free） |
| 换 provider / 设 key / base URL / proxy | `/web` |
| 看当前配置 | `/web --show` |
| 搜索 | `query` 必填；`provider`、`max_results` 可选 |
| 抓可读正文 | `web_fetch`（`raw` 省略或 false） |
| 要原始 HTML | `web_fetch(raw=true)` |
| 大陆无代理 | 在 `/web` 显式选择 Bing（keyless）或 Bocha |

## 关键考量

- **TUI 闭环优先**：面向用户安装的复杂配置不能退化成“看 README 手改 JSON”。
- **一次调用、一个外发目标**：隐私、费用、延迟和失败都保持可观察。
- **search / fetch 解耦**：搜索服务不隐式接收用户随后抓取的任意 URL。
- **共享 bounded reader**：所有 search provider 的成功和错误 body 使用同一 2 MiB reader；JSON 解析错误不回显 body。
- **proxy 不进全局**：避免同进程扩展互踩。
- **最小常驻定义**：两工具只保留 description、schema、execute；无 `promptSnippet`、`promptGuidelines` 或 custom renderer。

## 当前边界

**做**

- 9 个现有 search provider，显式单 provider 调用
- 完整 `/web` TUI
- 唯一 generic `web_fetch`
- SSRF、timeout、abort、body/result budget、配置损坏保护

**不做**

- 隐式 fallback / `autoFallback`
- native provider fetch
- 第三个工具或 Web 管理面
- 在损坏配置上自动修复写回

## 验证

```bash
npm --workspace @bytetrue/pi-web-search test
npm --workspace @bytetrue/pi-web-search run typecheck
npm pack --workspace @bytetrue/pi-web-search --dry-run
```

真实 provider E2E 需显式运行 `test:e2e`，默认 suite 跳过。

## 证据索引（按需）

- 包 README：`packages/pi-web-search/README.md`
- 已关闭 agent surface 变更：`codestable/epics/004-x-image-gen-web-agent-surface/spec.md`
- 相关 closed bugs：`codestable/issues/001-x-atomic-config-write.md` 至 `codestable/issues/011-x-web-search-budgets.md`
- 旧 audit 原文：`codestable/archive/codestable-legacy/audits/`
