---
id: "069"
title: "fix: enforce strict-patch integrity, official key order preservation, and model ordering gate in vendor skill"
type: ff
status: closed
created_at: "2026-09-09T12:12:00Z"
closed_at: "2026-09-09T12:15:00Z"
---

# 069 · Enforce Strict-Patch Integrity, Official Key Order Preservation, and Model Ordering Gate

## 做了什么
- 解决会话 `01a08446-45b4-7522-a9ce-abb20ef8a9eb` 中暴露的两个流程与规范缺陷：
  1. **配置改动未遵守原地最小补丁（strict in-place patch）与官方模板保真**：AI 新增模型时擅自重排键顺序并裁剪 `allowedFallbackModels`，更新已有模型时缺少仅更新目标 value、其余字段与键顺序 100% 保持不变的硬性约束。
  2. **Model ordering 未嵌入工作流门禁**：此前模型排序检查仅作为文档末尾附录，各 workflow 步骤列表执行完离线验证后直接短路退出，导致未检查模型倒挂（如 `claude-fable-5` 错排在 `claude-opus-5` 之后）且未主动询问用户整理。
- 在 `packages/pi-vendor/skills/pi-vendor/SKILL.md` 中强化以下约束：
  - **Add Model 100% 保真**：从 official catalog 写入新模型时，除剔除 routing 凭据与应用 Anthropic stripped baseUrl 规则外，100% 原样保留所有字段与原始键声明顺序，严禁删减（包括 `allowedFallbackModels`）或人工排版。
  - **Update Model Strict-Patch**：仅更新用户指定的字段 value，已有全部字段、键声明顺序 100% 原样不动。
  - **Model Ordering 强制门禁**：在所有模型变更工作流（Configure a model / Exact sync / Update model）中将 Model ordering 设为汇报前的必经门禁步骤；明确模型按大系列名称 A-Z 排列，系列内部统一按 `release_date` 升序排列（如 claude 系列内：haiku4.5 -> fable5 -> sonnet5 -> opus5 -> fable5.1）；一旦检测到顺序偏差，禁止静默汇报完成，必须显式向用户告警并征询全文件整理。
- 更新 `packages/pi-vendor/src/skill-contract.test.ts` 增加上述断言，保证防回归。
- 同步覆盖活动环境 `~/.pi/agent/npm/node_modules/@bytetrue/pi-vendor/skills/pi-vendor/SKILL.md`。

## 改了哪些
- `packages/pi-vendor/skills/pi-vendor/SKILL.md`
- `packages/pi-vendor/src/skill-contract.test.ts`
- 同步覆盖：`~/.pi/agent/npm/node_modules/@bytetrue/pi-vendor/skills/pi-vendor/SKILL.md`

## 怎样验证
- `npm --workspace @bytetrue/pi-vendor run typecheck` → 通过
- `npm --workspace @bytetrue/pi-vendor test` → 18 个测试套件，174/174 全部通过
- `npm --workspace @bytetrue/pi-vendor pack --dry-run` → 打包校验通过
