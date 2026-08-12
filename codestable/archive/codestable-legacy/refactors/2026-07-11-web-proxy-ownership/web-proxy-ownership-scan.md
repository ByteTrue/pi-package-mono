---
doc_type: refactor-scan
refactor: 2026-07-11-web-proxy-ownership
status: routed-to-issue-completed
scope: packages/pi-web-search proxy ownership（proxy.ts / index.ts / html.ts / providers）
summary: 前置检查 1 命中；旧 finding 部分已修，剩余目标会改变进程级可观察行为
source_finding: .codestable/audits/2026-07-11-pi-web-search-0-1-1/finding-09.md
---

# web-proxy-ownership scan

## 总览

- 扫描范围：`proxy.ts`、`index.ts`、`html.ts`、9 个 provider fetch 调用点、`proxy.test.ts`
- 当前旧 finding 中的 **状态与释放缺口已部分过期**：
  - 已按 HTTP/HTTPS 记录 route
  - opt-out / invalid replacement 状态已有测试
  - 本模块创建的旧 global dispatcher 会 close
  - generic fetch 使用独立 ProxyAgent，不受 NO_PROXY 绕回不安全 direct
- 仍存在：扩展加载时 `setGlobalDispatcher`，使其他扩展/SDK 的 global fetch 也被本包配置改路由；opt-out 恢复的是新 `Agent`，不是安装前未知 dispatcher
- scan 前置检查：**第 1 条命中（行为改动混入）**，不进入 refactor 清单勾选/design

## ⛔ refactor 流程中止

### 命中前置检查：第 1 条 —— 目标会改变外部可观察行为

证据：

- `packages/pi-web-search/src/index.ts:27-34`：加载扩展即安装 global dispatcher
- `packages/pi-web-search/src/proxy.ts:93-120`：通过 undici `setGlobalDispatcher` 改写进程级 fetch
- `packages/pi-web-search/src/providers/*.ts`：9 个 provider 依赖 global fetch，因此 package-scoped 方案需要迁移真实调用 seam
- `packages/pi-web-search/src/index.ts:24`：`installProxyDispatcher` 还是包导出 API；改成仅 package-scoped 会改变直接调用者观察到的语义

### 为什么不能标成“行为等价”

若改成 package-scoped transport：

- pi-web-search 的 search/fetch 仍走同一 proxy（目标行为不变）
- **其他扩展 / SDK 的 global fetch 将不再被 pi-web-search proxy 配置影响**（进程外部可观察行为改变）
- `installProxyDispatcher` 直接调用者不再获得原有 global side effect（导出 API 语义改变）

这正是想消除的副作用，但它仍是行为修正，不是 refactor。

## 建议路由

转 `cs-issue`，先确认产品边界：

> `/web` 的 proxy 应只作用于 pi-web-search 自己的 provider/generic 请求，不应改写同一 Pi 进程中其他扩展/SDK 的 global fetch。

若确认：issue 推荐方案为 package-scoped transport seam：

1. `proxy.ts` 持有包内 EnvHttpProxyAgent / direct transport，不调用 `setGlobalDispatcher`
2. provider 统一通过包内 fetch function；无 proxy 时仍委托 `globalThis.fetch`（保留现有测试/直连行为）
3. generic SSRF transport 继续使用其专用 direct/ProxyAgent 策略
4. 保留 `installProxyDispatcher` 名称作为配置入口，但更新导出语义与 README（这是显式行为修正）
5. 加集成测试：本包 provider 经过 proxy，同时独立 `globalThis.fetch` dispatcher 不被替换

## 当前状态

- refactor 目录：`.codestable/refactors/2026-07-11-web-proxy-ownership/`
- scan：1 份（本文件）
- design/checklist/apply-notes：0
- 代码改动：0
- 可安全继续：是；用户确认产品边界后，同 run 路由 `cs-issue`

## 路由结果

用户确认 package-scoped 产品边界后，已由 `.codestable/issues/2026-07-11-web-proxy-global-side-effect/` 完成修复与 `subagent+ocr` review；audit Finding 9 已 fixed。本 refactor 正确中止，无 design/checklist/apply。
