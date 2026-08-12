---
kind: issue
title: "仓库级 Ponytail 简化"
type: chore
status: closed
created: 2026-08-11
closed: 2026-08-11
---

# 仓库级 Ponytail 简化

## 目标

删除五包演化后失去调用方或重复承担的平台/stdlib 能力，保持当前产品行为、信息安全边界与安装配置闭环不变。

## 范围

包含：

- root release/ignore 元数据与 `pi-background-terminal` 重复测试；
- `pi-image-gen` 无调用 provider 表面、重复 response reader、无效测试接缝与 pack smoke 冗余；
- `pi-web-search` live harness 私有 loader、手写 response 合并与冗余 response 类型；
- `pi-vendor` 已被 AI-first Skill/script 或当前 bounded core 取代的 catalog DTO、猜测模板、旧 discovery/editor/oracle/helper；
- 同步因此失真的 current `codestable/spec` 与相关测试。

明确不包含：

- `codestable/archive/codestable-legacy/**`；
- `pi-vendor` 必需的十行分页 selector；
- 未经外部消费者证据确认的公共兼容 alias、root export 与 accepted settings 字段；
- 发布、push 或关闭本 issue。

## 质量目标

- **功能适宜性**：五个 package 的当前用户/Agent 表面与 spec 一致，不因删除内部代码丢失能力。
- **信息安全性**：SSRF、credential、原子写、权限与 trust 边界不削弱。
- **可维护性**：删除无调用实现、重复协议形状和 test-only 接缝；不新增替代抽象层。
- **兼容性**：只删除 current spec 明确不承诺的内部表面；公共兼容项留待消费者检查。

## 验证计划

- 每包相关 tests + typecheck；
- `pi-image-gen` pack smoke；
- package dry-run/pack smoke 按现有 spec；
- 全仓 `npm test`、workspace typecheck、`git diff --check`；
- 对被删除 symbol 做仓库级 caller/reference 检查。

## 执行记录

2026-08-11 已完成当前批准范围：

- root：删除 legacy `v*` bulk release 分支；统一 `.codegraph/` ignore；删除失效图片规则。
- `pi-background-terminal`：删除 timeout、`timed_out`、Agent 无参 list 与重复测试；三个 tool 只剩必填 `command`/`id`；同步精简 tool prompts、README 与 current spec。
- `pi-image-gen`：删除无调用 provider/clock 接缝，集中 response text reader，pack smoke 改用 Node `execFile`，合并重复测试。
- `pi-web-search`：provider 直接返回 `SearchResult[]`，删除回传 query/details 包装、私有 Pi loader E2E 与手写 buffer 扩容；production `undici` 精确升级到首个安全且兼容的 `8.9.0`，proxy regression 同时覆盖普通 HTTP forwarding 与 CONNECT；保留 SSRF、proxy、deadline 和 body budget。
- `pi-vendor`：删除旧 catalog DTO、猜测式 model templates、OpenAI-only discovery、test-only oracle 和无调用 grouping；未知 model 只写 `{ id }` 加目标 provider API；官方候选仍移除 routing/credential 字段。
- `pi-vision`、`pi-web-search` 与两个 Skill 的 model-visible 文案同步精简；current specs 已更新。

明确保留：archive、十行分页 selector、公共 alias/root exports 与 accepted settings 字段。

## 验证证据

- `npm test`：460 passed，9 个 live provider tests skipped。
- `npm run typecheck --workspaces --if-present`：5 个 workspace 通过。
- 5 个 package `npm pack --dry-run --json`：均生成非空 file report。
- `node packages/pi-image-gen/scripts/pack-smoke.mjs`：真实 tarball、production install、packed extension load、Skill CLI 全部通过。
- 被删除 symbol 的全仓 reference 检查无 live orphan；`git diff --check` 通过；无 staged files。
- 三个独立 fresh-context diff/release reviewers：无 P0–P2 correctness/security/spec、残余复杂度或发布阻断 finding。

剩余动态风险：9 个 live provider E2E 需要凭证，保持 skipped；本轮未重新执行真实 Pi `/reload` 生命周期手测，但当前 background 实现的 schema、自然完成、kill、session cleanup 已在本次改造前的同一未提交工作树完成真实 Pi 回归，后续清理未改对应 production path。仓库 audit 仍报告 peer/dev compatibility fixture `@earendil-works/pi-coding-agent@0.79.10` 内嵌的 `undici 8.5.0`；待发布 `pi-web-search` 自身 production dependency 已固定为安全的 `8.9.0`，不提高 peer floor。

## 关闭结论

用户已明确授权收尾。目标、范围与四项质量目标均已满足：五包当前表面与 project specs 一致；SSRF、credential、原子写、权限与 trust 边界保留；无调用实现与重复接缝已删除；公共兼容表面按范围保留。稳定结论已毕业到 `codestable/spec/index.md`、`codestable/spec/pi-background-terminal/index.md` 与 `codestable/spec/pi-vendor/index.md`。

发布版本随同关闭提交：`pi-background-terminal 0.4.0`、`pi-image-gen 0.2.1`、`pi-vendor 0.3.2`、`pi-vision 0.2.1`、`pi-web-search 0.2.1`。registry 与 workflow 结果由独立 closed ff 记录。
