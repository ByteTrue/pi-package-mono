---
doc_type: issue-report
issue: 2026-07-11-web-proxy-global-side-effect
status: confirmed
severity: P2
summary: pi-web-search proxy 配置会改写整个 Pi 进程的 global fetch 路由
tags: [proxy, global-state, isolation, web-search]
---

# pi-web-search 全局代理副作用 Issue Report

## 1. 问题现象

加载 pi-web-search 后，`installProxyDispatcher` 调用 undici `setGlobalDispatcher`。`/web` 的 proxy 不仅影响本包 search/fetch，还会改变同一 Pi 进程其他扩展、SDK 和用户代码的 global `fetch` 路由。

前序修复已补 route 状态、opt-out、invalid replacement 与 owned dispatcher close；进程级作用域本身仍存在。

## 2. 复现步骤

1. 在同一 Pi 进程加载 pi-web-search，并配置 `/web proxy`
2. 由另一个扩展或 SDK 调用 global `fetch`
3. 观察：该请求也经过 pi-web-search 配置的 proxy
4. 设置 opt-out/无 proxy 后，global dispatcher 被替换为本包新建 Agent，而不是保持安装前未知 dispatcher

复现频率：稳定。

## 3. 期望 vs 实际

**期望行为**：`/web` proxy 只作用于 pi-web-search 自身 provider/generic 请求；同进程其他 global fetch 的 dispatcher identity 与路由不被本包修改。

**实际行为**：本包写进程全局 dispatcher，ownership 越过 package 边界。

## 4. 环境信息

- 模块：`packages/pi-web-search/src/proxy.ts`、`index.ts`、9 个 provider
- 来源：audit Finding 9；refactor precheck 路由记录 `.codestable/refactors/2026-07-11-web-proxy-ownership/`
- 当前 HEAD：`eeb8d0b`

## 5. 严重程度

**P2** — 不一定立即报错，但会造成跨扩展隐式耦合、隐私/路由意外与 reload 生命周期风险。

## 备注

用户明确确认产品边界：proxy 仅作用于 pi-web-search，不得改写其他扩展/SDK global fetch。
