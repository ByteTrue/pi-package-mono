---
kind: issue
title: "快改：ask_user 参数在引号附近被截断（Invalid arguments: ... after JSON at position N）"
type: ff
status: closed
created: 2026-10-22
epic: ""
---

# 快改：ask_user 参数在引号附近被截断

> 做了什么 · 改了哪些 · 怎么验证 · 对 `byissue/` 有无影响

用户报告：`options[].description` 含全角引号（「」/“”）时，ask_user 的 JSON 参数
「被提前截断」，报 `Invalid arguments: Unexpected non-whitespace character after JSON
at position N`，位置落在引号附近；不含引号的成功用例全部正常。用户推测序列化或传输
层把全角引号当成了字符串定界符。

## 调查结论：全角引号不是原因

实测（`@earendil-works/pi-ai` 的 `parseToolCallArguments`，即 Pi 解析参数的同一函数）：

| 载荷 | 长度 | 结果 |
|---|---|---|
| 成功用例（全角冒号/括号/顿号） | 80 | OK |
| 失败用例 2（含「」） | 66 | **OK** |
| 失败用例 3（含“”） | 85 | **OK** |
| 上面任一条末尾多一个 `}` | +1 | FAIL: `Unexpected non-whitespace character after JSON at position 66` |

真实运行也无法复现：直连用户的 bytetrueapi 中转（magpie :3425）与 agtp-newapi，
用原样中文描述 + 全角引号发 60+ 次工具调用流（单问/4 问 16 选项/双工具调用并发），
逐条拼接 `arguments` 再解析，**0 次失败**；跨 9 个模型（claude/gpt/deepseek/qwen/glm/
gemini）同样 0 次。Pi 的 JSON 修复层 `repairJson` 只改控制字符与非法转义，不碰全角引号。

关键判据：这个报错**只在「一个完整合法的 JSON 后面还有非空白字符」时出现**，且报错
位置恰好等于第一份 JSON 的长度。也就是说参数文本里出现了「一个完整对象 + 尾巴」，
而不是字符串内部被截断。两种现实来源：

1. 某个中转把增量 delta 当累计快照重发，拼接后得到 `{...}{...}`；
2. 模型自己多写了一个闭合括号（`{...}}`）。

两者都与引号无关——用户观察到的「引号附近」是因为引号恰好出现在 payload 尾部。

## 做了什么

`small-extensions/pi-ask-user/pi-ask-user.ts`：给 `registerTool` 增加

```ts
constrainedSampling: { type: "json_schema", strict: "prefer" },
```

与 Pi 内置 `read`/`bash`/`edit`/`write` 的声明完全一致。严格模式下，约束由 provider
在解码期施加到参数文本上，「完整 JSON + 尾巴」这类畸形在生成阶段就无法产生；`prefer`
保证不支持 strict 的 provider 仍能拿到工具（只是不加约束），不牺牲可用性。

这是本扩展仅有的杠杆：参数解析发生在 `pi-ai` 的 provider 层，早于工具被调用，
扩展内部拿不到原始文本，无法自行修复。

## 改了哪些

- `small-extensions/pi-ask-user/pi-ask-user.ts`（+6 行，含注释）
- `small-extensions/pi-ask-user/pi-ask-user.test.ts`（+2 用例：声明存在、schema 可转 strict 子集）
- `small-extensions/pi-ask-user/README.md`（记录该声明及其作用）

## 怎么验证

- `npm --workspace pi-ask-user test` → 18 passed；typecheck 通过。
- 全仓 `npm run typecheck --workspaces --if-present` 干净；`npm test` 全绿。
- `scripts/check-small-extension-installer.mjs`、`scripts/check-readme-packages.mjs` 通过。
- 真实 Pi（全局安装的 pi-ask-user 已同步）：
  - `bytetrueapi/gpt-6.1-sol`（strict=true）→ 工具正常执行，无 argumentsError；
  - `bytetrueapi/deepseek-flash`（strict=false）→ 同样正常执行，确认 `prefer` 回退无损。

## 遗留

若今后仍能复现该报错，可直接定位为「某中转重发了累计快照」，用
`parseToolCallArguments` 观察 `arguments` 拼接结果即可确认；严格模式无法挽救
provider 侧的重复拼接，那种情况需要换中转或在中转侧修。用户报告的环境（bytetrueapi
经 magpie 本地代理）在本次 60+ 次实测中未再出现。

## 对 byissue/ 的影响

仅新增本 issue。`pi-ask-user` 无独立子 spec（small extension，README 即契约）。
