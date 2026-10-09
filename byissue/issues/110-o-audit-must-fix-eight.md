---
kind: issue
title: "全仓审计 Must fix 8 项:信任门/迁移误判/图片覆盖/抓取时限/Bing 回退/凭据误杀/SSE 规范/tmp 残留"
type: bug
status: open
created: 2026-10-09
---

# 全仓审计 Must fix 8 项

> **读者:** 修复 pi-package-mono 全仓质量审计(BYTE-4 主报告 #1–#7 + 增补 A2)判定的全部 Must fix 项的接手人。方案 A:本批修完 Top 4 + A2 优先,其余 3 条随后;Should fix 与 Lean 清理在姊妹任务(BYTE-6)处理,本 issue 不夹带。

---

## 背景

BYTE-4 审计(基线 main e480899,641 通过/10 跳过全绿)确认 7 条主报告 Must fix,增补核实 A2(写配置失败残留含 API key 的 .tmp)。全部对照 main 源码复核过,修复思路以审计报告为准。

## 执行痕迹(改动清单)

- **#1 未信任项目的 subagent.env 旁路(安全)** — `packages/pi-subagent/src/index.ts`:`PiExtensionContext` 增加 `isProjectTrusted?`;`subagent` 工具 execute 入口读 `ctx?.isProjectTrusted?.() ?? true`(旧 pi 无 ctx 时保持历史默认),传入 `resolveAgentRole`(新第 4 参,替换原 :801 硬编码 true)与 `runSubagent`(新第 8 参,替换原 :1752 硬编码 true)。/subagent 菜单本就传真实值,不受影响。
- **#2 v2 settings 误判 v1 被静默迁移** — `packages/pi-image-gen/src/migrate.ts`:`isLegacyDocument` 改为缺 version 时必须同时存在 v1 独有标记(`defaultModel` 或 `customProviders`)才判 v1;versionless 且无标记的 v2 形状文件走 `parseVersion2`(运行时 fail-soft、严格读拒绝改写),文件永不被覆盖。
- **#3 生成图片同名静默覆盖** — `packages/pi-image-gen/src/generate.ts`:新增 `writeExclusively`,以 `wx` flag 独占写,EEXIST 时按 `-2`…`-99` 递增重试并返回实际路径;同秒重生成/并行调用/用户固定 filename 跨次运行都不再覆盖已存在图片,markdown 指向真实落盘文件。
- **#4 web_fetch 无总时限** — `packages/pi-web-search/src/html.ts`:新增导出 `WEB_FETCH_TOTAL_TIMEOUT_MS = 30_000`;`fetchViaGenericHtml` 组合 `AbortSignal.any([signal, AbortSignal.timeout(总时限)])` 传入唯一传输通道;新增第 4 参 `totalTimeoutMs`(默认 30s)作测试注入口。调用方取消仍然优先。
- **A2 writeConfig 失败残留含 key 的 .tmp** — `packages/pi-web-search/src/config.ts`:tmp 路径提前到 try 外记录,finally 中 `rmSync(tmp, { force: true })`;rename 被杀软/索引器锁失败后不再残留明文密钥临时文件。
- **#5 Bing 200 + 0 条被当成功阻断 fallback** — `packages/pi-web-search/src/providers/bing.ts`:解析 0 条且响应体 ≥ 1024 字符时抛错(视为人机验证页/布局变更),重试耗尽后由 `searchWithProvider` 记失败走正常 provider 回退;退化小响应体仍按既有语义返回空数组。
- **#6 视觉回显凭据检测子串误杀** — `packages/pi-vision/src/image-ask.ts`:凭据候选加长度阈值(`CREDENTIAL_MIN_LENGTH = 8`,Authorization token 剥 scheme 后同样受阈)——业务头(X-Env: prod)、scheme-only 的 Authorization: Bearer 不再让整段回答被扣;apiKey 精确匹配、≥ 8 的头/env 值仍全量拦截。
- **#7 Exa-free 结果可伪造 + SSE 不合规** — `packages/pi-web-search/src/providers/exa-free.ts`:结构化解析要求块内存在 `Highlights:` 且 Title/URL 只在它之前匹配(攻击者页面摘要里的 "---" + 伪造 Title:/URL: 行落在 Highlights 段,其分裂块无 Highlights,整体跳过,无法再伪造结果);新增导出 `parseSseResponse` 按 SSE 规范以空行分事件、聚合事件内全部 data: 行(支持 CRLF、无空格 data:),从最新事件向回找首个可解析 JSON,均失败才报 body-free 错误。
- 测试(23 个新用例):`pi-subagent/index.test.ts`(+2)、`pi-image-gen` settings/generate(+2)、`pi-web-search` config-file(+2)/bing(+2)/exa-free(+4 与独立 parseSseResponse describe 5 例)/新增 html-timeout.test.ts(+4)、`pi-vision/image-ask.test.ts`(+3)。
- 无设计偏差;#7 的实现把审计句"只在 Highlights: 之前匹配"落成"必须有 Highlights 段且 Title/URL 在其前"——这是让审计给出的攻击样例(伪造行经 --- 分裂成独立块)真正失效的最小读法,已在此注明。

## 验证

- 全仓 `npm test`:664 通过 / 10 跳过(基线 641/10,新增 23 全绿,零回归);六个 workspace 分计 52+127+73+191+90+131。
- `npm run typecheck --workspaces --if-present` 全绿(exit 0)。
- 每项修复的行为级测试要点:#1 真实 execute 入口 untrusted 时拒绝 project-only 角色(修前会放行并 spawn);runSubagent 经真实子进程观察 env(FROM_PROJECT trusted 可见/untrusted 不存在);#2 versionless v2 形状文件读取后字节不变、无 .v1.bak、严格读拒绝;带 v1 标记的 versionless 文件仍迁移;#3 双次生成同名得 -2 路径且首图字节完好;#4 挂死响应 30s 预算到期中止、caller abort 仍即时、快路径正常返回;A2 rename 失败(目标为目录)后目录内零 .tmp;#5 大 body 0 条抛错、小 body 保持空数组;#6 prod/eu-west/Bearer 不误杀、长 token 仍拦;#7 毒化 Highlights 不产生 attacker.example 结果、多行 data 聚合、非 JSON 事件跳过、无 JSON 时 body-free 报错。

## 关闭候选(待验收后毕业)

- `byissue/spec/pi-web-search/index.md` 安全与预算节:补一行 web_fetch 总时限 30s(AbortSignal.any,调用方取消优先)。
- `byissue/spec/pi-image-gen/index.md` 配置边界节:补迁移判定——缺 version 且无 v1 独有标记(defaultModel/customProviders)不作 v1 迁移;图片落盘为独占写,冲突时 -N 重试。
- `byissue/spec/pi-subagent/index.md` 第 7 条:补一句工具入口的信任决策经 ctx.isProjectTrusted 传入 runSubagent/resolveAgentRole(旧 pi 无 ctx 保持 trusted 默认)。
- 关闭时把本文件改名 `110-x-audit-must-fix-eight.md`。
