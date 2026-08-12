---
doc_type: issue-fix
issue: 2026-07-11-web-config-invalid-preserve
path: fast-track
status: review-passed
fix_date: 2026-07-11
related: [../../audits/2026-07-11-pi-web-search-0-1-1/finding-04.md]
tags: [config, data-loss, web-command]
---

# /web 无效配置保护修复记录

## 1. 问题描述

`readConfig()` 为保证扩展启动 fail-soft，把“文件不存在”和“文件损坏/不可读/schema invalid”都返回 `{}`。`/web` 无法区分，保存任一设置时会以空对象原子替换原文件，造成凭证、proxy 与 base URL 丢失。

用户按 audit 顺序回复“继续”，确认快速通道修复。

## 2. 根因

`packages/pi-web-search/src/config.ts` 的配置读取 API 丢失了来源状态；`packages/pi-web-search/src/tools.ts` 的 `/web` handler 把 `{}` 无条件视为可写配置。

## 3. 修复方案

- 新增 `readConfigResult()` 三态：
  - `missing`：返回空 config，允许 `/web` 创建新文件
  - `valid`：返回已校验 config
  - `invalid`：返回不含文件内容的路径/解析错误
- 保留 `readConfig()` 兼容行为：运行时 search/fetch 启动仍 fail-soft 为 `{}`
- `/web` 改用三态 API；invalid 时 notify error 并在任何 select/write 前 return

### 第一性原则 pre-pass

- 只阻断“无法证明写入基底有效”的交互写路径
- 不改变 search/fetch 启动容错，不自动备份/修复/删除用户文件
- 不引入新配置类或依赖

## 4. 改动文件清单

- `packages/pi-web-search/src/config.ts`：三态读取 + 保留 fail-soft wrapper
- `packages/pi-web-search/src/tools.ts`：`/web` invalid fail-closed
- `packages/pi-web-search/src/config-file.test.ts`：missing/valid/malformed/schema-invalid；真实 `/web` handler 不覆盖原 bytes

## 5. 验证结果

- tests-first：新增 4 项初始全失败（缺 API；handler 继续进入 select）
- 修复后定向：14 passed
- pi-web-search：77 passed，9 skipped
- 全仓：121 passed，9 skipped
- 两个 workspace typecheck：通过
- `git diff --check`：通过
- 回归测试确认 malformed 原文件 byte-for-byte 不变，通知含 config 路径但不含原配置内容；测试先证明原生 `JSON.parse` message 会包含 `LEAKME`，再证明 `/web` 固定错误不会泄漏它

## 6. 遗留事项

- search/fetch 对 invalid config 仍按既定 fail-soft 使用默认设置；只有可能写盘的 `/web` fail closed
- 不处理并发进程在读取后、写入前修改文件的竞态；这是独立并发控制问题
- 独立 subagent 最终 0 blocking / 0 important；DeepSeek OCR 0 comments；review gate passed。待 audit 回写与 commit，不 push。
