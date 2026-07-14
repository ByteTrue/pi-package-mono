---
doc_type: issue-analysis
issue: 2026-07-11-web-proxy-global-side-effect
status: confirmed
root_cause_type: state-pollution
related: [web-proxy-global-side-effect-report.md]
tags: [proxy, global-state, transport-seam]
---

# pi-web-search 全局代理副作用根因分析

## 1. 问题定位

| 关键位置 | 说明 |
|---|---|
| `packages/pi-web-search/src/index.ts:27-34` | 扩展加载即安装 global dispatcher |
| `packages/pi-web-search/src/proxy.ts:93-120` | `setGlobalDispatcher` 与 owned global agent 状态 |
| `packages/pi-web-search/src/providers/*.ts` | 9 个 provider 直接调用 global fetch，迫使 proxy 在全局层注入 |
| `packages/pi-web-search/src/html.ts` | generic SSRF transport 已经是 package-scoped dispatcher，可作为边界参照 |

## 2. 失败路径还原

**正常目标路径**：配置 proxy → 本包 provider/generic 请求通过代理 → search/fetch 行为不变。

**失败路径**：为了让 provider 的裸 `fetch` 走代理 → 替换进程 global dispatcher → 非本包请求也被代理 → package 配置泄漏为进程状态。

**分叉点**：provider 的 transport seam 放在 global runtime，而不是 pi-web-search module interface。

## 3. 根因

**根因类型**：state-pollution

**根因描述**：provider 直接依赖 ambient global fetch；`proxy.ts` 只能通过改写 ambient global dispatcher 注入代理。虽然本模块已开始跟踪/close owned agent，但无法收窄作用域。

**是否有多个根因**：单一 seam/ownership 根因。

## 4. 影响面

- **影响范围**：本包 9 个 provider、扩展初始化、proxy tests、公开 `installProxyDispatcher` 语义
- **潜在受害模块**：同 Pi 进程任何 global fetch caller
- **数据完整性风险**：无；存在路由、隐私与连接生命周期风险
- **严重程度复核**：维持 P2

## 5. 修复方案

### 方案 A：package-scoped fetch seam（已确认）

- `proxy.ts` 只保存 package route 与 package-owned EnvHttpProxyAgent，不调用 `setGlobalDispatcher`
- 新增包内 `fetchWithProxy`：有 proxy 时用 npm undici fetch + package dispatcher；无 proxy 时委托 `globalThis.fetch`
- 9 个 provider 通过本地 import alias 使用该 seam，调用体不改
- generic SSRF transport 保留专用 direct/ProxyAgent 策略
- `installProxyDispatcher` 保留名称与返回值，语义改为“配置本包 transport”
- **优点**：真正满足确认边界；调用点机械迁移；无 constructor/业务 API 改动
- **缺点 / 风险**：导出函数不再产生 global side effect（本 issue 明确接受的行为修正）；需覆盖所有 provider 调用点

### 方案 B：保存并恢复原 global dispatcher

- **优点**：改动小
- **缺点**：active 期间仍污染其他扩展，不满足确认边界

### 方案 C：dispatcher 经 provider constructor 注入

- **优点**：依赖最显式
- **缺点**：修改 9 个 constructor/factory/types，接口扩散大；现阶段只有一个 package transport seam，过度设计

### 选定方案

用户在 refactor 路由说明后明确“确认”，选择 **方案 A**。

## 6. 验收契约

1. 配置 proxy 后，本包 provider 请求仍经过正确 HTTP/HTTPS/ALL_PROXY route 与 NO_PROXY
2. generic SSRF fetch 行为不变
3. `getGlobalDispatcher()` identity 在 install / opt-out / route switch 前后不变
4. 无 proxy 时 provider 仍调用 `globalThis.fetch`，既有 mock/tests 不变
5. grep provider 生产文件不再存在无本地 seam 的 ambient fetch 调用
6. owned package dispatcher 在 route 变化/清除时 close
