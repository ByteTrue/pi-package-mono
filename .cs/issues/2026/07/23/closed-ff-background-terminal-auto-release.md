---
kind: issue
title: "快改：给 background terminal 配 npm 自动发布"
type: ff
status: closed
created: 2026-07-23
---

# 快改：给 background terminal 配 npm 自动发布

## 做了什么

- 给 repo 的 GitHub Actions `release.yml` 增加 `pi-background-terminal-v*` tag 触发支持
- 在 npm package settings 里用 Trusted Publisher 把 `ByteTrue/pi-package-mono` 的 `.github/workflows/release.yml` 绑定到 `@bytetrue/pi-background-terminal`
- 把自动发布入口回写到 project spec 和 package spec

## 改了哪些

- `.github/workflows/release.yml`
- `.cs/spec/index.md`
- `.cs/spec/pi-background-terminal/index.md`

## 怎么验证

- Playwright 打开 npm package settings，完成 2FA 后看到：`Successfully added new Trusted Publisher connection.`
- settings 页现在列出 Trusted Publisher：
  - repo: `ByteTrue/pi-package-mono`
  - workflow: `release.yml`
  - permission: `npm publish`
- 本地读回 workflow，确认 tag `pi-background-terminal-v*` 会映射到 `packages/pi-background-terminal/`

## 对 `.cs/` 的影响

- project spec 新增 background terminal 自动发布入口说明
- package spec 新增 tag 发布入口与 workflow 证据索引
