---
doc_type: audit-index
audit: 2026-07-11-packages-scan
scope: packages/pi-vendor + packages/pi-web-search（全源码，不含 node_modules）
created: 2026-07-11
status: active
total_findings: 6
dimensions: [bug, security, performance, maintainability]
note: arch-drift 跳过（.codestable/requirements/adrs/ 为空）
---

# packages-scan 审计报告

## 范围

- `packages/pi-vendor/src/**`（/vendor 自定义 provider，读写 `~/.pi/agent/models.json`）
- `packages/pi-web-search/src/**`（web_search / web_fetch / /web，含 providers）
- 维度：bug / security / performance / maintainability
- 跳过：arch-drift（无 ADR）

## 总评

两包整体质量中上：有测试、fail-soft 配置、SSRF 有基础 guard。主要风险集中在 **安全边界不完整**（SSRF 可被 redirect / 第三方 provider 绕过；明文 API key 落盘）和 **配置文件非原子写**（丢配置/损坏）。文档与代码默认 provider 不一致会误导排障。未发现明显性能热点；可维护性问题以超长 UI 命令与重复 `cloneJson` 为主。

共 **6** 条：security 2、bug 2、maintainability 2。无 P0 必须立刻修；建议优先处理 SSRF 与配置写。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | security | P1 | high | web_fetch SSRF 只校验初始 URL，redirect 与 provider fetch 可绕过 | [finding-01.md](finding-01.md) |
| 2 | security | P1 | high | /web 把 API key 明文写入 config.json | [finding-02.md](finding-02.md) |
| 3 | bug | P1 | medium | models.json / config.json 非原子写，并发或中断可能损坏 | [finding-03.md](finding-03.md) |
| 4 | bug | P2 | high | 文档/注释仍写默认 DuckDuckGo，实际默认 Bing | [finding-04.md](finding-04.md) |
| 5 | maintainability | P2 | high | command.ts 近 600 行单体交互流 | [finding-05.md](finding-05.md) |
| 6 | maintainability | P2 | medium | index 注释与 tools 注释默认 provider 过时 | [finding-06.md](finding-06.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 0 | 1 | 1 | 2 |
| security | 0 | 2 | 0 | 2 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 2 | 2 |
| arch-drift | — | — | — | 跳过 |
| **合计** | **0** | **3** | **3** | **6** |

## 下一步建议

- **P1 本迭代修**
  - Finding 1 → `cs-issue`：redirect 后 re-check 私网；provider 路径也过 SSRF guard
  - Finding 2 → `cs-issue`：优先 env 引用，避免明文 key；或写文件权限 0600 + 明确文档风险
  - Finding 3 → `cs-issue`：write temp + rename 原子写
- **P2 有空再看**
  - Finding 4 / 6 → 文档与注释对齐 Bing 默认（可合并一次小改）
  - Finding 5 → `cs-refactor`：拆 manageModels / editProviderDraft 等
- 选中某条 finding 后可直接开 `cs-issue` / `cs-refactor`，本 audit 不定修。

## 修复进度（本轮）

| Finding | 状态 | Issue 目录 |
|---|---|---|
| 1 SSRF redirect | fixed（rebase 后仍有效） | `.codestable/issues/2026-07-11-web-fetch-ssrf-redirect/` |
| 2 key 文件权限 | fixed（0600；未禁明文） | `.codestable/issues/2026-07-11-web-config-key-perms/` |
| 3 原子写 | fixed | `.codestable/issues/2026-07-11-atomic-config-write/` |
| 4+6 默认 provider 注释 | **superseded** | 上游 0.1.1 默认改为 `exa-free`，删除 DDG；以 registry 为准 |
| 5 command.ts 拆分 | deferred | 未做（P2 重构，另开 cs-refactor） |

## 上游对齐说明

审计在旧树完成（默认 Bing + DDG）。rebase 到 `origin/main`（pi-web-search 0.1.1）后：产品决策以上游为准；仅保留 SSRF / 原子写+0600 类补丁。
