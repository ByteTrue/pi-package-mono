---
kind: issue
title: "pack smoke 在 npm 10 崩溃：按消费者视角安装解压后的 tarball"
type: ff
status: closed
created: 2026-09-17
---

# pack smoke 在 npm 10 崩溃：按消费者视角安装解压后的 tarball

CI 挂在 `pi-image-gen` 的 pack smoke：解压 tarball 后当根项目跑 `npm install --omit=dev`，npm 10（Node 22 自带）在 arborist 里抛 `Cannot read properties of null (reading 'edgesOut')`。根因是 `--omit=dev` 先建完整依赖树、最后才剪 dev，所以 vitest 4 的 devDeps 仍被解析；解压目录是根项目，npm 于是去解 vitest 4 → vite 8 的 peer 树并踩中 npm 10 的 bug。npm 11 修了同类 peer 递归，所以本地一直绿、CI 才红。

真实消费者是把包当依赖装，npm 从不解析依赖的 devDeps（实测 npm 10 把 tarball 当 `dependencies` 装完全正常）。所以修法是让 smoke 里的安装也长成消费者那样。

- 改动：`packages/pi-image-gen/scripts/pack-smoke.mjs` — 安装前从解压出的 manifest 删掉 `devDependencies` 再 `npm install --omit=dev`；脚本注释说明原因。
- 验证：用 npm 10.9.9 复现原崩溃并确认修复后全绿；npm 11 仍绿；`npm run typecheck --workspaces`、`npm test`、vendor/browser dry-run 与 pack smoke 全过。
- byissue：无影响（未描述该 smoke 的安装细节）。

顺手发现（不在本次范围）：`packages/pi-image-gen/scripts/` 不进发布物，`npm pack` 的 `files` 白名单本身正确。
