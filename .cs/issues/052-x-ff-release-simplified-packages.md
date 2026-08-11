---
kind: issue
title: "发布五个简化后的 package"
type: ff
status: closed
created: 2026-08-11
closed: 2026-08-11
---

# 发布五个简化后的 package

## 目标

把仓库级 Ponytail 清理后的五个 package 发布到 npm，并验证 main、tags、GitHub Actions 与 registry 一致。

## 发布结果

| Package | Version | Tag | Release run |
|---|---:|---|---:|
| `@bytetrue/pi-background-terminal` | `0.4.0` | `pi-background-terminal-v0.4.0` | `31506737852` |
| `@bytetrue/pi-image-gen` | `0.2.1` | `pi-image-gen-v0.2.1` | `31506743564` |
| `@bytetrue/pi-vendor` | `0.3.2` | `pi-vendor-v0.3.2` | `31506747975` |
| `@bytetrue/pi-vision` | `0.2.1` | `pi-vision-v0.2.1` | `31506753075` |
| `@bytetrue/pi-web-search` | `0.2.1` | `pi-web-search-v0.2.1` | `31506765938` |

发布代码 commit：`2e8d31687f2efddde450cb473f44a95d97db86bc`。

## 验证证据

- `npm test`：460 passed，9 个 credential-dependent live tests skipped。
- 五个 workspace typecheck、五个 `npm pack --dry-run --json` 与 `pi-image-gen` 真实 tarball production-install smoke 均通过。
- 独立 fresh-context release reviewer：GO，无 P0–P2 finding。
- main CI run `31506560477`：success。
- 五个 Release runs：全部 success。
- 五个远端 tags 均指向 `2e8d31687f2e`。
- npm registry 逐包验证：目标版本存在、`dist-tags.latest` 等于目标版本、integrity 与 tarball metadata 非空。
- `pi-web-search` production `undici` 精确固定为首个安全且通过 proxy regression 的 `8.9.0`；仓库 audit 剩余报告来自兼容性 peer/dev fixture `@earendil-works/pi-coding-agent@0.79.10` 内嵌的 `undici 8.5.0`，不属于发布包的 direct runtime dependency。

## 事件说明

首次把五个 tags 放在一次 push 中时，GitHub 因单次超过三个 tags 而不创建 push events。确认 registry 尚未发布后，删除这五个远端 tags 并逐个重新 push；五个 Release workflows 随后正常触发并成功。最终 tag 名、target commit 与 npm artifacts 未改变。
