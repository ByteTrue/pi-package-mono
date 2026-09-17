---
kind: issue
title: "制度记忆产物目录从 codestable/ 更名为 byissue/"
type: ff
status: closed
created: 2026-09-17
---

# 制度记忆产物目录从 codestable/ 更名为 byissue/

用户切换到 ByIssue（bi）工作流，要求把 CodeStable 的产物目录 `codestable/` 换成新名字。新名字按 ByIssue 契约定为 `byissue/`。这是一次纯目录改名加引用更新：实体内容、编号、冻结 archive 均不动。

- 改动：`git mv codestable byissue`，整树原样搬移；`archive/codestable-legacy/` 冻结历史随之移动但不改写内部记录。
- 改动：现行实体（spec、epics、issues、notes、talks、vision）及 README 中所有 `codestable/...` 路径引用统一更新为 `byissue/...`；`codestable/archive/codestable-legacy` 形式的引用变为 `byissue/archive/codestable-legacy`（archive 指针更新、冻结目录名不变）。
- 不改：`skills-lock.json` 的 `"source": "codestable/CodeStable-Lite"`（GitHub owner/repo，非本仓库路径）；历史记录中的 `.codestable` 旧系统根引用与 ff 正文里的 `codestable：` 说明标签（历史不改写）；`notes/003-legacy-codestable-archive.md` 文件名（主题名准确）。
- 验证：全仓 grep 确认现行文件中已无 `codestable/` 路径引用，残留仅为上述有意保留项；git status 全部为 R（rename）+ README 修改，无内容丢失。
- byissue：本条即变更记录；`archive/MIGRATION.md` 追加 2026-09-17 迁移条目。
