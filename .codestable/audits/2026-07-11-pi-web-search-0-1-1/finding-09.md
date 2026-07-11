---
doc_type: audit-finding
audit: 2026-07-11-pi-web-search-0-1-1
finding_id: "maintainability-01"
nature: maintainability
severity: P2
confidence: high
suggested_action: cs-refactor
status: open
---

# Finding 09：proxy 通过全局 dispatcher 改写整个 Pi 进程且无完整恢复/释放模型

## 速答

扩展加载时调用 undici `setGlobalDispatcher`，影响同一 Pi 进程所有 global fetch；代码只记 proxy 字符串和部分 env，没有保存旧 dispatcher，也没有关闭被替换 agent。

## 关键证据

- `packages/pi-web-search/src/index.ts:27-34` — 扩展注册前无条件安装 proxy dispatcher
- `packages/pi-web-search/src/proxy.ts:22-31` — 状态只保存 `installedProxy` 与大写 proxy env，没有旧 dispatcher / agent 引用
- `packages/pi-web-search/src/proxy.ts:47-48` — opt-out 直接返回；若此前已安装，不恢复 dispatcher 或环境
- `packages/pi-web-search/src/proxy.ts:64-79` — 切换/清除时设置新的全局 Agent/EnvHttpProxyAgent，但未 close 旧实例
- `packages/pi-web-search/src/proxy.ts:83-85` — 注释明确 global symbol 会影响 built-in fetch

## 影响

`/web` 的代理选择会隐式改变其他扩展/SDK 的网络路由；热重载或切换配置后旧连接池可能残留。功能可用，但 ownership 和卸载语义不清，后续 proxy 修复容易制造跨包回归。

## 修复方向

优先把 dispatcher 显式注入本包请求；若必须全局安装，则保存并恢复原 dispatcher，持有并关闭自建 agent，并定义 opt-out / reload 生命周期。

## 建议动作

`cs-refactor`；若与 Finding 02 同批，先由 issue 定义正确行为，再做最小生命周期收口。
