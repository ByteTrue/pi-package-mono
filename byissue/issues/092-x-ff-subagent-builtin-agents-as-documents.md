---
kind: issue
title: "内置角色改为包内 agent 文档：与用户 .pi/agents 同一套解析"
type: ff
status: closed
created: 2026-09-17
---

# 内置角色改为包内 agent 文档：与用户 .pi/agents 同一套解析

内置 `scout` / `researcher` / `reviewer` 原先硬编码在 `src/builtin-agents.ts` 的 TS 常量里，与用户手写的 `.pi/agents/*.md` 是两套东西。现在它们就是包内 `agents/*.md`，由同一个 `parseAgentFile` 解析、走同一条候选链，只是排在最后兜底；用户放一份同名文档即可覆盖，模型/思考/工具/提示词都在文档 frontmatter 与正文里。

- 改动：`packages/pi-subagent/agents/{scout,researcher,reviewer}.md` — 新增，内容与原 TS 常量逐字段一致（scout `thinking: minimal`、reviewer `thinking: max`、researcher 不设）。
- 改动：`packages/pi-subagent/src/builtin-agents.ts` — 只留 `AgentConfig`、包内 `agents/` 目录定位（`import.meta.url` 相对，安装后可解析）与 `listBuiltinAgentNames()`。
- 改动：`packages/pi-subagent/src/index.ts` — `findAgentDefinition` 候选链末尾追加包内 `agents/<name>.md`，删掉常量分支；导出 `BUILTIN_AGENTS_DIR` / `listBuiltinAgentNames`（`BUILTIN_AGENTS` 常量不再存在）。
- 改动：`packages/pi-subagent/src/settings.ts`、`src/command.ts` — 角色发现读包内目录；`/subagent show` 措辞改为 agent documents。
- 改动：`packages/pi-subagent/src/index.test.ts` — 内置断言改走文档解析；新增用户同名文档覆盖内置、且不波及兄弟内置的用例。
- 改动：`packages/pi-subagent/package.json` — `files` 加 `agents`，否则发布物缺目录。
- 验证：26 项包测试、typecheck 全绿。`npm pack --dry-run` 列出 11 个文件含 `agents/*.md`；把 tarball 解到临时目录后 `findAgentDefinition` 仍解析出三个内置角色（目录定位不依赖源码树）。用户同名文档覆盖实测：`scout` 变成自定义 model/thinking/tools，`reviewer` 不受影响。
- byissue：已同步 `byissue/spec/pi-subagent/index.md`（内置角色改为文档机制、模型优先级描述）；README 同步。

顺手发现（不在本次范围）：`subagent.agents[x].model`（`/subagent` 菜单写的角色设置）仍压过 agent 文档。文档现在是角色的「定义」，这个优先级是否该反过来，需要另定。

## 发布记录（2026-09-17）

- 与 `091`（思考档两端 + `off` 继承）合并发布：版本 `0.8.0` → `0.8.2`（`0.8.1` 只落过本地提交，从未发布）。
- 提交 `6539693`；tag `pi-subagent-v0.8.2` 触发 release.yml（Trusted Publishing OIDC，带 provenance）。
- npm registry 确认：`dist-tags.latest` = `0.8.2`；发布物含 `agents/{scout,researcher,reviewer}.md`（总 11 文件）。
- 从 npm 安装的 `0.8.2` 包内 `findAgentDefinition` 实测解析出三个内置角色（目录定位不依赖源码树）。
- Release run `35210192061`：success；main CI run `35210182171`：success（即随本批提交修复的 pack-smoke）。
