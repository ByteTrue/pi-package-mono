---
kind: issue
title: "修 bug：/vendor 找不到官方 catalog，把每个模型都报成「无官方模板」"
type: bug
status: closed
created: 2026-10-11
closed: 2026-10-11
---

# 修 bug：/vendor 找不到官方 catalog，把每个模型都报成「无官方模板」

> **读者：** 以后遇到「TUI 说模型没官方模板，但脚本/官方库明明有」的人。
> **自检：** 预期 · 实际 · 最小场景 · 根因 · 影响面 · 验证 · 关闭回写。

## 预期 / 实际

- **预期：** `/vendor` 添加模型时，若该 id 在 active Pi 内置官方 catalog 里，就套用官方模板（元数据完整）；没有匹配才退化为 minimal entry。
- **实际：** 任何 id 都报 `No official catalog match for <id>; using a minimal model entry.`，保存成只有 `id` 的空壳，contextWindow/cost/compat 全丢。用户看到的是「DeepSeek Flash 这种模型官方库里没有模板」——与事实相反。

## 最小场景

`/vendor` → Add model → 选中 `deepseek-flash`（官方 `deepseek` provider 确有 `DeepSeek V4.1 Flash`）→ 得到 minimal entry + 上述 warning。

## 根因

两个独立缺陷叠加：

1. **路径解析把「包目录」当「安装前缀」。** `candidateCatalogPaths()` 只拼 `<root>/node_modules/@earendil-works/pi-ai/...`，而 `resolveCandidateRoots()` 传进来的 root 是 **`pi-coding-agent` 包自己的目录**。真实布局里 pi-ai 在 `<store entry>/node_modules/@earendil-works/pi-ai`，即 root 的**兄弟**，不是包内嵌套。于是所有候选路径全部 miss。pnpm/aube 虚拟 store 与 npm hoisted 两种布局都命中不了。
2. **「catalog 不可用」与「型号确实没有」共用一条分支。** `enrichModelId()` 里 `catalog === null` 和「查了但没有匹配」都返回 `ready + warning`，所以环境故障被伪装成对模型 id 的判定，warning 文案还把责任推给用户输入的模型。

`candidateCatalogPaths` 在 TS 与 bundled script 里**各写了一份**：脚本早先补了 `join(root, "..", "pi-ai", ...)` sibling 回退，TS 侧从未同步。这正是「脚本 `vendor.mjs catalog deepseek-flash` 正常、`/vendor` TUI 不正常」的原因，也是这次修复要把路径形状抽进 `src/shared/vendor-shared.js` 的理由。

`byissue/spec/pi-vendor/index.md` 当时已写明要支持「pi-ai 与 pi-coding-agent 同层的 hoisted 布局」——**规格是对的，实现没跟上**，属 spec-vs-code 漂移。

## 影响面

- **必须改：** `src/model-source/official-catalog.ts`（路径解析）、`src/model-source/enrich.ts`（结果分类）、`src/tui/model-pick.ts`（呈现）、`src/shared/vendor-shared.js` + `.d.ts`（共享路径形状）、`skills/pi-vendor/scripts/vendor.mjs`（改用共享函数）。
- **需要验：** `PI_VENDOR_PI_ROOT` 逃生口（此前 4 种取值全返回 null，文档承诺它是恢复手段）；打包后 tarball 内的脚本仍可解析。
- **仍未知：** 无。

## 方案

1. 路径形状收敛到 `vendor-shared.js` 的 `candidateCatalogPaths(roots)`：对每个 root 做 **Node 式祖先遍历**（逐级 `<ancestor>/node_modules/@earendil-works/pi-ai/dist/models.generated.js`，nearest-first），再补嵌套安装形状。一次覆盖 hoisted、虚拟 store、安装前缀、包目录四种入参。
2. `enrichModelId` 新增 `kind: "catalog-unavailable"`，与「查到但没有匹配」分开；TUI 对前者报环境问题，不再声称模型不在官方库。
3. `PI_VENDOR_PI_ROOT` 同时接受安装前缀与 pi-coding-agent 包目录。
4. TUI 与脚本共用同一函数，结构上消除再次分叉的可能。

## 验证

- 单测新增真实布局回归：虚拟 store sibling、hoisted、嵌套、安装前缀四种 `root` 入参（`official-catalog.test.ts`）；脚本层新增虚拟 store 与包目录两例（`vendor-script.test.ts`）。
- 用真实 Pi runtime（jiti + 真实 `argv[1]`）复跑：修复前 `findOfficialCatalogPath() = null`、`enrich = ready(minimal)`；修复后解析到 `.../@earendil-works+pi-coding-agent@1.1.0-.../node_modules/@earendil-works/pi-ai/dist/models.generated.js`，`enrich = official-ambiguous`，候选 `deepseek/deepseek-flash - DeepSeek V4.1 Flash`。
- `PI_VENDOR_PI_ROOT` 4 种取值（mise 前缀 / `@earendil-works` 目录 / 包目录 / 仓库 hoisted）全部命中。
- `npm --workspace @bytetrue/pi-vendor run typecheck` 与 `test`（200 passed）通过；全仓 `typecheck --workspaces` + `npm test` + `pack --dry-run` + image-gen pack-smoke 通过。
- 打包 tarball 解压后跑 `skills/pi-vendor/scripts/vendor.mjs catalog deepseek-flash`，返回 3 条含 `deepseek/DeepSeek V4.1 Flash`。

## 关闭回写

- 已合并进 `byissue/spec/pi-vendor/index.md`：catalog 定位语义改为「对每个 root 做 Node 式祖先遍历」，并写明 TUI 与脚本共用 `vendor-shared.js` 的路径形状；新增「catalog 不可用与无匹配必须分开」的语义。
- 教训沉淀进 `byissue/notes/001-active-pi-catalog.md`（同主题更新，不另开）。
- 发布：`@bytetrue/pi-vendor@0.6.1`。
