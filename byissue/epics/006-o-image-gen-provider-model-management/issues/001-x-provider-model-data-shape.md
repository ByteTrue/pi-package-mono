---
kind: issue
title: "定死 provider 与模型的数据形状与迁移方案"
type: refactor
status: closed
created: 2026-09-27
closed: 2026-09-27
---

# 定死 provider 与模型的数据形状与迁移方案

> **读者：** 跨会话接手的人——这个分叉定了什么、必须保持的外部行为是什么、实现批次该怎么切。
> 本 issue 的产物是**设计结论 + Epic 回写**，不写生产代码。

## 目标与范围

包含：选定数据形状（Epic 的方案 a/b/c）、迁移与失败策略、catch-all 与 alias 的归宿、删除 provider 的语义、模块归属。
不包含：TUI 实现（Issue 002/003 批次）、任何新 wire protocol、`pi-vendor` 整合。

## 结构问题（为什么方案 a 撑不住）

以 Provider 为一级、模型为二级的管理面，需要每条 provider 都能被**枚举、查看、改、删**。现状的四个形状缺陷让这四件事都必须先做字符串考古：

1. **两个容器语义不对称**：`providers` 只存 built-in 的 override，`customProviders` 存完整定义。列表视图必须合并两套语义；快改 099 里 `configuredProviders()` 不得不自己编码"有 override 或有标准 env key 才算已配置"（`src/config-command.ts:389-399`）——这条规则本属于数据层。
2. **路由信息编码在字符串里**：`defaultModel` 用 `"corp/image-v1"` 同时表达 provider 与远端 id，而远端 id 本身含斜杠（`openrouter/google/gemini-3-pro-image-preview`）。于是 `resolveModel` 长成 4 层瀑布（custom alias/id → 内置 known → 首斜杠切分 → catch-all，`src/config.ts:123-178`），管理面只能反向解析才能显示"当前默认是谁"。
3. **catch-all 由"字段缺失"表达**：custom provider 没有 `models` 就接受任意 id。一旦要做模型列表 CRUD，"没有列表"到底是"未初始化"还是"故意放开"就无法区分——099 只能靠 `models.length > 0` 猜（`src/config-command.ts:505-513`）。
4. **built-in 侧无法持久化**：alias 与模型清单只存在于 custom 条目和 `BUILT_IN_MODELS` 常量里，built-in 的模型列表根本不可 CRUD。

结论：**先重切形状，再建管理面**；在 a 上叠 CRUD 会把上述四条规则复制进 TUI 层。Epic「已确定」里"a 起步、必要时升级"的许可在此触发，升级为方案 c。

## 选定形状（v2）

```jsonc
{
  "version": 2,
  "default": { "provider": "corp", "model": "image-v1" },
  "outputDir": ".pi/images",
  "providers": {
    "corp": {
      "api": "openai",
      "name": "Corp gateway",
      "baseUrl": "https://images.corp.example/v1",
      "apiKey": "$CORP_IMAGE_KEY",
      "headers": {},
      "models": [{ "id": "image-v1", "alias": "hero" }]
    },
    "openai": { "apiKey": "", "headers": {} }
  }
}
```

- **单容器** `providers`：built-in 与 custom 同权。行的存在即"已配置"，不再有 override/定义之分。
- **built-in 仍可无行可用**：`default.provider` 命中五个内置 id 且无行时，用模板（协议、默认 baseUrl、标准 env 变量）解析——保住"安装即用 env 即可跑"。这是唯一保留的推导规则，取代双容器。
- **`api` 只属于 custom 行**；built-in 的协议由 id 决定。custom id 不得占用五个内置名（不变）。
- **`default` 是显式路由**：不再有字符串编码，`resolveModel` 的 4 层瀑布塌缩成"取行 + 取模型"。
- **`models` 退化为清单**：已知模型 + alias，供 UI 与文件名使用，**不再参与路由判定**。因此 catch-all 作为概念消失，"限制/放开"这个开关没有存在必要——路由已经点名了 provider。built-in 行同样可以有清单，缺陷 4 随之解决。
- **tombstone 语义原样保留**：`apiKey: ""` 与 `headers: {}` 仍显式阻断下层与标准 env fallback。

## 迁移方案

- **读旧写新、一次性**：`loadImageGenSettings()` 检测到无 `version` 或 `version: 1` ⇒ 在内存里迁移 ⇒ 原子写出 v2（`0600`），并把旧文件另存为同目录 `settings.json.v1.bak`。签名不变，所有调用方（extension、Skill CLI、tests）不学习新概念。
- **旧路由用旧解析器还原**：迁移内部保留 legacy `resolveModel` 瀑布，负责把 `defaultModel` 字符串映射成 `{provider, model}`——alias（`"hero"`）、内置 id（`"gpt-image-2"`）、含斜杠的远端 id（`"corp/Kwai-Kolors/Kolors"`）都能落准。
- **解析不出来就明说**：旧 `defaultModel` 无法解析 ⇒ `default` 不写（等同未配置），迁移结果在 TUI 里通知"原默认模型无法解析，请重选"。不静默保留一个跑不通的路由。
- **写不动就不毁**：迁移写失败（只读、损坏、并发）⇒ 运行时继续用内存中的 v2 结果（fail-soft 与今天一致），绝不用空配置覆盖用户文件（fail-closed 与今天一致）。
- **损坏文件仍然拒绝覆盖**：无 `version` 且 JSON 本身不合法 ⇒ 维持今天的 fail-closed 报错。
- **单向迁移，回滚靠 `.bak`**：降级到 0.4.x 会读不到 `default`（它只认 `defaultModel`），提示重配；`.v1.bak` 是人工回滚路径。**接受此代价**，换取系统里只有一份路由真相。
- **不镜像旧字段**：不写派生的 `defaultModel` 镜像字段。两份真相必然漂移。

## 必须保持的外部行为

- 同一份历史配置，迁移前后解析出的 route 逐字段相同（provider id、api、baseUrl、credential、headers、远端模型 id）。
- Skill CLI 的 stdin 契约、`--list` 的非敏感输出语义、`0600` 原子写、专用文件路径均不变。
- 不提供 CLI model override；不新增常驻 Agent tool。
- 任何界面文案、确认摘要与错误都不出现 literal key、解析后的 env 值或 credential header 值。

## 有意放弃的便利（需用户知悉）

1. **手改 JSON 的形状变了**：`defaultModel` 不再是可手写的字符串。契约本就是"TUI 配置、无需手改 JSON"。
2. **alias 不再参与路由解析**：`default: {provider, model}` 已点名 provider。alias 仍作清单标签与输出文件名前缀。
3. **catch-all 措辞退役**：不再有"未声明 models ⇒ 接受任意 id"这条隐含规则。

## 模块归属

| 落点 | 变化 |
|---|---|
| `src/settings.ts` | 版本识别 + 调迁移；写路径不变（原子、`0600`、fail-closed） |
| `src/migrate.ts`（新） | v1 → v2 与 legacy 路由还原，只被 settings 调用 |
| `src/config.ts` | 4 层瀑布换成 `resolveDefaultRoute()`；`resolveProviderRoute()` 沿用 |
| `src/types.ts` | `ImageGenSettings` 改 v2；新增 `default` |
| `src/cli.ts` | `collectSecrets` 遍历单容器 |
| `src/config-command.ts` | 向导写 v2；管理面在 Issue 003 |

## 验证策略（Issue 002 兑现）

- **迁移参数化测试**：从 0.4.0 至今的真实配置形态取样（env-only、literal key、tombstone、alias 默认、含斜杠远端 id、catch-all、keyless 本地），逐个断言迁移后 route 不变且 `.bak` 落地。
- **在损坏与只读场景上验 fail-soft / fail-closed**，证明迁移不会毁掉用户配置。
- `resolveDefaultRoute` 的可观察行为直接测；旧瀑布的测试随 `resolveModel` 一起迁进 `migrate` 的测试面，不留两套运行时读路径。

## 批次切分

- **Issue 002**：v2 形状 + 迁移 + core 重切（settings/migrate/config/types/cli）与其测试。必须保持外部行为，暂不动菜单。
- **Issue 003**：`Manage providers` 两级管理面与 provider/模型 CRUD；吸收 099 的 `Change default model`。

## 关闭结论

设计结论已被实现批次兑现：方案 c 的形状与迁移策略落进 `002-x-v2-settings-and-migration.md`，管理面落进 `003-x-manage-providers-surface.md`；两条实现批次的测试与真实文件迁移冒烟共同证明了第 19 节的四条形状缺陷已不再需要 TUI 层反解——`resolveModel` 的四层瀑布换掉后没有任何调用方保留字符串考古。

验证摘要：迁移正确性由 `settings.test.ts` 的 v1 参数化纹路 + 一次走 `dist` CLI 的真实文件迁移证明；凭据不外泄由 notify 文本断言证明；用户 2026-09-27 在真实 TUI 验收通过。

回写位置：Epic `../spec.md` 的「已确定」与「统一语言」（catch-all 退役）；`byissue/spec/pi-image-gen/index.md` 的「它负责什么 / 配置边界」按 v2 重写。

遗留：无。三条有意放弃的便利已写进包 README，作为对用户可见的说明。
