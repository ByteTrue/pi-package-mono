---
kind: issue
title: "ff：pi-background-terminal 加载崩溃——陈旧 npm 副本污染 manager 全局"
type: ff
status: closed
created: 2026-09-14
---

# ff：pi-background-terminal 加载崩溃——陈旧 npm 副本污染 manager 全局

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。

---

`pi` 在本仓库启动即报 `Failed to load extension …/pi-background-terminal/src/index.ts: manager.listAll is not a function`。根因：manager 钉在 `globalThis[Symbol.for(...)]` 的单例被**旧版本副本先占**——用户级 `~/.pi/agent/settings.json` 加载 pi npm 缓存里的 0.6.0（无 `listAll`，2026-09-14 实测缓存版本 0.6.0），项目级 settings 又加载本地 dev 副本；本地副本的 `sweepOrphanLogs()`（0.7.0 新增）调 `manager.listAll()` 撞上旧实例。修复：钉住全局时按能力检查（有 `listAll` 才复用，否则替换）；不能用 `instanceof`（`/reload` 重新求值类，会误杀要保留的实例）。加载时刻旧副本不可能有存活任务，替换安全。

- 改动：`packages/pi-background-terminal/src/background/manager.ts` — 全局单例复用前检查 `typeof instance?.listAll === "function"`；`manager.test.ts` — 新增"陈旧实例被替换"测试（复用既有 `/reload` 存活测试守护另一侧语义）。
- 验证：pty 下真机 `pi` before/after——旧代码精确复现原报错，修复后同命令 0 错误；51 测试 + 全仓 typecheck/test 绿。
- codestable：无影响（`spec/pi-background-terminal/index.md` 36 行"`/reload` 存活（钉 globalThis）"仍成立；兼容性细化属实现细节）。

**2026-09-14 追加（配置层根治，用户提案）：** 代码兜底只是防御；真正根因是双副本加载。已改两处 pi 配置：项目 `.pi/settings.json` 删去六个 `npm:` 覆盖条目（它们让 pi 往 `.pi/npm/` 装了 0.6.0 陈旧副本且过滤未生效），只留 `../packages/*` 本地路径；全局 `~/.pi/agent/settings.json` 六个 bytetrue 条目改为 `{source, autoload: false}`（pi 的"禁用不删除"机制，其他项目如需可改回字符串）。**验证升级为双向 oracle**：还原旧 manager.ts + 新配置跑 pty `pi` 不再崩（证明 0.6.0 模块不再被求值），新代码 + 新配置干净加载；`pi list` 项目包仅剩本地路径。备份：`~/.pi/agent/settings.json.bak-20260914`。遗留：项目 `.pi/npm/`（3.3M 陈旧缓存）已成孤儿，可手动删；教训——`autoload:false`+`-pattern` 的 project 覆盖条目在"同 source 双写"场景不可靠，同仓库开发期一律只用本地路径条目。
