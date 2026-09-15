---
kind: issue
title: "pi-mcp：自研最小 MCP 适配器"
type: feature
status: open
created: 2026-09-15
---

# pi-mcp：自研最小 MCP 适配器

## 做成以后是什么样

新包 `packages/pi-mcp`（`@bytetrue/pi-mcp`）替代 `pi-mcp-adapter`：正常配置 MCP server（与主流宿主同构的配置文件布局）、正常调用，工具上下文管理学 pi-mcp-adapter 的核心设计。供应链上只依赖 registry 正式版 `@modelcontextprotocol/client@2.0.0` + `@modelcontextprotocol/core@2.0.0`（2.32.0 及更早使用的正是这两个正式版），彻底消除 pkg.pr.new 未发布 PR 构建的 URL tarball 依赖（npm 12 `allow-remote` 默认收紧后断更的那类问题）。

**范围：**

1. **配置面**（与 pi-mcp-adapter / Claude Code / Cursor 同构，覆盖层顺序一致）：
   - `.mcp.json`（项目）→ `~/.config/mcp/mcp.json`（用户全局共享）→ `~/.agents/mcp.json` / `~/.agents/mcp/mcp.json` → `~/.pi/agent/mcp.json`（Pi 全局覆盖）→ `.pi/mcp.json`（Pi 项目覆盖）；同名 server 高优先级覆盖。
   - `mcpServers` 条目：`command`/`args`/`env`/`cwd`（stdio）或 `url` + `headers`（HTTP）；`type: stdio|http`；`disabled`。
   - 常规 server 级选项：`env` 继承、`cwd`、`disabled`、生命周期 `lazy`（默认）/`eager`。
2. **上下文管理四件套（核心，学 pi-mcp-adapter）**：
   - 单一 `mcp` proxy tool（目标 ~200 tokens）：`{}` 状态 / `{server}` 列工具 / `{search}` 排名检索（分页 + regex）+ Pi 工具 / `{describe}` / `{tool, args}` 调用。
   - 磁盘元数据缓存（`~/.pi/agent/mcp-cache.json`，configHash 键控）：search/list/describe 离线可用，server 不启动也能查。
   - lazy connect：首次工具调用才连接；空闲断连（默认 10 min）；下次调用自动重连。
   - output guard：文本 50 KiB / 2,000 行上限，超出截断留头预览 + 全文落 0600 temp 文件回路径；图片 content block 原样透传。
3. **顺手加的 5 个高价值小件**：
   - **npx 直连解析**：stdio server `command: npx` 解析为直接二进制路径（npm 父进程 ~143 MB），带 `mcp-npx-cache.json`；解析失败回退原始 command。
   - **directTools 简化版**：`true` / `["tool_a"]` 两形态，静态从缓存注册；无热加载、无 freeze、无 search-activated 模式。
   - **server `instructions`**：缓存捕获，`{server}` 列表带预览，`{instructions: name}` 取全文。
   - **名字容错**：`describe`/`tool` 解析失败时返回 top 建议；连字符/下划线模糊匹配。
   - **searchKeywords**：server 级额外检索词表（key 为原始名/前缀名/glob `*`，词按描述权重参与排名，仅影响检索面）。
   - **prompts 注册为斜杠命令**：`/mcp__<server>__<prompt>`，定义来自缓存，位置参数与 `key=value` 支持。
4. **HTTP transport + v1 认证边界**：streamable HTTP（`StreamableHTTPClientTransport`，回退 `SSEClientTransport`）；认证只做静态 `headers`（API-key 类远程 server）；OAuth（PKCE + 回调 + token 存储刷新）**明确留 v2**，等真撞上需要 OAuth 的 server 再加。
5. **`/mcp` 命令**：状态查看 + 单 server/全部重连；不做 setup 向导、不做面板。
6. **`mcp-cache.json` 修订自愈**：缓存读写异常（解析失败、版本不符）时删除重建，不让陈旧缓存阻塞启动。

**不包含（明确砍掉）：**

mcpScript 脚本工具（worker 线程 + 16 MiB 预算子系统）、MCP UI / Glimpse / AppBridge、elicitation、sampling、resources 二进制物化、agent-plugins / claude-plugins / package-manifest 加载器、rmcp-mux 共享进程、sandbox proxy、OAuth、direct-tools 热加载与 search-activated 变体、`/mcp setup` 向导与交互面板、兼容性导入（Claude/Cursor 配置迁移扫描）、conformance 套件。

## 为什么现在做 / 当前坏在哪

- npm 12（Node 24.15.0 自带 12.0.2）`allow-remote` 默认从 `all` 收紧为 `none`，`pi-mcp-adapter@2.33.0` 依赖 `pkg.pr.new` 上未发布 PR 的 URL tarball（`@modelcontextprotocol/client`/`core`@3b205e7），`pi update --all` 整体失败（临时靠 `~/.npmrc` `allow-remote=all` 续命）。
- 上游功能面过大（OAuth/UI/elicitation/sampling/插件加载器/脚本引擎…），用户明确不需要；要的是「配置好、能正常用、上下文管理学到位」的最小实现。
- 2.32.0 时代依赖的就是正式版 2.0.0，说明核心能力（stdio + streamable HTTP client + 工具调用）在正式版上完整可用。

## 现状怎么工作

当前 `pi-mcp-adapter@2.33.0`（`~/.pi/agent/npm/node_modules/`）注册单 `mcp` proxy tool + `/mcp` 面板 + directTools/mcpScript 等；配置从分层 mcp.json 读取；元数据缓存在 `~/.pi/agent/mcp-cache.json`（configHash 键控，含 tools/resources/prompts/instructions）。该包是我们抄上下文管理设计的参照实现（读它的 server-manager.ts / proxy-modes.ts / direct-tools.ts / metadata-cache.ts / mcp-output-guard.ts / npx-resolver.ts / search-ranking.ts / prompts.ts / types.ts）。

## 方案与实现安排

**结构**（全部 TS 源码 + jiti 加载，遵循 monorepo 默认；无构建产物）：

```
packages/pi-mcp/
├── package.json        # @bytetrue/pi-mcp；deps: @modelcontextprotocol/client@2.0.0、core@2.0.0
├── src/
│   ├── index.ts        # 入口：注册 mcp tool、/mcp 命令、directTools、prompts、lifecycle
│   ├── config.ts       # 分层配置读取 + 合并 + schema 校验
│   ├── types.ts        # ServerEntry、ToolMeta、CacheShape 等共享类型
│   ├── server-manager.ts  # 连接生命周期：lazy/eager、空闲断连、重连、listTools 刷新
│   ├── proxy.ts        # mcp tool 的 handler：{}/{server}/{search}/{describe}/{tool,args}
│   ├── search-ranking.ts  # 排名检索（词权重 + searchKeywords + Pi 工具合并 + 分页）
│   ├── metadata-cache.ts  # mcp-cache.json 读写 + configHash + 修订自愈
│   ├── npx-resolver.ts    # npx → 直连二进制路径 + 缓存
│   ├── direct-tools.ts    # 静态注册 directTools（缓存驱动）
│   ├── prompts.ts         # /mcp__server__prompt 命令注册
│   ├── output-guard.ts    # 50 KiB/2000 行守卫 + 0600 temp 溢出文件
│   └── <以上每个模块>.test.ts
└── README.md
```

**关键设计取舍：**

- **依赖**：只 `@modelcontextprotocol/client@2.0.0` + `@modelcontextprotocol/core@2.0.0`，semver 精确锁定（不做 `^`，防上游再引入 URL 依赖时静默漂移）。`zod` 等传递依赖随 SDK 走。
- **proxy tool 契约**：与 pi-mcp-adapter 的用法表对齐（`{}` 状态 / `{server}` / `{search,limit,offset,regex}` / `{describe}` / `{tool,args}` / `{instructions}`），让模型迁移零成本。
- **directTools 静态注册**：extension load 时从磁盘缓存读工具定义注册；缓存缺失则 proxy-only，首次 connect 后缓存落盘。为防 [re-import 单例问题](../notes/004-…) 用 `globalThis[Symbol.for("pi-mcp.state")]` pin 活连接状态（memory #754）。
- **prompt 参数**：位置参数 + `key=value`，必填参数缺失时报错并提示正确用法。
- **写配置**：只读配置面（读分层、写只发生在自愈删除缓存时）；`/mcp` 不做写配置操作。

**风险与穿刺（先打通再铺开）：**

| # | 风险点 | 怎样算打通 |
|---|---|---|
| 1 | client@2.0.0 正式版能否支撑 stdio + streamable HTTP 双 transport、listTools/callTool/prompts 全链路（参照实现用的是 pkg.pr.new 构建） | 用 InMemoryTransport + 真实 stdio server（`npx -y @modelcontextprotocol/server-everything`）+ 真 HTTP server 各跑通 listTools/callTool |
| 2 | jiti 加载下 SDK 双包（client + core）+ zod4 无链接期问题 | packages/pi-mcp `npm install` 后用最小 extension 入口在真实 Pi 里 load 成功 |
| 3 | directTools 静态注册在 /reload 后状态一致性 | globalThis pin 验证：注册工具可调用，/reload 后无孤儿状态 |
| 3b | 0.85.1 `pi.unregisterTool` 可用性 | 若不可用，降级为仅提示需重启；不阻塞 |
| 4 | output guard 在真实大输出 server 上的截断/溢出行为 | 构造 >50 KiB 文本结果验证截断 + temp 文件路径返回 |
| 5 | npx 直连解析对 `npx -y pkg@version` 的覆盖 | 对真实 `npx -y @modelcontextprotocol/server-everything` 解析出二进制路径且调用成功 |

**步骤：**

1. 脚手架：package.json、tsconfig、vitest 配置（对齐 pi-subagent 先例）。
2. 穿刺 #1+#2：最小 extension（只注册 `mcp` tool）+ InMemoryTransport 单测 + 真实 stdio server 手动打通。
3. config + metadata-cache + 修订自愈。
4. server-manager（lazy/eager、空闲断连、重连）+ proxy 全操作。
5. search-ranking + searchKeywords + 名字容错。
6. output-guard。
7. npx-resolver。
8. directTools + prompts。
9. `/mcp` 呖命令。
10. README + 真实 Pi 回归（load、search、describe、call、directTools、prompt、reload）。

**质量承诺（受管理）：**

- **功能适宜性**：对 `.mcp.json` 里声明的 server，`mcp({tool,args})` 返回真实工具结果（stdio + HTTP 双 transport 各验证一次）；穿刺 #1 证据。
- **可维护性/可测试性**：每核心模块单测扎在可观察行为上（配置合并、排名、缓存自愈、output guard 截断阈值）；参照 pi-subagent 的 vitest 布局。
- **兼容性**：配置文件布局与 pi-mcp-adapter 同构（同一份 `.mcp.json` 在两包下解析出相同 server 集）；`mcp` proxy tool 的用法契约对齐。
- **性能效率**：单 proxy tool 下 system prompt 占用 ≈ pi-mcp-adapter 水平（~200 tokens 工具描述）；lazy 模式零启动连接。
- **可靠性**：缓存损坏/版本不符自动重建，不阻塞 extension load；server 进程退出后下一次调用自动重连。

## 验证

- 单测：config 合并优先级、search 排名 + 分页 + keywords、metadata-cache 自愈、output-guard 阈值、npx-resolver 解析逻辑（mock spawn）。
- 穿刺实测：InMemoryTransport 全链路；真实 stdio server（server-everything）+ 真实 HTTP server 的 listTools/callTool。
- 真实 Pi 回归：`pi -e packages/pi-mcp` 会话内 `/mcp`、search/describe/call、directTools 直调、`/mcp__server__prompt`、`/reload` 后状态一致。
- pack dry-run + 确认 npm install 无 URL tarball 警告（`npm i --dry-run` 输出检查）。

## 关闭时

- 回写 project spec `spec/pi-mcp/index.md`（新建子 spec：配置布局、上下文管理设计、v1 认证边界、砍掉的功能清单）。
- 更新 `spec/index.md` 八包能力地图与「使用路径」。
- 候选 note：MCP client 2.0.0 正式版与 pkg.pr.new 构建的差异、npx 直连解析坑点。
- 遗留：OAuth（v2）、resources、elicitation/sampling、conformance。

## 执行记录

### 2026-09-15：实现完成，待用户验收

**包**：`packages/pi-mcp`（`@bytetrue/pi-mcp` 0.1.0），24 个 TS 源文件 4534 行（含 8 个测试文件）。`npm test` 55/55 绿，`tsc --noEmit` 干净，`npm pack` 20 文件 38.2 kB。

**与方案的关键偏差（用户拍板后）**：不整仓 fork 上游（保留面核心文件与砍掉面的一级依赖纠缠，npm 包不带测试，2.33.0 源码按 pkg.pr.new SDK 写），改为「自写骨架 + 上游自包含模块原样移植」。用户补充原则：能复用就复用，不自创设计。实际落点：

- **原样移植（MIT 归因见 LICENSE/NOTICE）**：`npx-resolver.ts`（缓存格式与上游 mcp-npx-cache.json v2 共享兼容，迁移即热）、`mcp-output-guard.ts`、`search-ranking.ts`（配 failure-backoff 的 SearchState 适配）、`prompts.ts`（PromptRuntime 适配）、`ts-shape.ts`、`tool-naming.ts`（自 types.ts 抽出的命名/前缀/pattern 纯函数）、`abort.ts`；metadata-cache 的 load/save/hash/valid/reconstruct 主干。
- **自写骨架（对齐上游语义）**：`config.ts` 五层配置（顺序照抄 getConfigSources，惰性路径解析）、`server-manager.ts`（lazy 合并连接、空闲断连、SSE fallback 404/405/406/415、分页、prompts 能力探测、npx 接线、globalThis pin）、`proxy.ts` 七操作、`direct-tools.ts` 静态注册、`index.ts`。
- 依赖：`@modelcontextprotocol/client@2.0.0` + `core@2.0.0`（精确锁定）+ `cross-spawn@^7.0.6`（已是 client 传递依赖，显式声明）。

**穿刺结果**：

| # | 风险点 | 结果 |
|---|---|---|
| 1 | client@2.0.0 正式版全链路 | ✅ InMemory 4 测试 + 真实 server-everything stdio（listTools/callTool/listPrompts/getPrompt，首次连 50s 为 npx 冷装）|
| 2 | jiti 加载双包+zod4 | ✅ 真实 Pi `pi -p -ne -e` 加载成功 |
| 3 | directTools 静态注册/重载 | ✅ 第二会话从缓存注册（真机验证 `--tools everything_echo` 直调 Echo 成功）；/reload globalThis pin 逻辑就位（真机 /reload 未验，见遗留）|
| 4 | output guard 大输出 | ✅ 80KiB 文本截断+0600 溢出+路径返回（单测+集成）|
| 5 | npx 解析 | ✅ 原样移植版对真实包解析出直连二进制，缓存复用；失败回退原命令 |

**质量承诺兑现**：

- 功能适宜性：真机回归全通——status（未连接不谎报）/connect（13 tools 4 prompts）/search/describe/call（Echo: pi regression）/名字容错（模型把 `everything_add` 错名自主修正到 `get-sum` 返回 5）/directTools 直调/offline search（断连后磁盘缓存路径）/transparent reconnect。
- 兼容性：五层配置布局与上游同构（同一优先级序）；mcp-cache.json v1 / mcp-npx-cache.json v2 格式共享兼容（迁移零成本，旧 7 server 条目合并保留）；裸 npmrc（无 allow-remote）下 tarball 安装成功——即本次 npm 12 事故的对照验证。
- 性能效率：mcp 工具 schema+描述约 200 tokens（7 操作字段）；lazy 模式零启动连接（真机 status 显示 not connected, 0 tools）。
- 可靠性：缓存损坏/版本不符自动重建；configHash 变更单 server 失效（单测）；server 崩溃重连（真机）。
- 可维护性/可测试性：8 个测试文件 55 用例，全部扎在可观察行为上。

**真机回归方式**：项目目录 `.mcp.json` + `pi -p --mode json --tools mcp -ne -e packages/pi-mcp`（避开全局 pi-mcp-adapter 的 `mcp` 工具名冲突）。测试写入的 `everything` 缓存条目已从真实 `~/.pi/agent/mcp-cache.json` 清除。

### 2026-09-16：v0.1.0 发布 + CI/CD 接入

- 用户手动发布 `@bytetrue/pi-mcp@0.1.0`（`npm publish -w --access public`），并在 npmjs.com 配置了 Trusted Publisher（ByteTrue/pi-package-mono → .github/workflows/release.yml）。
- `release.yml` 增加 `pi-mcp-v*` tag 触发与 case 分支；`.pi/settings.json` 挂本地 `../packages/pi-mcp` 并屏蔽全局 pi-mcp-adapter / pi-magic-context（实测解决了 `mcp` 工具名冲突）。
- 验证：`pi -p` 工具面 = 内建 + 本地 8 包，本地 `mcp` proxy status 正常。
- 下一步：提交后打 tag `pi-mcp-v0.1.1` 推 CI 验证 OIDC 发布链路。
- **CI/CD 验证通过**（run 35003834127，publish job 1m25s）：release.yml 触发 `pi-mcp-v0.1.1` → typecheck/test（含 pi-mcp 网络测试）→ OIDC Trusted Publishing 无 token 发布成功，`latest` 指向 0.1.1。遗留 4 已完成。

**遗留（关闭前需用户验收或授权）**：

1. 真机 `/mcp` 与 `/mcp__server__prompt` 斜杠命令（TUI 交互，`-p` 模式不可达；handler 逻辑已单测覆盖）。2. `/reload` 后 globalThis pin 的真机验证。3. 全局 pi-mcp-adapter 的卸载时机（项目层已屏蔽，全局卸载待用户决定）。4. v0.1.1 CI OIDC 发布验证结果回写。
