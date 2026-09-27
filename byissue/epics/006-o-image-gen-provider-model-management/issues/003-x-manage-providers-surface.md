---
kind: issue
title: "Manage providers 两级管理面与 provider/模型 CRUD"
type: feature
status: closed
created: 2026-09-27
closed: 2026-09-27
---

# Manage providers 两级管理面与 provider/模型 CRUD

> **读者：** 跨会话接手的人——管理面收成几级、每级负责什么、删除语义定了什么、快改 099 的快捷入口去哪了。
> 数据形状与迁移见 `001-x-provider-model-data-shape.md` / `002-x-v2-settings-and-migration.md`。

## 目标与范围

包含：`/image-gen` 顶部菜单收敛、`Manage providers` 两级浏览、provider 的查/改/删、模型清单的增删改与 alias、吸收快改 099 的 `Change default model`。
不包含：数据形状再变（v2 已定稿）、`pi-vendor` 整合、CLI model override、新 wire protocol。

## 菜单形状

```text
/image-gen
├── Manage providers                    provider 列表（行 + env 可达的 built-in），标 — default
│   ├── Add provider…                   原七步向导原样复用，写 default
│   └── <provider>                      详情
│       ├── Change default model…       099 的探测+挑选，只写 default
│       ├── Edit endpoint, credential, headers…   逐项 keep-by-default，不碰路由
│       ├── Models (N)                  清单 CRUD：加 / 改 alias / 删
│       └── Delete provider             见下
├── Set output directory
└── Show effective configuration
```

顶部不再出现 `Configure image model` 与 `Change default model`：前者下沉为 `Add provider…`，后者下沉为 provider 详情的一项。`/image-gen list|show|reload` 参数不变。

步数核对（Epic 易用性候选）：换 key = Manage providers → provider → Edit connection → 选 credential = 4 次交互；加模型 = Manage providers → provider → Models → Add model = 4；删供应商 = 3 + 1 次确认。都不再重走完整向导。

## 删除 provider 的语义（Epic「仍在变化」在此定）

**允许删除当前默认路由的 provider，并一并清空 `default`。** 理由：留下指向已删 provider 的 `default` 会让每次生成都撞解析错误，而"必须先切走才能删"是人为的顺序依赖；"没有路由"是系统本来就好好处理的状态（`resolveDefaultRoute` 给出可行动的 `/image-gen` 提示）。确认摘要会点明 `default` 会被清空。

- **built-in 没有行就没有可删的东西**：env 可达的 built-in 在列表里带 `(env)` 标记，删除时通知「没有 settings row，它仍通过 `$OPENAI_API_KEY` 生效」，不写盘。删掉行 ≠ 让 provider 不可用。
- 删非默认 provider ⇒ `default` 不动。
- 删完 `providers` 为空 ⇒ 删掉该 key，不留空对象。

## 结构与复用（替换，不叠加）

| 落点 | 变化 |
|---|---|
| `promptConnection()` | 从向导里抽出 baseUrl / credential / headers 三步，向导与 provider 详情共用同一条编辑路径 |
| `chooseRemoteModel()` | 合并向导的模型挑选与 099 的候选合并逻辑，消掉 `config-command.ts` 里两份近乎重复的 select 实现 |
| `providerDetail()` / `manageProviders()` / `modelList()` | 新增两级浏览与清单 CRUD |
| `deleteProviderRow()` | 唯一删除路径 |
| `changeDefaultModel()` | 下沉为详情项，不再自己枚举 provider |

`default` 的写与 `models` 清单的写保持分离：换默认模型只在**已有非空清单**时 upsert（不静默materialize 清单），加/删模型只走 Models 子菜单。

## 必须守住

- 任何菜单项、确认摘要与错误不出现 literal key、解析后的 env 值或 credential header 值。
- 交互写入 fail-closed；读 fail-soft；只写专用文件；原子 `0600`。
- 管理面只在 `ctx.mode === 'tui'` 下可用。

## 验证

已实现（`src/config-command.ts` 重写 + README）：

- 顶部三项：`Manage providers` / `Set output directory` / `Show effective configuration`。`Configure image model` 与 `Change default model` 从顶部消失。
- `Manage providers` → `Providers` 列表（built-in 先、custom 后，标 `— default` 与 `(env)`）→ `Add provider…` 或 provider 详情页。
- 详情页四项：`Change/Set as default model…`、`Edit endpoint, credential, headers…`、`Manage model list…`、`Delete provider`。
- 模型清单 CRUD：`Model list — <id> (N declared)` → 条目 → `Set alias…` / `Remove alias` / `Remove from list`；`Add model…` 复用同一个候选选择器，会在没有清单时物化一份。
- 删除语义按上文定稿：删当前默认路由的 provider ⇒ 一并清空 `default`；built-in 无行 ⇒ 通知「no settings row」且不写盘；`providers` 空 ⇒ 删掉该 key。
- **替换而非叠加**：`chooseRemoteModel()` 合并了向导与 099 两份近乎重复的模型挑选；`promptConnection()` / `applyConnection()` / `promptApiStyle()` 让向导与「编辑 provider 设置」共用同一条编辑路径；`providerLabel()` 统一标签格式。

证据：

- `npx vitest run` → **120 tests / 12 files 全绿**，其中 `config-command.test.ts` 28 项按新菜单重写（菜单形状 4、添加 provider 6、默认模型 7、provider 设置 3、模型清单 5、删除 3）。
- `npx tsc -p tsconfig.json --noEmit`（含测试）无输出；`npm run build` 通过；`node scripts/pack-smoke.mjs` 全绿。
- 非敏感输出断言：改 credential 与改模型两条路径都断言 notify 文本不含 stored literal key。
- TUI 边界新增测试：`mode: 'rpc'` 下菜单不得打开（`select` 抛错即失败），而 `/image-gen list` 仍可用。

手测：本环境无 pty，无法由我用键盘驱动真实 Pi TUI；用户随后在本地 `/image-gen` 交互验收通过（2026-09-27）。

注：monorepo 全量 `vitest run` 有 1 项与本 Epic 无关的既有失败（`packages/pi-vendor/src/vendor-script.test.ts` 的 `PI_VENDOR_PI_ROOT` 恢复提示，依赖本机环境）。

## 关闭结论

两级管理面达成目标：provider 与模型都能浏览、修改、删除；快改 099 的 `Change default model` 下沉为 provider 详情项而不是继续挂在顶部；七步向导没有被重写，只被复用为 `Add provider…`。删除语义按本 issue 定稿并实现。

质量证据：换 key、加模型、删供应商各为 3–4 次交互且都不重走完整向导（28 项测试按菜单形状逐条覆盖）；"不泄露凭据"由 notify 文本断言守住；管理面在 `mode !== 'tui'` 下拒绝开菜单。

回写位置：Epic `../spec.md` 的「已确定」收到删除语义一条、`仍在变化` 已清空；`byissue/spec/pi-image-gen/index.md` 的「它负责什么 / 配置边界」按 v2 + 两级管理面重写；包 README 同步菜单说明。快改 099 里那条短路径的描述已被本批次表述取代。

遗留：无未做项。Epic 006 是否整体关闭由用户决定——三个 issue 的结论都已回到 Project Spec 与 Epic spec。
