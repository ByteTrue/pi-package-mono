# pi-web-search

## 这一层是什么

`@bytetrue/pi-web-search` 给 pi agent 提供与常见 coding agent 同类的两个工具：搜索网页、抓取 URL 内容；并用 `/web` 管理提供商、密钥与代理。

## 它负责什么

- **`web_search`**：查询 → 规范化结果（标题 / URL / 摘要）；默认提供商 **exa-free**（无需 key）；可自动 fallback 到其他已配置/keyless 提供商。
- **`web_fetch`**：抓取 URL 文本；`raw=true` 必须走唯一能返回原始 HTML 的 generic 传输；`raw=false` 可 native-first 再 fallback。
- **配置**：`~/.pi/byte-pi-web/config.json`；env 中的 key 优先于文件。
- **代理**：包内 transport，不调用 `setGlobalDispatcher`。
- **安全与预算**：SSRF 防护、响应体 10 MiB 硬预算、搜索 attempt 15s 与字段字节上限、原子写 `0o600`、损坏配置不被 `/web` 覆盖。

## 它不负责什么

- 不管理 `models.json` / 供应商模型列表（那是 pi-vendor）。
- 不保证第三方 native fetch 端点的 SSRF 语义（generic 路径自管）。
- 不把 DuckDuckGo 当作当前默认（上游已移除；默认是 exa-free）。

## 统一语言

- **exa-free**：默认、免 key 的 Exa MCP free 搜索。
- **readConfigResult 三态**：`missing` | `valid` | `invalid`；`/web` 写路径 fail-closed，运行时 `readConfig` 仍可 soft-fail 为 `{}`。
- **package-scoped proxy**：仅本包 provider 路由使用的 EnvHttpProxyAgent / `fetchWithProxy`。
- **generic SSRF fetcher**：独立 dispatcher；任意目标不因 `NO_PROXY` 退回不安全直连。

## 使用路径

| 想完成的事 | 怎么走 |
|---|---|
| 零配置搜索 | 安装扩展后直接 `web_search`（默认 exa-free） |
| 换提供商 / 设 proxy | `/web`；已配置或 keyless 可直接激活 |
| 看当前配置 | `/web --show` |
| 要原始 HTML | `web_fetch` 且 `raw=true` |
| 大陆无代理 | 可选手动选 Bing（keyless）或 Bocha |

## 关键考量

- **默认可用性优先**：exa-free 免 key；Bing 仍可作为中国大陆 keyless 备选。
- **写配置与读运行时分离**：避免为了 soft-start 而在 UI 里覆盖坏文件。
- **预算在编排层统一**：search 的 deadline/字段上限、fetch 的 body 上限，不散落在各 provider 自说自话。
- **proxy 不进全局**：多扩展同进程时只影响本包。

## 当前边界

**做**

- 多提供商 search + 有限 native fetch + generic fallback
- 安全 hardening 与可测的预算契约

**不做**

- 不新增与 Claude/Codex 工具面无关的第三工具
- 不在损坏配置上自动“修复写回”
- 不保证 native provider 端点的隐私/SSRF 边界

## 证据索引（按需）

- 包 README：`packages/pi-web-search/README.md`
- 相关 closed bugs：`.cs/issues/2026/07/11/closed-*.md`
- 旧 audit 原文：`.cs/archive/codestable-legacy/audits/`
