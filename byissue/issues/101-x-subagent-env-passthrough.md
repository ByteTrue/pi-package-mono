---
kind: issue
type: feature
status: closed
created: 2026-09-30
closed: 2026-09-30
---

# 101 · subagent.env：向子进程透传环境变量

## 目标

让用户能通过 settings 给**所有子 agent 子进程**附加环境变量，而不需要这个包知道任何第三方扩展的名字。

典型场景：某个扩展（如 billion-context）会在**每个** pi 进程里注册自己的工具，包括子进程；而它在子进程里可能根本不可用（工具是坏的）。用户希望只对子进程关掉它，主会话保持开启。

## 范围

- 新增 settings 键 `subagent.env`：`Record<string, string>`。
- 作用域：全局 `~/.pi/agent/settings.json` 与项目 `.pi/settings.json` 都读，**项目键覆盖全局键，未冲突的全局键保留**。
- 子进程 env 合并顺序：`process.env` → `subagent.env` → `PI_SUBAGENT_CHILD="1"`（最后，不可被覆盖）。
- 值的类型：**只接受字符串**；数字/布尔一律忽略（不做静默强转）。
- 不做特判、不内建任何具体扩展的开关名。

## 背景与证据

派生自 Issue 100 之后的 billion-context 换代调查。新版（`billion-context@0.1.174`）把压缩/催压整体搬到了**本地代理**里：

- 旧版 `billion-context-pi@0.1.82`：nudge 由扩展注入 → 会追进子会话 → 子 agent 被催着调 `compress` 却拿不到该工具（`Tool compress not found`）。
- 新版：nudge 只在代理侧（`grep -c nudge dist/agent/pi.js` = **0**，仅 `dist/index.js` 有 `nudge INJECT T1`/`pendingT1`）；且**子进程的模型请求不进代理**（跑子进程前后 `request:`/`forward POST`/`acp-usage` 计数不变；`plugin-conversations.json` 只有主会话一条；子进程 sid 在全日志里只出现在一条 warn 里）。
- 因此旧错配消失，但子进程仍**继承 `BILLION_CONTEXT_PROXY`**，`pi-native.js` 照样拉 manifest 并注册 5 个工具（`compress`/`decompress`/`search_context`/`acp_status`/`acp_cache`）。实测：

```
默认 env                  → 17 个工具，ACP 5 个
BILLION_CONTEXT_PLUGIN=0  → 12 个工具，ACP 0 个
```

这 5 个是**死工具**：调用即 404 `unknown plugin conversation (no model request has arrived with this conversation id yet ...)`。

影响面：`explore`/`plan` 不受影响（角色文档 `tools:` 白名单正好挡住），只有 `general-purpose`（不写 `tools:` → 继承全量）会带上。

## 现状如何工作

- settings 解析在 `packages/pi-subagent/src/settings.ts`：`parseSubagentSection` 读现代 `subagent.*` 与 legacy `subagents.agentOverrides`；`loadSubagentSettings(cwd, projectTrusted)` 合并全局/项目。
- 运行配置在 `packages/pi-subagent/src/index.ts`：`resolveRunCfg(item, agentCfg, inheritedThinking?, inheritedModel?, subagentSettings?)` 产出 `PiRunConfig`；`runPi` 构造子进程 env。

## 操作方案

1. `SettingsScope` 之外新增 `SubagentSettings.env?: Record<string, string>`；`parseEnvMap` 只收字符串、trim 键名为空即丢弃、空对象归 `undefined`。
2. `PiRunConfig.env?: Record<string, string>`；`resolveRunCfg` 两处 return 都带上 `env: subagentSettings?.env`。
3. 新增导出 `buildChildEnv(cfg): NodeJS.ProcessEnv`，顺序固定 `process.env → cfg.env → PI_SUBAGENT_CHILD`，`runPi` 改用它。抽出成导出函数是为了让「守卫最后应用」这条不变量可被单测钉住。
4. `updateSubagentSettings` 的 clean 输出保留 `env`（菜单改角色时 `{...current}` 本来就会带上，但显式写出避免丢键）。
5. `/subagent` 菜单**不加** env 编辑界面——这是给高级用户的 JSON 配置，交互式编辑一个键值表不划算。

## 风险边界

- **不能覆盖 `PI_SUBAGENT_CHILD`**：它是递归守卫（`subagentExtension()` 开头 `if (process.env.PI_SUBAGENT_CHILD === "1") return;`）。若用户把它设成 `"0"`，子进程会重新加载本扩展并递归。合并顺序已把守卫放在最后。
- **非字符串被忽略**：如把开关写成 `0` 而非 `"0"`，会被丢弃。这是刻意的——`String()` 对 `null` 得 `"null"`、对 `{}` 得 `"[object Object]"`、对数组做逗号拼接，用户会拿到一个看似生效实则语义被改写的值；丢弃至少是可预测的。注意 `0 → "0"`、`false → "false"` 本身并无害，规则统一为「只收字符串」是为了不引入一条需要逐类型记忆的例外表。
- **空 map 等于「无意见」**：项目写 `subagent.env: {}` 不会清空全局 env（`parseEnvMap` 对空 map 返回 `undefined`，合并时按缺失处理）。目前没有「在项目层清空某个全局 env 键」的表达方式。
- **不做扩展特判**：README 用 billion-context 举例，但代码里不出现任何具体扩展的开关名。
- `resolveAgentRole` / `normalizeTask` 不受影响。

## 验证（关闭时定稿）

- `npx tsc --noEmit` 通过。
- `npx vitest run`：**38 passed**（原 31 + 新增 7）。
  - `passes settings subagent.env through to children, project winning over global`：全局 `{SHARED:"global",GLOBAL_ONLY:"1",KEPT:"yes"}` + 项目 `{SHARED:"project",PROJECT_ONLY:"2",BAD_NUMBER:3,BAD_NULL:null,"":"dropped"}` → 结果为 `{SHARED:"project",GLOBAL_ONLY:"1",KEPT:"yes",PROJECT_ONLY:"2"}`；并断言 `buildChildEnv` 结果里 `PROJECT_ONLY="2"`、`PI_SUBAGENT_CHILD="1"`。
  - `drops project subagent.env entirely when the project is not trusted`：`projectTrusted=false` 时项目 env（含 `NODE_OPTIONS`）整段丢弃，全局 env 保留——项目 settings 是真正的注入面，靠信任门挡住。
  - `does not let an empty project env map clear the global one`：项目写 `subagent.env: {}` → 全局 `{FROM_GLOBAL:"1"}` 仍在。
  - `carries subagent.env on both resolveRunCfg return paths`：`{model:"m",thinking:"high"}` 走拼接分支、`{model:"m"}` 走回退分支，两者 `env` 都是 `{SWITCH:"0"}`；无配置时 `env` 为 `undefined`。
  - `keeps subagent.env when the /subagent menu rewrites settings`：走一次 `updateSubagentSettings` 加角色，`env` 仍在。
  - `lets settings env shadow the parent but never the recursion guard`：`env:{PI_SUBAGENT_CHILD:"0",BILLION_CONTEXT_PLUGIN:"0"}` → 前者仍是 `"1"`，后者是 `"0"`。
- **测试隔离**：`src/index.test.ts` 顶层加了 `beforeEach`/`afterEach`，把 `PI_CODING_AGENT_DIR` 指向每个用例自己的空临时目录并在结束后还原。没有这层时，一个用例（`keeps subagent.env when the /subagent menu rewrites settings`）会读到用户真实的 `~/.pi/agent/settings.json` 而失败——现已套件级隔离，测试结果不再受开发机全局配置影响。
- **真实子进程 E2E**（临时探针，跑完已删）：本仓库 `.pi/settings.json` 写入 `subagent.env = {BILLION_CONTEXT_PLUGIN:"0", SUBPROBE:"from-settings"}` → `loadSubagentSettings` 读回一致 → `resolveRunCfg` → `buildChildEnv` → `spawn(pi --mode json -p)` → 子进程工具表 **ACP 工具数为 0**。（首次跑挂住 240s，原因是 `stdio` 未设 `stdio:["ignore","pipe","ignore"]` 导致管道未读；修正后 3.68s 通过。）
  - **证据边界**：链路上从 settings 到 `buildChildEnv` 的每一段都是真实函数调用；仅最后的 `spawn` 是探针手写的（不是 `runPi`），所以它证明的是「透传链路成立、且开关在真子进程里确实把 ACP 工具从 5 个降到 0」。`runPi` 那一侧由代码事实钉住：全项目 `spawn(` 仅 `src/index.ts:1050` 一处，`buildChildEnv` 仅在那里被调用。

## 关闭时

- ~~同步 spec~~ **已完成**：`byissue/spec/pi-subagent/index.md` 已新增第 6 条「子进程环境变量透传」（合并顺序、守卫不可覆盖、只收字符串、空 map 语义、`buildChildEnv` 单点），Issue 100 遗留的 4 处角色漂移（第 17、21–24、47、61 行）已一并修完。
- 与 Issue 100 一并提交（`packages/pi-subagent` 0.10.0 未提交，工作区尚有 Issue 100 的改动）。

## 遗留

- 实际开关值已落地：**写到了全局** `~/.pi/agent/settings.json`（用户 2026-09-30 决定），即 `{"subagent":{"env":{"BILLION_CONTEXT_PLUGIN":"0"}}}`——所有项目生效，包括本项目。原计划写项目 `.pi/settings.json`，改全局是为了避免每个项目重复配。
- 未处理「父进程没有该扩展、子进程却带着一个空开关」的情况：这是无害的（env 只是多一个变量）。
- 未处理 Windows 大小写变体：若用户写的键与 `process.env` 中已有键仅大小写不同（ `PATH` vs `Path`），展开成普通对象后会产生两项，子进程内优先级未定义。真实用例（全大写）不受影响。
- 没有「在项目层清空某个全局 env 键」的表达方式（空 map 按「无意见」处理）。真需要时再引入显式删除语义。

## 关闭结论

**判断：可关。**（补充：E2E 证据由直接 `spawn` 的临时探针给出，成立；但**当时正在运行的 pi 进程里本包模块是旧实例**——改动落地后用户未再 `/reload`，行为探针改源码文案后返回仍是旧文案，故线上进程需 `/reload` 后才实际使用该特性。这是进程生命周期问题，不是实现缺陷。） 目标（通用 env 透传，本包不特判任何扩展名）落地；三项设计约束（守卫不可覆盖、只收字符串、空 map 不清空）都有测试钉住。

**验证摘要**：

| 证据 | 结果 |
|---|---|
| `npx tsc --noEmit` | 干净 |
| `npx vitest run` | **38 passed** |
| 真实子进程 E2E | 带 `BILLION_CONTEXT_PLUGIN=0` 时子进程 ACP 工具数 = 0（对照默认 5 个） |
| 线上进程 | 未 reload 时仍跑旧模块（`subagent.env` 未参与），需 `/reload` 才生效 |
| `spawn(` 全项目扫描 | 仅 `src/index.ts:1050` 一处，`buildChildEnv` 也只在那里调用 |

**回写位置**：`byissue/spec/pi-subagent/index.md` 新增第 6 条「子进程环境变量透传」（合并顺序、守卫不可覆盖、只收字符串、空 map 语义、`buildChildEnv` 单点）；`byissue/spec/index.md` 的包映射表该行配置列补上了 `subagent.defaultModel` / `defaultThinking` / `agents[角色]` / `env`。**沉淀**：`byissue/notes/010-billion-context-proxy-registers-acp-tools-in-children.md` 记下了这个开关针对的外部事实（为什么必须在**子进程** env 里关、而不是父进程）。

**交付**：`packages/pi-subagent` 0.10.0（与 Issue 100 同一笔提交，未发布）。

**Advisor 评审后的补强**：交前补了信任门测试（项目 env 在 `projectTrusted=false` 时整段丢弃，含 `NODE_OPTIONS` 注入面）、空 map 不清空全局测试、`resolveRunCfg` 两条 return 各自带 env 的测试，并修正了本文件里关于强制转换的错误理由。
