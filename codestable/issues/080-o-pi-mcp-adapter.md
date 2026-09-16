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

## 2026-09-16 范围扩充：全量管理面（用户拍板）

用户验收后认为 v0.1.1 抄得不够：上游「查看所有工具 / 切换连接状态 / 状态栏」等管理能力没带过来。拍板把**管理面全量抄齐**（对照上游 2.34.0 源码盘点），OAuth 仍留 v2（连接/认证能力而非管理能力；~3600 行 + keychain/回调服务器实测）。分三批交付：

- **P1 管理基座（0.2.0）**：① 底部状态栏 `ctx.ui.setStatus("mcp", ...)`，`mcpFooterStatus: full|compact|off`（默认 full）；② `/mcp` 子命令全量：`status`（默认）/ `reconnect [server]` / `tools` / `prompts` / `enable|disable <server>`（写 `.pi/mcp.json` 项目覆盖，提示 /reload），子命令与 server 名 Tab 补全；③ 状态保真度：connected / failed(Ns 前+原因) / cached / not connected / disabled 五态，替换现在「0 tools 也称 cached/offline」的糊写；④ 前置改造：config 合并层保留 disabled server（不再过滤），manager 与 proxy/direct-tools/prompts 跳过它们；⑤ enable 写覆盖沿用上游语义（低层仍 disabled 时写 `disabled: false`，与低层一致时不写冗余）；⑥ mcp-trace 移植（opt-in：server 级 `trace` / `settings.mcpTrace`，JSONL 落 `.pi/mcp-traces/`，脱敏+字节/条数上限+失败自禁用）。
- **P2 管理面板（0.3.0）**：移植 mcp-panel + panel-keys + mcp-panel-theme 三件套（TUI overlay：server 列表、每 server 动作 reconnect/查看工具/prompts、fuzzy 过滤），`ctx.mode === "tui"` 守卫；authenticate 动作灰显提示 OAuth 未实现。
- **P3 setup 面板（0.4.0）**：移植 mcp-setup-panel（宿主配置发现/采纳、known server 预设、写入预览）。是否做看 P2 后实际需要。
- 砍掉不变：OAuth、mcpScript、resources 物化、elicitation/sampling、兼容性导入、状态快照事件总线。

### P1 执行记录

**2026-09-16：P1 完成，待用户验收（0.2.0）**

- **改动**：`config.ts`（合并改为逐字段 spread + 同名 server 换目标时丢弃旧 headers 的 url-binding 守卫；bare `disabled` marker 合法化；`loadMcpConfig` 不再过滤 disabled；解析 `mcpFooterStatus`/`mcpTrace`）；`types.ts`（`McpTraceSettings`、`mcpFooterStatus`、server 级 `trace`）；`server-manager.ts`（disabled 跳过连接、五态 `status()`、`onStateChange` 回调、trace 接线、Client 版本 0.2.0）；`proxy.ts`（上游 executeStatus 五态文案 + disabled 守卫）；`commands.ts` 新建（状态文案/tools/prompts/footer 文案/覆盖写入/Tab 补全，移植上游 commands.ts + config.ts 相应语义）；`direct-tools.ts`/`index.ts`（disabled 守卫、/mcp 全子命令、footer 生命周期、trace 注入）；`mcp-trace.ts` 原样移植（去 socket）。
- **验证**：单测 72/72 绿（新增 17：五态渲染、footer full/compact/off、补全、enable/disable 覆盖写入含 0600、marker merge、url-binding 守卫、settings 解析）；`tsc --noEmit` 干净；真机（`pi -p --mode json --tools mcp -ne -e` + 真实 server-everything）：五态 status 含 ⊘/cached 文案、connect 13 tools/4 prompts、disabled server 拒连文案、缓存回填后 `○ everything (13 tools, cached; not connected)`、trace JSONL 落盘（initialize 往返/bytes/durationMs）；RPC 模式 footer 实测 `3 servers enabled (1 disabled)`。
- **已知竞态**：并行 connect 与 search 同发时，search 只见磁盘缓存（connect 完成后回填）——与上游一致，非本次引入。
- **偏离说明**：写覆盖新建文件 0600（上游未限定；mcp.json 可能含 headers 凭据，对齐 note 002 约定）。
- **遗留**：TUI 交互面（`/mcp` 子命令的 ui.notify 渲染、Tab 补全体验、`/reload` 后 footer 刷新）与 080 遗留 1/2 同批待真机 TUI 验收；P2 面板移植待开工。

### P2 执行记录

**2026-09-16：P2 完成，待用户验收（0.3.0）**

- **移植**：`mcp-panel.ts`（上游 1099 行简化至 ~640：砍 OAuth/authOnly、import provenance、resources 物化、uiVisibility、search-activated directTools；状态源收窄为 ServerManager + 共享磁盘缓存；save 语义改为回调式——`applyDisabledChange`/`applyDirectToolsChange` 由入口层接 `writeProjectServerDisabledOverride`/新 `writeProjectServerDirectToolsOverride`，配置写仍集中在扩展入口）；`panel-keys.ts`/`mcp-panel-theme.ts` 原样；新增 `writeProjectServerDirectToolsOverride`（selection true/list 写字段、false 移除字段还原低层值）。
- **接线**：TUI 下 `/mcp`（无参）经 `ctx.ui.custom` 以 overlay(anchor:center,width:72) 打开；print/json 模式仍打五态文案。McpPanel 实现 Component 契约（render/invalidate 委托 view）。
- **验证**：单测 78/78 绿（面板新增 6：状态映射、name query 过滤、toggle+ctrl+s 落盘、ctrl+d 落盘、discard keep、Component render 契约；注意 handleInput 必须逐键事件灌入，与真实 TUI 一致）；`tsc --noEmit` 干净；真机 TUI（expect 伪终端，等 footer 就绪后发 `/mcp`）：面板帧捕获到 `MCP Servers`/`search...`/`everything (not cached)`/hints 行；footer 状态栏再次验证。
- **经验教训**：初次真机验证面板未渲染——openMcpPanelForSession 最初没走 `ctx.ui.custom`（假 tui 对象空转）；且 McpPanel 未实现 Component 接口。修正后打通。测试的 cache configHash 必须用真实 `computeServerHash`。
- **遗留**：面板宽 72 固定值（上游 92），真机体验待用户调；`?` desc search 在真机未逐键验证（单测覆盖）。P3 setup 面板待用户看 P2 实际体验后决定是否做。
- **追加修复（同日，用户真机报错）**：mono 工作目录全局 0.1.1 + 本地 0.3.0 双副本共存时，两副本共用 `Symbol.for("pi-mcp.server-manager")` globalThis 键，旧副本先载入 pin 了无 `onStateChange` 的旧 manager，新副本复用后崩溃。修复：复用前探测 `managerVersion === 3` + `onStateChange` feature-detect，不兼容整体换新。验证：mono `pi -p` 正常。0.3.0 发布后全局升级即消除双副本版本差；探测逻辑长期护栏。
- **追加修复 2（同日，用户真机截图反馈）**：① 面板残影——根因非面板自身高度，而是：(a) 自创的顶部动态 notice 行（上游无此设计，上游 notice 全部走列表底部 authNotice 槽位）与固定高度空槽填充导致帧间高度剧烈变化；(b) 面板关闭时 finish() 的 ctx.ui.notify 打到底屏。修复：view 渲染逐行对齐上游 mcp-panel.ts（动态高度、紧凑列表、notice 走底部槽位、去掉高度钳制），关闭时不再 notify，overlay 宽度对齐上游 92。教训：上游 MIT 面板的布局/渲染结构本身是设计的一部分，"自创固定高度 + 裸空行填充"反而破坏 pi-tui overlay diff 的合成前提。② ctrl+r 改为重连全部启用 server（原为光标所在单个），并行重连 + 逐 server 状态刷新 + 汇总 notice（面板内显示）。验证：79/79 测试绿（面板 7 测试含固定高度断言改为结构断言 + reconnect all），tsc 干净，真机面板单帧无残影，/mcp reconnect 重连链路正常。

### 审计对齐（2026-09-16，用户拍板"没必要自创的就别自创"，0.4.0）

逐模块对照上游 2.34.0 全面审计，7 项判定为无必要自创并全部修正：

1. **idleTimeout 单位秒→分钟**（上游 units，默认 10 分钟）：语义变更防迁移错 60 倍；新增 `effectiveIdleMinutes`（上游 getEffectiveIdleTimeoutMinutes 语义：eager 永不 idle、per-server 覆盖、全局默认）。
2. **include/exclude 过滤器接入 metadata 层**：移植上游 `isToolAllowed` 函数族 + glob matcher index 到 tool-naming.ts；server-manager `metadataFor` 单点过滤（跨 server 候选防碰撞），search/list/describe/direct-tools/panel 全部自然继承。真机验证：excludeTools 滤掉 echo（13 连接→12 列出）。
3. **search 输出契约对齐**：`Found N tools matching "..."` 文案、includeSchemas（Shape 渲染 vs 简行）、regex 长度上限 256、空 query 报错、server 过滤参数。
4. **describe 输出对齐**：`Tool:/Server:` 头 + `Shape:`（ts-shape 失败回退 JSON）+ `No parameters defined.`。
5. **instructions 改缓存优先**：discovery 操作不再自动拉起 server（未连接返回 connect 引导，与"只有 call/connect 触碰 live server"边界一致）。
6. **list 改缓存优先**：不再无缓存就 connect；未连接返回引导 + lazy 缓存注记（上游 cachedNote 语义）。
7. **settings.mcpTrace 更名 settings.trace**（上游字段名一致，减少迁移面）。

保留的有意偏离（080 砍掉面，非遗漏）：OAuth/auth/install 字段、mcpScript、approveTools、resources、socket、bearer、caFile、requestHeadersCommand、strictDirectToolArguments、renderCall/renderResult、lifecycle keep-alive 变体、type local/remote 别名。

验证：85/85 测试绿（+6：selector 三态、effectiveIdleMinutes 三分支）、tsc 干净、真机全链路（connect/list/search/describe/instructions + excludeTools + trace 落盘）。
