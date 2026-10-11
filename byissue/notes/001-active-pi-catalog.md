# 使用 active Pi catalog

## 结论

pi-vendor 的官方模型 catalog 必须来自**当前 Pi 安装**，而不是 extension workspace 自己的 peer dependency fixture。

## 为什么

workspace 安装的 Pi 版本可能落后于用户启动的 Pi。若 catalog resolver 优先读取 workspace fixture，TUI 与 Skill script 会缺少当前 Pi 已内置的新模型；例如 Pi `0.80.6` 有 `gpt-5.6-*`，workspace 的 `0.79.10` 没有。

## 规则

1. 正常 Pi session 的 TUI core：从当前 Pi executable / runtime root 读取；workspace catalog 只作为 package 内 fallback。
   - **路径形状要按 Node 解析规则走，不要拼固定相对形状。** root 可能是 pi-coding-agent **包目录**或**安装前缀**；对每个 root 逐级上溯 `<ancestor>/node_modules/@earendil-works/pi-ai/dist/models.generated.js`，再补嵌套形状。虚拟 store（pnpm/aube）里 pi-ai 是 pi-coding-agent 的**兄弟**，拼 `<root>/node_modules/...` 必然 miss。
   - **TUI 与脚本必须共用同一份路径形状**（`src/shared/vendor-shared.js` 的 `candidateCatalogPaths`）。两边各写一份时脚本先修、TUI 后坏，症状是「脚本能查、`/vendor` 报无官方模板」。
   - **「catalog 不可用」不等于「模型没有官方模板」。** 前者是环境故障，必须单独上报，否则会把所有模型 id 都污名化。
2. Skill bundled script：先检查 `PI_VENDOR_PI_ROOT`，否则从 PATH 中的 `pi`（含 Windows npm shim 邻接目录）定位 active installation；找不到就明确失败，不静默使用 workspace fixture。
3. `PI_VENDOR_PI_ROOT` 可显式覆盖，供受控开发与测试。

## 验证

```bash
node packages/pi-vendor/skills/pi-vendor/scripts/vendor.mjs catalog 5.6
```

结果应来自当前 Pi catalog，并包含当前安装可见的 `gpt-5.6-*` 候选；输出不得包含 routing 或 credential 字段。

排查「TUI 说没有官方模板」时，先确认 catalog 到底有没有被找到——**脚本能查、TUI 不能查**就是路径形状分叉的信号：

```bash
# 用 pi 同款 jiti 加载真实扩展，模拟真实 argv[1]
node -e 'const {createJiti}=await import("jiti"); ...'   # findOfficialCatalogPath() 应为非 null
```

`PI_VENDOR_PI_ROOT` 传**安装前缀**或 **pi-coding-agent 包目录**都应命中；两者都返回 null 说明路径形状又分叉了。

## 相关位置

- `packages/pi-vendor/src/model-source/official-catalog.ts`
- `packages/pi-vendor/skills/pi-vendor/scripts/vendor.mjs`
- `packages/pi-vendor/src/vendor-script.test.ts`
- `byissue/spec/pi-vendor/index.md`
