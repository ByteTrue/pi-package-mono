# billion-context 换代：ACP 工具由代理 manifest 注册，子进程拿到的是死工具

一次性结论，供将来再遇到「子进程里多出几个用不了的扩展工具」时对照。勘察对象 `billion-context@0.1.174`（`~/.pi/agent/npm/node_modules/billion-context`）。

## 架构变化：扩展只管注册，干活的是本地代理

- `package.json`：`pi.extensions = ["./dist/agent/pi-native.js"]`，`bin = { bili, bili-proxy } → ./dist/index.js`。
- 0.1.82 时代的「扩展自己往 messages 里注 nudge」没有了：`grep -c nudge dist/agent/pi.js` = **0**，只剩 `dist/index.js`（代理）里的 `nudge INJECT T1` / `pendingT1`。
- 压缩、催压、会话状态都在**本地代理** `http://127.0.0.1:18787`；扩展与代理之间是 HTTP，不是模型流量。

## 工具注册不依赖模型流量（这是最容易误判的一点）

`dist/agent/pi.js` 的 `registerTools` 是**单独发 HTTP 拉 manifest**，成功就一次性 `pi.registerTool`：

```js
let proxyBase = proxyBaseForCtx(ctx);
if (proxyBase === undefined && awaitNativeOrigin) proxyBase = await awaitNativeProxyOrigin();
if (proxyBase === undefined) return;
...
try { tools = await fetchManifest(proxyBase) } catch (err) { state.retryAt = Date.now() + wait; return }
if (state.toolsFor !== sid) { for (const t of tools) pi.registerTool(manifestToTool(proxyBase, t, agent)); state.toolsFor = sid }
```

所以「模型请求有没有进代理」只决定**工具能不能调用成功**，不决定**工具能不能注册出来**。5 个工具（`compress` / `decompress` / `search_context` / `acp_status` / `acp_cache`）不是 pi core 提供的（pi dist 里 `grep search_context`、`grep acp_cache` 皆 0 命中），也不来自任何 agent 文档。

## 开关语义：`BILLION_CONTEXT_PLUGIN`，且必须在**子进程**里

```js
function detectProxyBase(baseUrl) {
  if (process.env.BILLION_CONTEXT_PLUGIN === "0") return void 0;
  return proxyBaseFromUrl(baseUrl) ?? proxyBaseFromEnv();   // proxyBaseFromEnv 读 BILLION_CONTEXT_PROXY
}
```

- 只有 `"0"` 是关；`BILLION_CONTEXT_PROXY` 存在就足以让注册发生。
- `BILLION_CONTEXT_PROXY` 由 bili launcher 设进**父进程 env**，因此子进程天然继承 → 子进程照样拉 manifest、照样注册。
- 子进程的模型请求不进代理（跑子进程前后 `request:` / `forward POST` / `acp-usage` 计数不变，`plugin-conversations.json` 只有主会话一条），所以这 5 个工具在子进程里**调用即 404** `unknown plugin conversation (no model request has arrived with this conversation id yet ...)`。

两代失败模式不同，别混：

| 版本 | 子进程里发生什么 |
|---|---|
| `billion-context-pi@0.1.82` | nudge 追进子会话 → 子 agent 被催着 `compress` → `Tool compress not found` |
| `billion-context@0.1.174` | 工具注册得出来但全是死的 → 调用即 404 |

## 处置

`pi-subagent` 的 `subagent.env` 透传（issue 101）：

```json
{ "subagent": { "env": { "BILLION_CONTEXT_PLUGIN": "0" } } }
```

实测工具表：默认 **17 个（ACP 5 个）** → 带开关 **12 个（ACP 0 个）**。只影响 `general-purpose`（不写 `tools:`、继承全量）；`explore` / `plan` 的 `tools:` 白名单本来就挡住了。

## 附带事实：`pi --tools` 是替换型 allowlist

`--tools` 不是「在默认集合上增删」，而是**替换**整个工具表。因此第三方扩展注册的工具会**默认进入每个子进程**，除非角色文档用 `tools:` 把表换窄。这就是为什么「只读角色没被污染、默认角色被污染」。
