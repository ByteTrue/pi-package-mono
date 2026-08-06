---
kind: issue
title: "快改：发布所有落后于 main 的 npm 包"
type: ff
status: open
created: 2026-08-07
---

# 快改：发布所有落后于 main 的 npm 包

## 做了什么

比对 5 个现存 workspace 的 npm latest、release tag 与 tag 后 package path 差异。仅 `pi-web-search`、`pi-image-gen` 的发布内容落后于 `main`；两者均有 0.x 破坏性演进，目标版本定为 `0.2.0`。

## 改了哪些

- `@bytetrue/pi-web-search`：`0.1.3` → `0.2.0`。
- `@bytetrue/pi-image-gen`：`0.1.0` → `0.2.0`。
- 同步 root `package-lock.json`。
- `pi-vendor 0.3.1`、`pi-background-terminal 0.3.1`、`pi-vision 0.2.0` 与各自 release tag 一致，不发布空版本。

## 怎么验证

- 全仓 typecheck 通过。
- 全仓 490 tests passed；Web live E2E 9 skipped。
- Web 0.2.0 pack：21 files / 76,564 bytes，关键入口存在。
- Image 0.2.0 pack：63 files / 120,842 bytes；真实 tarball 经 production install 后可加载 `/image-gen`、零 Agent tool，Skill CLI wrapper 可运行。
- `@bytetrue/pi-web-search@0.2.0` 已由 release workflow 发布，npm provenance 指向 GitHub Actions。
- `@bytetrue/pi-image-gen@0.2.0` 尚未占用；npm Trusted Publisher 配置已核对为 `ByteTrue/pi-package-mono` + `release.yml` + `npm publish`。首次 publish 遇到 npm OIDC 404；后续 rerun 遭遇 GitHub hosted runner acquisition 故障，待新 release run 完成后关闭。

## 对 `.cs/` 的影响

不改变两个包的当前产品规格；仅发布已经关闭并验证的现状实现。
