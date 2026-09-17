---
kind: issue
title: "pi-vision 支持 URL 风格 provider 的 model ref"
type: ff
status: closed
created: 2026-08-19
---

# pi-vision 支持 URL 风格 provider 的 model ref

修复 GitHub issue #2（dan64 报告）：`pi-vision.model` 配成 URL 风格 provider（如 `llama-server=http://127.0.0.1:8080/xxx`）时，`splitModelRef` 在 `http://` 的第一个斜杠处切开，registry 查找必失败。改为对齐 pi 自身 `/model` 解析器的做法：先对 registry 做整串 `${provider}/${id}` 精确匹配，匹配不上再走原斜杠切分——连 provider URL 带路径（`srv=http://host:8080/v1`）的边界也一并解决，未采用报告人所附只跳过 `://` 的 patch。

- 改动：`packages/pi-vision/src/vision-model.ts` — `resolveVisionModel` 先整串 canonical 匹配再 fallback 切分；auth 错误消息改用 `model.provider`
- 改动：`packages/pi-vision/src/vision-model.test.ts` — 新增 URL 风格 provider（含带路径）两条用例
- 验证：`npm --workspace @bytetrue/pi-vision test` 74/74 通过；`npm run typecheck` 通过
- codestable：无影响（`spec/pi-vision` 中 `"provider/model-id"` 配置约定仍然成立）

顺手发现：GitHub issue #2 待回复/关闭，需用户授权。
