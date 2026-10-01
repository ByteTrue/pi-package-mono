---
kind: issue
title: "pi-web-search 依赖审计清零：undici 8.9.0 → 8.11.2 并升 0.5.1"
type: ff
status: closed
created: 2026-10-01
---

# pi-web-search 依赖审计清零：undici 8.9.0 → 8.11.2 并升 0.5.1

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

`npm audit` 此前有两条 high：`undici@8.9.0`（advisory 8.0.0–8.10.1，修好 8.11.2，落在 `@bytetrue/pi-web-search` 的直接依赖上）与 dev 树里的 `brace-expansion@5.0.9`（advisory 4.0.0–5.0.11，修好 5.0.12）。两者都修掉，现在 `found 0 vulnerabilities`；`pi-web-search` 顺版到 0.5.1 重新发布，让 npm 上的发布物不再带 8.9.0。

`undici` 卡住的原因是这个 pin 写了**两处**——root `overrides` 才是在 workspace 里真正生效的那处（只改包内 `dependencies` 无效）：

- 改动：`packages/pi-web-search/package.json` —— `"undici": "8.9.0"` → `"8.11.2"`，并 `"version": "0.5.0"` → `"0.5.1"`。
- 改动：`package.json` —— `overrides.undici` `"8.9.0"` → `"8.11.2"`（该 override 由 `a3eb459` "chore: harden worktree setup" 引入，本仓唯一一处 override）。
- 改动：`package-lock.json` —— `node_modules/undici` 8.11.2（new integrity）、`node_modules/brace-expansion` 5.0.12；后者由 `npm audit fix` 生成，**故意不加 root override**：它只是 dev 树里的传递依赖（`@earendil-works/pi-coding-agent` → `minimatch@10.2.5` 要求 `^5.0.5`），semver 范围内升到 5.0.12 即修好，加 override 反而会对将来需要 `brace-expansion@^2` 的依赖强制不兼容。
- 验证：`npm audit` → `found 0 vulnerabilities`；`npm run typecheck --workspaces --if-present` → `TYPECHECK_EXIT=0`（六包全过）；`npm test` → `pi-web-search` 12 files / 115 passed + 9 skipped，`pi-vendor` 191，`pi-vision` 87 全绿。
- byissue：无影响。`byissue/spec/pi-web-search/index.md` 的「验证」段与实际做法一致（未记录依赖版本，无需改）；根 spec 的依赖/override 约定也未变，只是把 override 的目标版本跟到已发布包同一个 pin。

**已知非本次引入的失败（与本改动无关）**：`npm test` 在 `pi-subagent` 报 2 条 Windows 专属失败——`packages/pi-subagent/src/settings.test.ts:80,81,82,91` 的 `statSync(...).mode & 0o777` 断言缺 `process.platform !== "win32"` 守卫（`pi-vendor/src/config-core.test.ts:47`、`pi-vision/src/vision-command.test.ts:76` 有该守卫）。已在 4dbaba7 引入；`git stash` 掉本次全部改动后单跑 `npm --workspace @bytetrue/pi-subagent test` 仍然同样 2 条红，反证与 undici 无关。CI 跑 ubuntu，因此不影响本包发布。

## 发布

- tag `pi-web-search-v0.5.1` 触发 `.github/workflows/release.yml`（OIDC Trusted Publishing，无需 NPM_TOKEN）；本机 npm 未登录（`ENEEDAUTH`），只能走 CI。
- 发布前检查：`npm view @bytetrue/pi-web-search versions` 停在 0.5.0，0.5.1 未被占用。

顺手发现（不在本次范围）：`packages/pi-subagent/src/settings.test.ts` 的 mode 断言缺 Windows 守卫。
