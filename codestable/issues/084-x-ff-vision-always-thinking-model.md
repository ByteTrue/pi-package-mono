---
kind: issue
title: "image_ask 对始终思考的模型请求最低可用思考档"
type: ff
status: closed
created: 2026-09-15
---

# image_ask 对始终思考的模型请求最低可用思考档

用户用 vision（glm-5.3-flash）报 503："该模型始终思考, 不支持关闭思考, 请使用 low、high 或 max"。根因：pi-vision 的 `analyzeImages` 调 `complete()` 时不传任何思考选项，pi-ai 的 zai thinkingFormat 分支在 `reasoningEffort` 为空时发送 `thinking: {type: "disabled"}`，始终思考的模型直接拒绝。glm-5.3-flash 在 models.json 里 `thinkingLevelMap.off: null` 正是"不能关"的标注。讨论过的替代方案：干脆不传思考参数——不成立，wire 层上"不传"会被 pi-ai 翻译成 disabled，正是 503 的来源；硬编码 "low" 也不够——最低档不是 low 的模型（如只有 high/max）会被拒。

最终方案（二轮简化后）：一条规则——直接传模型 `thinkingLevelMap` 的最低可用档（null=不支持，跳过；厂商别名如 `medium: "high"` 也顺带正确），无 map 则不传。不再判断 `model.reasoning`、不设 "low" 回退：非思考模型没有 map，pi-ai 也只在思考分支消费该选项；map 缺失的思考模型（如官方 zai 源）保持旧行为，由 catalog 维护 map 来保证。代价：能关思考的思考模型在 vision 调用上也会以最低档思考——用户明确接受，不纠结不思考。

- 改动：`packages/pi-vision/src/image-ask.ts` — 新增 `lowestAdmittedEffort()`：按 THINKING_LEVELS 顺序扫 `thinkingLevelMap`，取第一个非 null 档位，无 map 返回 undefined；`analyzeImages` 的 complete 选项无条件传 `reasoningEffort: lowestAdmittedEffort(model)`。该函数同时覆盖 `image_ask` 工具与附件 auto-analyze 两条链路。
- 改动：`packages/pi-vision/src/image-ask.test.ts` — 新增四个用例：glm-5.3-flash 同形 map 解析出 "low"，只有 high/max 的 map 解析出 "high"，思考但无 map 不传，非思考模型不传。
- 验证：包内 78 项测试全过，tsc --noEmit 通过。
- codestable：spec 无需改动（未记录 image_ask 的思考参数行为）。

## 遗留观察（不处理）

pi-ai 侧更通用的修法是 zai 分支在 effort 为空时回查 `thinkingLevelMap.off`，为 null 时取最低可用档而非发 disabled——属上游 pi-ai 职责，pi-vision 侧已自愈，不再追。
