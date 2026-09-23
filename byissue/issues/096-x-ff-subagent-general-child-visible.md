---
kind: issue
title: "subagent 通用子 agent 可见性：四处模型可见文本补上省略 agent 的默认路径"
type: ff
status: closed
created: 2026-09-23
---

# subagent 通用子 agent 可见性：四处模型可见文本补上省略 agent 的默认路径

使用中发现：模型委派 subagent 时总会填一个内置角色（如 dogfood 任务填 `scout`），从不使用省略 `agent` 的通用路径。根因不是执行逻辑——`findAgentDefinition(cwd, undefined)` 返回空配置、`buildPiArgs` 不追加 `--tools`，子进程本来就会继承父会话 model/thinking 并落回 pi 默认工具 `read, bash, edit, write`；问题是 description / promptSnippet / promptGuidelines / `agent` 参数描述四处**只罗列了 scout/researcher/reviewer**，通用路径不可见，模型于是总在三个名字里挑最接近的（dogfood → recon → scout，而 scout 连 bash 都没有）。

改为在四处模型可见文本里正向说明默认路径（decision 001）：省略 `agent` 是通用子 agent，角色只在任务恰好匹配时用。

- 改动：`packages/pi-subagent/src/index.ts` — tool description / promptSnippet / promptGuidelines / `agent` 参数描述，全部改为「general-purpose by default」措辞；执行逻辑零改动。
- 改动：`packages/pi-subagent/src/index.test.ts` — schema 用例补断言：四处文本必须提到省略 `agent` 的通用路径，防回归。
- 改动：`packages/pi-subagent/README.md` — `agent` 参数行、usage example（先给无 agent 例）、Built-in roles 段落说明默认通用、内置角色是 opt-in。
- 改动：`packages/pi-subagent/package.json` + `package-lock.json` — 0.9.0 → 0.9.1。
- 验证：`npx vitest run -t "flat single-task schema"` 通过；包测试 28 passed / 1 failed（`sessionLogPath` Windows 路径用例，clean HEAD 同样失败，与本次无关）；typecheck 通过。真实 A/B（`glm-5.3-flash`，`pi -p --mode json -e <扩展>`）：同一「建文件→cat 验证→删文件」委派提示，旧 npm 0.9.0 文案下模型发 `{"agent":"scout",...}`（scout 无 bash/write，干不了这个活），新文案下发 `{"task":...}` 走通用子 agent；「读 README 报一个 issue」这类真 recon 任务仍会选 `scout`，角色没被废掉。
- byissue：已同步 `byissue/spec/pi-subagent/index.md`（当前表面 + 使用路径表）。

顺手发现（不在本次范围）：`sessionLogPath` 用例在 Windows 上稳定失败（`src/index.test.ts:578`，clean HEAD 也失败）→ 已由 ff 098 修；`agent` 传未知名字时静默退化成通用子 agent，没有提示或报错 → 已由 ff 097 改为报错。

发布：版本已 bump 到 0.9.1，未 commit / 未发布（需用户授权）。

## 发布记录（2026-09-23）

- 与 `097`（未知角色名报错）、`098`（Windows 测试修正）合并发布：`0.9.0` → `0.9.1`。
- 提交 `2283a3e`；tag `pi-subagent-v0.9.1` 触发 release.yml（Trusted Publishing OIDC，带 provenance）。
- npm registry 确认：`dist-tags.latest` = `0.9.1`；`gitHead` = `2283a3e5c6bb9d8da42c47505a10feb17b8e6afb`；provenance predicate `https://slsa.dev/provenance/v1`。
- 解包 tarball 核对：11 文件，`agents/{scout,researcher,reviewer}.md` 齐全；`src/index.ts` 含 “general-purpose by default” 文案、`resolveAgentRole`、`Unknown agent role` 错误文本。
- 本地安装已同步：`pi update npm:@bytetrue/pi-subagent` → `~/.pi/agent/npm/.../pi-subagent` 0.9.1，与仓库源码逐字节一致。
