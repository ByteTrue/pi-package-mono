---
kind: issue
title: "落地 v2 配置形状与一次性迁移"
type: refactor
status: closed
created: 2026-09-27
closed: 2026-09-27
---

# 落地 v2 配置形状与一次性迁移

> **读者：** 跨会话接手的人——Issue 001 定的形状现在落成什么样、哪些行为被有意放弃、迁移的证据在哪、菜单为什么还不能关。
> 上游设计见 `001-x-provider-model-data-shape.md`；本 issue 只记录**落地结果与验证**，设计理由不重述。

## 目标与范围

包含：`types/settings/migrate/config/cli/generate/errors` 与向导写路径切到 v2；一次性迁移与 `.v1.bak`；测试按新接口重写；README 的形状与迁移段落。
不包含：`Manage providers` 两级管理面与 provider/模型 CRUD（Issue 003）。菜单只做到「写得出 v2、读得回 v2」，形状没变。

## 落成的形状

`<config dir>/pi-image-gen/settings.json`：

```jsonc
{
  "version": 2,
  "default": { "provider": "corp", "model": "image-v1" },
  "outputDir": ".pi/images",
  "providers": {
    "openai": { "baseUrl": "...", "apiKey": "$OPENAI_API_KEY", "headers": {} },
    "corp":   { "api": "openai", "baseUrl": "...", "models": [{ "id": "image-v1", "alias": "hero" }] }
  }
}
```

- 单容器 `providers`，built-in 与 custom 同权；built-in 行可省略 `api`（协议取自模板），也可完全没有行（模板 + 标准 env）。
- `resolveModel` 的四层瀑布塌缩成 `resolveDefaultRoute()`：取 provider 行 → 取 `default.model`。`src/config.ts:1-160`。
- `models` 只是清单（已知 id + alias），不再参与路由判定；catch-all 作为代码概念消失。
- `apiKey: ""` / `headers: {}` 的 tombstone 语义原样保留。

## core 的接口面

| 落点 | 结果 |
|---|---|
| `src/types.ts` | `ImageGenSettings{version?, default?, outputDir?, providers?}`、`DefaultRoute`、`ImageProvider.api?`；运行时形状 `ResolvedProvider/ResolvedModel` 未动，适配器零改动 |
| `src/models.ts` | 新增 `API_STYLES`、`BUILT_IN_PROVIDER_IDS` 两份 canonical 清单，菜单与校验共用，替掉散落的五字符串字面量 |
| `src/config.ts` | `isBuiltInProviderId` / `resolveProviderRoute` / `declaredModels` / `resolveDefaultRoute`；`defaultRouteError()` 统一产出可行动的纠错文案 |
| `src/migrate.ts`（新） | `migrateLegacySettings()` + `isLegacyDocument()`，只被 settings 调用；内部逐层重放退役的瀑布以还原旧 route |
| `src/settings.ts` | `SETTINGS_VERSION=2`、`parseVersion2`、`migrateAndPersist`（先 `.v1.bak` 后原子写）、`loadSettings(path, strict)`；四个公开函数签名不变 |
| `src/cli.ts` `src/errors.ts` | 遍历单容器收集 secret；错误定位统一 `pi-image-gen.providers.<id>.…` |
| `src/config-command.ts` | 向导与 `Change default model` 改写 v2；`chooseProvider()` / `promptCustomProvider()` 承担 provider 选择；删掉两条不可达菜单分支与 `forceCustom` |

## 迁移的实际语义

- **触发**：任何一次读取（runtime 与 strict 两条路径都迁），检测到无 `version` 且带 v1 特征。
- **还原**：`legacyRoute()` 重放退役瀑布——custom alias/id → built-in id/alias（**仅在有 credential 或显式行时**）→ 首斜杠 `<provider>/<remote-id>` → 无清单的 custom。v1 会拒绝的输入返回 `undefined`，`default` 干脆不写。
- **不猜**：custom 与 built-in 同名 ⇒ 整个文件不动，交给人改名；`version > 2` ⇒ 不回写。
- **不毁**：持久化失败被吞掉，本次运行仍用内存中的 v2 结果；`.v1.bak` 是人工回滚路径。
- **单向**：不写 `defaultModel` 镜像字段。

## 有意放弃的便利（需用户知悉）

1. `defaultModel` 不再是可手写的字符串，手改 JSON 的旧写法失效。
2. alias 不再参与路由解析（`default` 已点名 provider），只作清单标签与文件名前缀。
3. catch-all 措辞退役：不再有「未声明 models ⇒ 接受任意 id」。

三条都在 Issue 001 的取舍内，且 README 已同步。

## 验证

- `npx tsc -p tsconfig.json --noEmit`（含测试）——无输出。
- `npx vitest run` —— **12 files / 106 tests 全绿**；其中 `settings.test.ts` 16 项含「migration from the v1 layout」：一次性重写 + `.v1.bak` + 二次读稳定、`it.each` 覆盖 custom alias / built-in alias / 含斜杠远端 id / catch-all 四条恢复纹路、无法路由时省略 `default`、同名冲突不动文件、写盘失败仍只在内存生效。
- `npm run build` 通过；`node scripts/pack-smoke.mjs` 全绿（70 文件、生产安装、packed `dist/index.js` 加载、Skill CLI 可跑）。
- **真实文件迁移冒烟**（临时 `PI_CODING_AGENT_DIR` + `dist` 的 Skill CLI，非测试替身）：v1 `defaultModel: "hero"` + `providers.openai` override + `customProviders.corp` → 首次 `--list` 输出 `Default model: corp/image-v1 / Provider: corp (openai) / Credential: configured (hidden)`，退出码 0；文件被重写为 v2（`version: 2`、`default`、`corp` 并入 `providers`），`settings.json.v1.bak` 保留原始 v1 内容，二次读 `md5` 不变（幂等）。

## 关闭结论

v2 形状与一次性迁移按 Issue 001 定稿落地，并兑现了「必须保持外部行为」：同一份 v1 配置迁移后解析出的 route 逐字段相同，四条旧恢复纹路（custom alias、built-in alias、含斜杠远端 id、无清单 custom）都有测试与一次走 `dist` CLI 的真实文件迁移为证；`loadImageGenSettings()` 签名未变，调用方不知道发生过迁移。

验证摘要：typecheck（含测试）无输出、包内测试全绿、build 与 pack smoke 全绿、迁移幂等（二次读 md5 不变）、`.v1.bak` 保留原始字节、输出不含凭据（断言覆盖）。用户 2026-09-27 在真实 TUI 验收通过。

回写位置：`byissue/spec/pi-image-gen/index.md` 的「它负责什么 / 配置边界」已按 v2 重写并链到本 Epic；Epic `../spec.md` 的「已确定」与「统一语言」同步（catch-all 退役）。三条有意放弃的便利同时写进了包 README。

留给下一批：本批次只做到菜单能写 v2、能读 v2；管理面形状见 `003-x-manage-providers-surface.md`。
