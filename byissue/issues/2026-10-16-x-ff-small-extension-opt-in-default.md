---
kind: issue
title: "快改：small extension 安装菜单默认只勾基线三项，context-guard / codemode-only 转为 opt-in"
type: ff
status: closed
created: 2026-10-16
---

# 快改：small extension 安装菜单默认只勾基线三项，context-guard / codemode-only 转为 opt-in

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

用户诉求：`pi-context-guard` 与 `pi-codemode-only` 改成**默认不安装**。

- 做了什么：`scripts/install-small-extension.mjs` 引入 `optIn: true` 标记。菜单初值由「全选」改为「`!item.optIn`」——裸 `<enter>` 现在只装 `pi-bash-timeout` + `pi-ask-user`，两个 opt-in 项标 `(opt-in)` 并默认 `○`；`space` 照旧可勾，`a` 照旧全选/全不选。`--all` 语义不变（仍装全部四项，脚本/CI 路径）。
- 为什么：`pi-context-guard`（改 400k 压缩阈值 + 往 system prompt 塞会话文件指针）与 `pi-codemode-only`（拦直连工具调用 + 改写 prompt）都是**会话全局生效**的行为覆盖，取决于模型窗口和 `codemode.mode` 设置，不适合当默认基线；`pi-bash-timeout`（bash 安全网）与 `pi-ask-user`（补一个工具）才是无脑可装的。
- 改动：`scripts/install-small-extension.mjs` — `EXTENSIONS` 两项加 `optIn: true` + 注释说明；`pick()` 初值改 `items.map((item) => !item.optIn)`；菜单行追加 `(opt-in)`。
- 改动：`small-extensions/README.md` — Install 段补 opt-in 说明；表格两项标 Opt-in。
- 改动：`byissue/spec/pi-bash-timeout/index.md` — 安装通道那句「默认方向键多选」补上新的默认勾选语义。
- 怎么验证：沙箱 `HOME` + 真实 pty（`script -q /dev/null` + `stty cols 120`）跑 4 个场景——裸 `\r` → 只装 bash-timeout + ask-user；`↓↓`+`space`+`\r` → 装 context-guard、不装 codemode-only；`a`+`\r` → 四项全装；`--all` → 四项全装。`node --check` 与 `node scripts/check-small-extension-installer.mjs` 均 exit 0。
- byissue：登记本文件；`byissue/spec/pi-bash-timeout/index.md` 已在同次改动内同步。`byissue/spec/index.md` 不记录菜单默认值，无需改。
- 范围外（明确未做）：`--all` 不跳过 opt-in 项；`.agents/skills/pi-dev-setup/setup.mjs` 的项目级 `.pi/extensions/` 复制行为不变（本 worktree 调试仍要全部扩展在场）。
