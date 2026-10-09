---
kind: issue
title: "子代理在 codemode 环境下继承 codemode 容器以支持工具白名单与内置角色"
type: ff
status: closed
created: 2026-10-09
---

# 子代理在 codemode 环境下继承 codemode 容器以支持工具白名单与内置角色

当父会话运行在 `codemode: "only"` 模式下时，调用方若向 `subagent` 传递了 `tools` 白名单，或者调用了内置带 `tools` 约束的角色（如 `explore`、`plan`），此前会直接拼成 `pi --tools a,b,c` 导致子进程缺少 `codemode` 工具，进而被全局 `hide-direct-tools.js` 拦截导致子会话死锁瘫痪。本次快改让 `subagent` 在检测到父级 codemode 环境时，自动在子代理的 `tools` 中补齐 `codemode`，确保子代理既在 `codemode: "only"` 下运行，又能在沙箱内被物理限制在指定的工具集合中；同时在 `hide-direct-tools.js` 中增加激活工具兜底。

- 改动：
  - `packages/pi-subagent/package.json` — bump 版本至 0.15.1。
  - `packages/pi-subagent/src/index.ts` — 导出 `isCodemodeActive`（优先当前会话 activeTools 动态判断），`resolveRunCfg` 与 `runSubagent` 增加 `inheritCodemode` 支持，自动补齐 `codemode`；优化 `tools` 参数 schema description。
  - `packages/pi-subagent/src/index.test.ts` — 补充 5 组针对 `inheritCodemode`、内置角色、去重及通用子代理的单元测试。
  - `~/.pi/agent/extensions/hide-direct-tools.js` — 增加当前会话 `pi.getActiveTools().includes("codemode")` 兜底判断。
  - `~/.pi/agent/npm/node_modules/@bytetrue/pi-subagent/src/index.ts` — 同步本地运行环境。
- 验证：
  - `packages/pi-subagent`: 71 个 vitest 单元测试全部通过，`tsc --noEmit` 类型检查 0 报错。
  - 代码审查：子代理审查（Task sub_6a4eadfc8208）全面通过并采纳 3 项动态会话感知与单测优化建议。
  - 真机实测：`pi --mode json -p` 派发携带 `tools: ["find", "read"]` 的子代理，成功启动并在 2 秒内通过 codemode 仅调用 find 完成任务返回。
- byissue：同步更新 `byissue/spec/pi-subagent/index.md` 中关于 codemode 继承与 tools 白名单的说明。
