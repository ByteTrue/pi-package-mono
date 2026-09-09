---
id: "068"
title: "fix: enforce anthropic-messages stripped baseUrl rule in vendor skill workflows and audit"
type: ff
status: closed
created_at: "2026-09-09T11:25:00Z"
closed_at: "2026-09-09T11:27:00Z"
---

# 068 · Enforce Anthropic Messages BaseUrl Rule in Vendor Skill Workflows and Audit

## 做了什么
- 解决使用 vendor 配置或修改模型时，新增加的 `anthropic-messages` 格式模型挂在带 `/v1` 的全局 provider 下未自动配置去 `/v1` 的模型级 `baseUrl`，导致请求发往 `/v1/v1/messages` 失败的问题。
- 在 `packages/pi-vendor/skills/pi-vendor/SKILL.md` 中强化约束：
  1. **Configure a model**：显式增加 `Anthropic Messages baseUrl Rule`，明确如果模型使用或继承 `api: "anthropic-messages"` 且 provider 的 `baseUrl` 带有 `/v1`（如 `http://host:port/v1`），必须配置去除尾部 `/v1` 的模型级 `baseUrl`；无 `/v1` 则不加。
  2. **Exact sync**：写入新模型时强制遵守该 baseUrl 规则。
  3. **Read/Update/Delete**：更新 provider 路由或模型 API 时确保维护该规则。
  4. **Audit**：明确将缺少去 `/v1` 的 `baseUrl` 作为路由缺陷进行审计与修复建议。
- 在 `packages/pi-vendor/src/skill-contract.test.ts` 中增加断言，固化该规则防回归。
- 将最新 `SKILL.md` 同步至用户活动运行环境 `~/.pi/agent/npm/node_modules/@bytetrue/pi-vendor/skills/pi-vendor/SKILL.md`。

## 改了哪些
- `packages/pi-vendor/skills/pi-vendor/SKILL.md`
- `packages/pi-vendor/src/skill-contract.test.ts`
- 同步覆盖：`~/.pi/agent/npm/node_modules/@bytetrue/pi-vendor/skills/pi-vendor/SKILL.md`

## 怎样验证
- `npm --workspace @bytetrue/pi-vendor run typecheck` → 通过
- `npm --workspace @bytetrue/pi-vendor test` → 18 个测试套件，173/173 全部通过
- `npm --workspace @bytetrue/pi-vendor pack --dry-run` → 打包文件完整验证通过

## 对 codestable 的影响
- `codestable/spec/pi-vendor/index.md` 中的“模板与路由”事实（`anthropic-messages 模型挂在 provider-level /v1 base URL 时，model-level baseUrl 去掉尾部 /v1`）已存在，本次修复了 Skill 指南与测试中的实现漂移，使其与 Spec 规范完全一致。
