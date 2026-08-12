# 使用 active Pi catalog

## 结论

pi-vendor 的官方模型 catalog 必须来自**当前 Pi 安装**，而不是 extension workspace 自己的 peer dependency fixture。

## 为什么

workspace 安装的 Pi 版本可能落后于用户启动的 Pi。若 catalog resolver 优先读取 workspace fixture，TUI 与 Skill script 会缺少当前 Pi 已内置的新模型；例如 Pi `0.80.6` 有 `gpt-5.6-*`，workspace 的 `0.79.10` 没有。

## 规则

1. 正常 Pi session 的 TUI core：从当前 Pi executable / runtime root 读取；workspace catalog 只作为 package 内 fallback。
2. Skill bundled script：先检查 `PI_VENDOR_PI_ROOT`，否则从 PATH 中的 `pi`（含 Windows npm shim 邻接目录）定位 active installation；找不到就明确失败，不静默使用 workspace fixture。
3. `PI_VENDOR_PI_ROOT` 可显式覆盖，供受控开发与测试。

## 验证

```bash
node packages/pi-vendor/skills/pi-vendor/scripts/vendor.mjs catalog 5.6
```

结果应来自当前 Pi catalog，并包含当前安装可见的 `gpt-5.6-*` 候选；输出不得包含 routing 或 credential 字段。

## 相关位置

- `packages/pi-vendor/src/model-source/official-catalog.ts`
- `packages/pi-vendor/skills/pi-vendor/scripts/vendor.mjs`
- `packages/pi-vendor/src/vendor-script.test.ts`
- `codestable/spec/pi-vendor/index.md`
