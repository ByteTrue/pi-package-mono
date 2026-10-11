---
kind: issue
title: "快改：pi-dev-setup Skill 取代跟踪 .pi/settings.json"
type: ff
status: closed
created: 2026-10-12
epic: ""
---

# 快改：pi-dev-setup Skill 取代跟踪 .pi/settings.json

## 做了什么

- 新增 `.agents/skills/pi-dev-setup/`（SKILL.md + setup.mjs，进入跟踪）：执行 `node .agents/skills/pi-dev-setup/setup.mjs` 即为本 worktree 生成项目级 Pi 开发配置——扫描 `packages/*/` 有 `pi` 字段的包，写入 `.pi/settings.json`（本地路径条目 + 同名 npm 包屏蔽条目成对生成），并把 `small-extensions/*/` 的单文件扩展复制进 `.pi/extensions/`。
- 取消跟踪 `.pi/settings.json`：`git rm --cached` + .gitignore 收紧为 `.pi/` 整目录忽略。项目级配置从「手工维护的跟踪文件」变为「Skill 生成的本地产物」；新 worktree 跑一次 Skill 即得完整本地工具面。
- 理由：用户不想跟踪机器生成的项目级配置；Skill 化后配置形态沉淀在仓库里（脚本即真相），产物留在本地。
- setup.mjs 幂等（覆盖重建）、只写仓库内、保留 settings.json 除 `packages` 外的字段、复制主文件跳过测试文件、清理 `.pi/extensions/` 里已下架扩展的陈旧副本。
- 根 README 的开发配置说明指向该 Skill。

## 明确不做

- 不做交互式选项 / `--dry-run` / 清理全局安装——单一固定行为。
- 不把 setup.mjs 做成跨仓库通用工具；它锚定本仓库布局（`packages/*` + `small-extensions/*`）。
- 不改 install-small-extension 脚本（那是无仓库克隆场景的通道，与项目内调试正交）。

## 改了哪些

- `.agents/skills/pi-dev-setup/SKILL.md`（新增）
- `.agents/skills/pi-dev-setup/setup.mjs`（新增）
- `.gitignore`（`.pi/*` + `!.pi/settings.json` → `.pi/`）
- `.pi/settings.json`（取消跟踪，磁盘文件保留且已是脚本生成版）
- `README.md`（开发配置说明指向 Skill）

## 怎么验证

- `node .agents/skills/pi-dev-setup/setup.mjs`：生成 6 本地条目 + 6 屏蔽条目 + 2 个小扩展副本；与原手写配置语义一致（同集合同结构，顺序排序稳定）。
- 真实 Pi 启动（生成配置生效）：toolsAdded 包含 ask_user、background 三件套、subagent 三件套、web 两件套；npm 同名包未重复注册。
- `git ls-files .pi/` 为空；`.agents/` 进入未跟踪待提交。
- merge 后基线 `npm test` 全绿（715 passed）。

## 对 byissue/ 的影响

已同步 spec：`byissue/spec/index.md` 架构考量新增「项目级 Pi 配置由 pi-dev-setup Skill 生成，不再跟踪」条目。

## 顺手发现

- 块注释里写 `small-extensions/*/ single-file` 会让 `*/` 提前闭合注释导致 SyntaxError——写成 "small-extensions single-file" 即可，纯手滑教训不进 notes。
- codemode 模式下 system prompt 的 tools 区只列直调工具，验证扩展注册要看 JSON 流的 `toolsAdded` 字段。
