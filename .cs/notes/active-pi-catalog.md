# 使用 active Pi catalog

## 结论

pi-vendor 的官方模型 catalog 必须来自**正在运行的 Pi 安装**，而不是 extension workspace 自己的 peer dependency。

## 为什么

workspace 安装的 Pi 版本可能落后于用户启动的 Pi。若 catalog resolver 优先读取 workspace fixture，Web/TUI 会缺少当前 Pi 已内置的新模型；例如 Pi `0.80.6` 有 `gpt-5.6-*`，workspace 的 `0.79.10` 没有。

## 规则

1. 正常 Pi session：从当前 Pi executable / runtime root 读取。
2. `npm --workspace @bytetrue/pi-vendor run dev:web`：从 PATH 找安装的 `pi`，并把其 root 传为 `PI_VENDOR_PI_ROOT`。
3. `PI_VENDOR_PI_ROOT` 可显式覆盖，供受控开发/测试。
4. imported/local workspace catalog 只可作为没有 active Pi 时的 fallback。

## 验证

```bash
npm --workspace @bytetrue/pi-vendor run dev:web
# 期望输出：[dev-web] Pi catalog: <active Pi root>
```

在 Web editor 输入 `5.6` 时，应出现当前 Pi catalog 的 `gpt-5.6-*` 候选。

## 相关位置

- `packages/pi-vendor/src/model-source/official-catalog.ts`
- `packages/pi-vendor/scripts/dev-web.mjs`
- `.cs/issues/2026/07/14/closed-web-model-editor-official-fill.md`
