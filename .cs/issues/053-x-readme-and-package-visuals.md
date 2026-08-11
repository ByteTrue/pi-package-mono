---
kind: issue
title: "重组 README 与 package 视觉"
type: chore
status: closed
created: 2026-08-11
closed: 2026-08-11
---

# 重组 README 与 package 视觉

## 做成以后是什么样

仓库根 README 能让新用户快速判断五个 package 的分工并选中安装入口；每个 package README 独立解释安装、配置、使用和边界；根仓库与五个 package 各有一张同系列主视觉，package 图片随 npm tarball 发布，不在 npm README 中断链。

**范围：** 重写根 README 和五个 package README；生成六张无文字横向主视觉；把 package 图片加入发布文件；验证事实、链接、图片与 tarball。本文档不改变 runtime 行为、工具 schema、配置格式或 package 版本。

## 当前问题

根 README 主要是包表和开发命令，缺少选择路径与共同设计原则。包 README 虽有真实信息，但层次与详略不一致，部分把内部实现证据放在用户主路径前面。仓库目前没有 logo 或图像资产。

## 文档与视觉安排

- 根 README 是用户入口：定位 → package 选择 → 安装 → 共同原则 → 本地开发。
- package README 是可独立阅读的 npm 页面：价值 → 安装/起步 → 公共表面 → 关键边界 → 开发验证。
- `.cs/spec` 继续承担完整当前真相和架构证据；README 只保留用户做决定所需的稳定事实。
- 六张图片使用同一深色编辑设计系统和不同 accent；不生成文字、假 UI 或复杂信息图。
- 图片路径固定为根 `docs/images/overview.webp` 与各包 `docs/banner.webp`；后者加入 package `files`。

## 质量承诺

- **交互能力 / 自描述性：** 新用户停在根 README 能选包；停在任一 package README 能完成安装与首次使用。以人工阅读路径和链接检查验证。
- **可维护性 / 可分析性：** 文案只描述当前 public surface，具体安全实现不与 spec 重复展开。以 public registration、package metadata 与 current spec 交叉核对。
- **兼容性：** 图片在 GitHub 与 packed npm package 中均可解析；以文件格式检查和五包 `npm pack --dry-run --json` 验证。

## 验证

- 检查六份 README 的本地链接和引用图片存在。
- 核对 package 名、安装命令、commands/tools、配置路径和默认行为。
- 验证图片格式、尺寸与大小。
- 五包测试/typecheck，以及五包 pack dry-run 包含各自 `docs/banner.webp`。

## 实现结果

- 根 README 变成 package 选择与本地开发入口；五个 package README 均提供独立的安装到首次使用路径。
- 生成一张仓库总览图和五张 package 图，统一为 1536 × 1024 WebP；优化后六图合计 345,968 bytes。
- 五个 package 的 `files` 均显式包含 `docs/banner.webp`，npm README 不依赖仓库外资产。
- reviewer 指出的 key 输入可见性、配置保证范围、tombstone 语义与 vision 首次使用问题均已修正。

## 验证证据

- `npm test`：460 passed，9 个 credential-dependent live tests skipped。
- 五个 workspace typecheck 全部通过。
- 五个 `npm pack --workspace <package> --dry-run --json` 均包含 `README.md` 与 `docs/banner.webp`；tarball 大小为 45–111 KiB。
- 六个图片文件均为有效 1536 × 1024 WebP；六份 README 的 13 个本地链接全部解析成功。
- `git diff --check`、README whitespace/control-character 检查通过。
- 两个 fresh-context reviewer 完成首次审查；修复全部 P2/P3 后，最终 reviewer 报告无 P0–P2 finding。
