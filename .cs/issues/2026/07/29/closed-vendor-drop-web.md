---
kind: issue
title: "删掉 pi-vendor 的 Web 与死码"
type: chore
status: closed
created: 2026-07-29
epic: ".cs/epics/2026/07/29/vendor-ai-first/spec.md"
---

# 删掉 pi-vendor 的 Web 与死码

## 目标

`@bytetrue/pi-vendor` 不再包含任何 Web 管理界面、`SecretRef` 机制、前端构建步骤与生成产物。删完后 `/vendor` TUI 仍可用，typecheck 与测试全绿。

## 范围

- 包含：`src/web/` 全部、`SecretRef` / `mask`、6 个 1 行 re-export 空壳、`build:web` / `dev:web` / `pack-smoke` 脚本与对应 `scripts/*.mjs`、`esbuild` devDependency、TUI 根菜单里的 `open-web` 分支与 `command.ts` 中对应 dispatch、`index.ts` 里指向已删文件的导出
- 不包含：TUI 流程重写（切片 2）、`fuzzy.ts`（切片 2 要接进 `custom-select`，本切片**保留**）、spec / README 重写（切片 4）

## 归属

- 隶属 epic：`.cs/epics/2026/07/29/vendor-ai-first/spec.md`（切片 1）
- 相关 spec：`.cs/spec/pi-vendor/index.md`（切片 4 重写，本切片不动）

## 背景与证据

- Web 占包 8,908 行 / 59%，是 review 成本最高、最易出微妙错误的部分。
- `SecretRef` / `mask` 已验证在 `src/web/` 之外**零引用**——它唯一存在理由是"浏览器不能看到明文 key"。
- Web 额外背着 esbuild 构建、提交进仓库的生成产物（`src/web/assets/app.js`、`style.css` 与 `src/web/client/style.css` 重复 745 行）、CSP / bearer token / socket 拆除 / session 生命周期。
- `src/enrich.ts`、`official-catalog.ts`、`openai-models.ts`、`templates.ts`、`custom-select.ts`、`vendor-ui.ts` 各 1 行，只做 `export * from`。
- owner 已确认放弃"不用 AI 也能管全部"的产品承诺，Web 不保留不冻结。

## 现状如何工作

一句话：`/vendor` → 根菜单四项（Add model / Add provider / **Open Web** / Cancel）→ 选 Open Web 会起 loopback 一次性 server、开浏览器、走 draft + SecretRef + revision 提交。

删除后：根菜单不再有 Open Web；`/vendor web` 子命令一并消失。

## 影响范围

- **必须修改**
  - 删 `src/web/`（含 `build.mjs`、`assets/`、`client/`、`server/`）
  - 删 6 个空壳 re-export；把仍在用的导入改指真实路径
  - `src/index.ts`：移除指向已删文件的导出
  - `src/tui/quick-root.ts`：`RootAction` 去掉 `open-web`，choices 去掉对应项
  - `src/command.ts`：移除 open-web dispatch 与 `/vendor web` 处理
  - `package.json`：删 `build:web` / `dev:web` / `pack-smoke` / `prepack`、`esbuild` devDep；`files` 字段确认不再引用 web 产物
  - 删 `scripts/dev-web.mjs`、`scripts/pack-smoke.mjs`
- **需要验证**
  - `typecheck` 与 `vitest` 全绿
  - `/vendor` 根菜单剩三项且 Add model / Add provider 仍能走完
  - `npm pack --dry-run` 不再包含 web 产物
- **仍待调查**
  - `src/model-list.ts`（33 行）是否已被 `src/config-mutations.ts` 取代成死码。是则连同 `model-list.test.ts` 一并删；不是则保留，**不预先断言**。

## 操作方案

1. 先查 `model-list.ts` 的引用面，定它去留。
2. 删 `src/web/`，然后靠 typecheck 找出所有断掉的引用，逐个处理——不靠 grep 猜。
3. 空壳 re-export：先确认每个的下游引用，改指真实路径后再删。
4. `package.json` 与 `scripts/` 收尾。
5. `prepack` 依赖 `build:web`，删 script 时确认没有其它地方依赖 `prepack`。

## 风险边界

- **可能影响**：`src/index.ts` 的公开导出面会缩小；如果有外部消费者 import 过 `createCustomInput` / `createCustomSelect` 之类，路径不变但来源文件变了（re-export 删除后需从 `tui/` 导入）。
- **明确不碰**：`config-core` / `config-document` / `config-mutations` / `models-json` / `model-source/` / `fuzzy.ts`。
- **需要用户确认**：无（owner 已授权直接开）。

## 验证

- `npm --workspace @bytetrue/pi-vendor run typecheck` —— 通过
- `npm --workspace @bytetrue/pi-vendor test` —— 18 文件 / 153 测试全过
- `npm pack --workspace @bytetrue/pi-vendor --dry-run` —— 无 `src/web/` 产物（仅剩 `model-source/web-enrich.ts`、`web-model-dto.ts`，见下方说明）
- `src/index.test.ts`（本切片新增）—— 断言 extension 只注册 `vendor` 命令、不再注册任何生命周期 hook
- 真机 `/vendor` —— **推迟到切片 2**，理由见执行记录

## 执行记录

### 死码判定结果

- `src/model-list.ts`：只被自己的 `model-list.test.ts` 引用，**确认是死码**，与测试一并删除。功能已由 `config-mutations.ts` 覆盖。
- 6 个 1 行 re-export 空壳（`enrich` / `official-catalog` / `openai-models` / `templates` / `custom-select` / `vendor-ui`）：**下游零引用**。之前 grep 命中的都是 `model-source/` 与 `tui/` 内部指向自己同级文件，不是这些空壳。全部删除。

### 实际删除

- `src/web/`（全部：`build.mjs`、`assets/`、`client/`、`server/`，含 `mask.ts` / `SecretRef` 全套）
- 6 个空壳 re-export、`model-list.ts` + 测试
- `scripts/dev-web.mjs`、`scripts/pack-smoke.mjs`（`scripts/` 目录随之移除）
- `package.json`：`build:web` / `dev:web` / `prepack` / `pack-smoke` 四个 script、`esbuild` devDependency（`package-lock.json` 已同步；esbuild 仍留在 lock 里是因为 `pi-background-terminal` 需要它）

### 被本次改动孤立、随手清掉的

- `enrichModelForWeb()`（`model-source/web-enrich.ts`，~50 行）：唯一消费者是已删的 `web/server/session.ts`
- `WebModelEnrichmentResult`（`model-source/web-model-dto.ts`）：随上面一起孤立
- 对应测试块与 `index.ts` 导出

### 保留但需后续处理（顺手发现）

- **`model-source/web-enrich.ts` 与 `web-model-dto.ts` 保留**：`tui/quick-add-provider.ts`、`tui/quick-add-model.ts` 用 `enrichModelForTui`，`model-source/catalog-search.ts` 用 `toWebModelConfig`。**不是死码。**
- 但 Web 没了之后，`web-enrich` / `web-model-dto` / `WebModelConfig` / `WebCompat` / `WebCost` 这套命名已经名不副实。改名属于切片 2（TUI 重写）或切片 4（统一语言重写），本切片不动。
- `web-enrich.ts` 现在只剩一个 5 行的 `enrichModelForTui` 直通 `enrichModelId`。折叠掉它要改 TUI 测试的 mock（`vi.mock("../model-source/web-enrich.js")`），归切片 2。

### 体量

`src/` 共 15,096 行 → **5,840 行**（-9,256，-61%）。epic 预估终态 ~4,300：切片 2 会把 TUI 1,780 压到 ~400，切片 3 加 ~150，与预估一致。

### 真机验证为什么推迟

本 repo `.pi/settings.json` 只加载本地 `pi-background-terminal`；`@bytetrue/pi-vendor` 是全局装的已发布 0.2.2。当前 Pi session 里的 `/vendor` 跑的是**带 Web 的published 版本**，不是本工作树。要真机验证得先改 settings 加载本地包并停用全局包（否则按 `.cs/notes/pi-local-package-loading.md` 会 tool 冲突），再 reload Pi。

切片 2 会重写整个 TUI，届时必须真机验证。为中间态单独做一次 settings 切换 + reload 收益很低，故推迟。切片 1 改动本身由 typecheck + 153 测试 + registration smoke + pack dry-run 覆盖。

## 关闭结论

- Web runtime、SecretRef/mask、生成资产、Web scripts 与专属依赖已全部删除；CI 的 Web build/pack-smoke 残留也在最终 review 中移除。
- `model-list.ts`、6 个空壳 re-export 与后续孤立的 Web DTO/adapter 均确认无消费者后删除或收口。
- 包最终 `npm pack --dry-run` 只含 extension source、Skill、key helper 与 README，无 Web 资产。
- 切片 1 提交：`3095439`。后续 TUI/Skill 收口见同 epic 的关闭 issues。
