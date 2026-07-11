---
doc_type: issue-analysis
issue: 2026-07-11-web-fetch-response-budget
status: confirmed
root_cause_type: missing-guard
related: [web-fetch-response-budget-report.md]
tags: [performance, security, streaming, response-budget]
---

# web_fetch 响应预算根因分析

## 1. 问题定位

| 关键位置 | 说明 |
|---|---|
| `packages/pi-web-search/src/html.ts:369-378` | generic fetch 直接 `await res.text()`，无 header 预检或流式字节计数 |
| `packages/pi-web-search/src/tools.ts:304-313` | `truncateHead` 与 temp spill 发生在完整 body 返回后，只保护模型上下文 |
| `packages/pi-web-search/src/providers/tavily.ts:40-59` | search / extract 使用无界 `text()` / `json()` |
| `packages/pi-web-search/src/providers/exa.ts:38-57` | search / contents 使用无界 `text()` / `json()` |
| `packages/pi-web-search/src/providers/jina.ts:32-49` | search / reader 使用无界 `text()` / `json()` |
| `packages/pi-web-search/src/providers/firecrawl.ts:35-54` | search / scrape 使用无界 `text()` / `json()` |

## 2. 失败路径还原

**正常路径**：HTTP response → 完整读取 → HTML 提取 / JSON 解析 → `FetchResponse.text` → `truncateHead` → 超出上下文部分写 temp。

**失败路径**：不可信服务持续返回 / 返回巨大解压 body → `Response.text/json()` 无界累积 → 在 `truncateHead` 之前卡住或 OOM → 无输出、无 temp 路径。

**分叉点**：所有 response body consumer 都缺少共享的流式字节预算；不能靠调用完成后的输出截断补救。

## 3. 根因

**根因类型**：missing-guard

**根因描述**：系统只有“模型输出预算”，没有“网络响应预算”。Fetch API 的 `text()` / `json()` 会完整缓冲 body；`Content-Length` 既未检查，也不能防止缺失、撒谎或解压膨胀响应。

**是否有多个根因**：一个共享根因，分布在 generic 与四个 native provider consumer。

## 4. 影响面

- **影响范围**：generic HTML/raw/text；Tavily / Exa / Jina / Firecrawl 的 fetch 与同模块 search API body
- **潜在受害模块**：`web_fetch` 首要；同样 reader 接入 provider search 后可顺带封住 API error/JSON body 的无界读取，但不改变 Finding 8 的“最终 search 输出长度”问题
- **数据完整性风险**：无持久化损坏；风险是进程 OOM、连接占用和任务中断
- **严重程度复核**：维持 P1

## 5. 修复方案

### 方案 A：10 MiB 解压后硬预算 + 共享流式 reader（推荐）

- **做什么**：新增 `response-body.ts`，流式读取 `Response.body`，累计实际 chunk bytes；可信 `Content-Length` 超限时提前 cancel，流中越界立即 cancel；提供 text / JSON 两个 helper。generic 与四个 native provider 全部改用 helper
- **优点**：根因一次封口；不信任 header；内存有明确上界；不新增依赖；预算内行为与 temp spill 保持一致
- **缺点 / 风险**：>10 MiB 页面从“可能成功但危险”变为明确报错；字符串/JSON 解析仍需要预算内完整 body
- **影响面**：新增 helper + 测试，修改 `html.ts` 与四个 provider，README 说明

### 方案 B：无限流式落盘，再从磁盘提取

- **做什么**：网络 body 全量写 temp，不驻留内存；HTML / JSON 后续从文件处理
- **优点**：可保留任意大原始内容
- **缺点 / 风险**：现有 `htmlToText` / `JSON.parse` 仍要求整串，除非再引入增量 HTML/JSON parser；把 OOM 变成磁盘耗尽；temp 生命周期问题扩大
- **影响面**：下载、解析、temp 管理重构，明显超出本 issue

### 方案 C：只检查 Content-Length

- **做什么**：header 超过阈值就拒绝，否则继续 `text/json()`
- **优点**：改动最小
- **缺点 / 风险**：缺 header、虚假 header、压缩炸弹都可绕过，不能解决根因
- **影响面**：小，但安全性不足

### 推荐方案

**推荐方案 A**：固定 **10 MiB（10 × 1024 × 1024）解压后 body 上限**。这是最少代码即可建立真实资源边界的方案；保留预算内已有行为，不引入 parser / 新依赖 / 配置项。

## Checkpoint

用户确认：采用方案 A，固定 10 MiB 解压后响应预算；进入 tests-first 修复。
