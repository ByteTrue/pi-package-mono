# 018 – root package.json 的 allowScripts 按精确版本号键名

**日期**：2026-10-12　**来源**：issue 116-x（pi 升级 1.1.0）

## 事实

本仓 root `package.json` 用 `allowScripts` 显式批准依赖的 install scripts，键名是
`<包名>@<精确版本>`：

```json
"allowScripts": {
  "@google/genai@2.21.0": true,
  "esbuild@0.28.2": true,
  "protobufjs@7.6.6": true,
  "fsevents": false
}
```

**精确版本意味着任何依赖升级都会让旧键静默失效**：新版本不在白名单里，其
preinstall/postinstall 会退回「未批准」状态（npm 只打印 `npm warn install-scripts ...`，
退出码仍是 0，CI 不会红）。

本次升级 pi → 1.1.0 连带把 `@google/genai` 1.52 → 2.21、`esbuild` 0.27 → 0.28、
`protobufjs` 7.6.5 → 7.6.6 一起抬了版本，三个键全部过期；当时这些脚本恰好是 no-op
或无关键（esbuild 的平台二进制走 optionalDependencies），所以 build/test 照常通过，
**问题只以 warning 形式暴露**。

## 处理

依赖升级后同步 `allowScripts` 键到 lockfile 里的实际版本（`npm ls <pkg>` 看生效版本），
并确认 `npm install` 不再打印 `warn install-scripts`。判断依据是 lockfile 的实际解析结果，
不是 package.json 里声明的范围。

## 复用场景

任何改动 lockfile 的升级（bump 依赖、更新 pi、`npm update`）之后，顺手核对 `allowScripts`
与 `overrides` 是否还对得上实际版本。别只看 CI 是否绿——install scripts 未批准不报错。
