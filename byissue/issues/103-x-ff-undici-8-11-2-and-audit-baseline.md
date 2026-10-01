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

## 发布（2026-10-01）

- commit `884fbae` 推送 `origin/main`（fast-forward，父提交 `663c5ba`）；tag `pi-web-search-v0.5.1` 按提交哈希显式创建（轻量 tag，与 `pi-web-search-v0.5.0` 一致），推送后触发 `release.yml` run `36810468826`（OIDC Trusted Publishing，无需 NPM_TOKEN；本机 npm 未登录 `ENEEDAUTH`，只能走 CI）。57s 全绿：`npm ci` → typecheck → `npm test`（ubuntu）→ `→ publishing @bytetrue/pi-web-search@0.5.1`，provenance 入 transparency log `logIndex=3029692128`。
- npm 已生效：`dist-tags.latest = 0.5.1`；本地 `npm view` 一度仍读回 0.5.0（客户端缓存），直接用 `curl https://registry.npmjs.org/@bytetrue%2fpi-web-search` 反验才看到 0.5.1 与 `latest` 更新——**发布后核验别只信 `npm view` 的第一读**。
- tarball 反验：sha1 `75e86f260befc26508262a752a3f0cb3412a5bce`（与 CI 的 shasum 逐字符相同）、22 文件、`package/package.json` 为 `version 0.5.1` + `dependencies.undici 8.11.2`，零测试泄漏。
- 本机 Pi 安装（`~/.pi/agent/npm`）已从 0.5.0（undici 8.9.0）升到 0.5.1（undici 8.11.2）；**其他机器需用户自行更新**（否则仍跑带漏洞的 8.9.0）。
- 残留不在本仓范围：该安装目录里 `@earendil-works/pi-coding-agent/node_modules/brace-expansion` 仍是 5.0.9（其 `minimatch@10.2.6` 要求 `^5.0.8`，lockfile 标记为 `peer: true`，`npm audit fix`/`npm update` 都不动它）。这属于 Pi 本体依赖树，不属于本仓任何包。

顺手发现（不在本次范围）：`packages/pi-subagent/src/settings.test.ts` 的 mode 断言缺 Windows 守卫（详见上文「已知非本次引入的失败」）。
