---
kind: issue
title: "快改：移除 pi-codemode-only 小扩展"
type: ff
status: closed
created: 2026-10-28
epic: ""
---

# 快改：移除 pi-codemode-only 小扩展

> 做了什么 · 改了哪些 · 怎么验证 · 对 `byissue/` 有无影响

用户决定不再需要 `pi-codemode-only`（拦直连工具调用 + 改写 system prompt 里两处
直连工具指针），整条发行面移除。

## 改动

- 删除 `small-extensions/pi-codemode-only/`（`.ts` / `.test.ts` / `README.md` /
  `package.json` / `tsconfig.json`）。
- `scripts/install-small-extension.mjs`：`EXTENSIONS` 去掉该条目，剩 4 项
  （`pi-bash-timeout`、`pi-ask-user`、`pi-goal`、`pi-context-guard`），
  opt-in 只剩 `pi-context-guard`。
- 根 `README.md`、`small-extensions/README.md`：去掉表格行与 opt-in 名单里的引用。
- `package-lock.json`：`npm install` 重算，删掉 `node_modules/pi-codemode-only` 链接
  与 workspace 条目（`--package-lock-only` 会把它标成 `extraneous` 留着，需手动清）。
- `byissue/spec/index.md`、`byissue/spec/pi-bash-timeout/index.md`、
  `small-extensions/pi-ask-user/README.md`：相关引用改为历史叙述。

## 保留（有意）

- `byissue/notes/019-hidden-tool-guidelines-skip-rules.md` 不删也不改：它记的是
  **Pi 自身机制**（`codemode.mode: "only"` 下工具成为 hidden declaration，
  `promptGuidelines` 进不了 `<rules>`），与这个扩展存不存在无关，ask_user 的
  触发优先文案仍然依赖它。
- `byissue/issues/116-x-pi-1.1.0-and-two-small-extensions.md`、
  `byissue/issues/2026-10-16-x-ff-small-extension-opt-in-default.md` 等历史 issue 不动。

## 验证

- `node scripts/check-small-extension-installer.mjs` → `OK (4 extensions)`
- `npm run typecheck --workspaces --if-present` → 0 error
- `npm test` → 全部通过（少一个 10 测试的用例集）
- 本机 `~/.pi/agent/extensions/` 从未装过该扩展（本来就只有 ask-user /
  bash-timeout / goal / byspace-terminal-activity），无需卸载。
