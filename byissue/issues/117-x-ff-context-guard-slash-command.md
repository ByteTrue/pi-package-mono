---
kind: issue
title: "快改：pi-context-guard 重构为 /context 斜杠命令、精确修改 contextWindow 与原版参数还原"
type: ff
status: closed
created: 2026-10-12
epic: ""
---

# 快改：pi-context-guard 重构为 /context 斜杠命令、精确修改 contextWindow 与原版参数还原

## 做了什么

- 将 `small-extensions/pi-context-guard` 从原先硬编码 400k tokens 截断的运行时 `agent_settled` hook 重构为：
  1. 注册 `/context` 斜杠命令：
     - 支持传参设置阈值（例如 `/context 300k`、`/context 400000`）或无参时弹出菜单引导选择（1. 调整阈值；2. 还原原版）。
     - 支持传参直接还原（例如 `/context restore` 或 `/context reset`）。
  2. 交互式多选列表与智能容量过滤（方案 A）：
     - 识别每个模型的真实原生上限容量：`capacity = originalsStore[key] ?? model.contextWindow ?? registryModel.contextWindow`。
     - 自动过滤排除小于等于目标阈值的模型（如 272k <= 400k），避免用户一键全选时误把小模型改大导致上游报 context 溢出错误。
     - 列表仅展示真正需要收窄的大模型（`capacity > threshold`），标题实时提示 eligible 与 skipped 数量，一键全选 100% 安全。若无合格大模型，直接友好提示退出。
     - 通过 `ctx.ui.select` 实现多选 Toggle 循环（支持单项切换勾选、一键全选/清空、确认保存、取消退出）。
  3. **外科手术式精确文本替换（Surgical text replacement）**：更新选定模型的 `contextWindow` 时，定位原文本中对应模型的代码块，只替换该数字或在其 `id` / 顶层花括号后精准插入，绝不使用全文件 `JSON.stringify`，完整保留原文件的换行、缩进、字段顺序、注释（带安全注释剥离校验状态机）以及未选中模型。
  4. **原版参数持久化与精准还原（Restore originals）**：
     - 在首次修改任何模型前，自动将该模型当前的真实上下文窗口（包含数值或未配置 `null`）持久化记录在 `<agent-dir>/pi-pkg-cfg/pi-context-guard/originals.json`（符合仓库 spec 私有配置收归规范，不污染 `models.json`）。后续多次修改不会覆盖首次原版。
     - 还原流程支持多选与全选：对于原先有数值的模型精确还原数字；对于原先未配置（`null`）的模型外科手术式精确删除该 `contextWindow` 行并安全处理末尾逗号，恢复出厂未设置状态。
  5. 实时热刷新与生效（无需重启 Pi，也无需 /reload）：
     - 查明 Pi 原生 `/reload` 仅重载 settingsManager 与 resourceLoader（扩展/技能/提示词/主题），根本不重载 `models.json`，导致此前纯靠 `/reload` 无法刷新 TUI。
     - 改为在更新/还原 `models.json` 成功后，由扩展直接调用 `await ctx.modelRegistry.refresh()` 热刷新内存中的模型元数据；
     - 若当前会话活跃模型属于被更新/还原的模型之一，自动调用 `await pi.setModel(refreshedModel)` 实时重新应用当前会话模型，TUI 底部的 footer 状态栏立即实时刷新，改完瞬间生效。
  6. 保留 `before_agent_start` 事件中的系统提示词注入（向 `sections.session_file` 注入 session JSONL 路径，方便 compaction 摘要后检索完整历史细节）。
- 移除原先硬编码 400k 强行调用 `ctx.compact()` 的 `agent_settled` hook：因为直接修改了模型的 `contextWindow`，Pi 原生 compaction 机制会在安全裕量内自动接管，不再需要外部 hook 竞争。

## 对抗性审查修复（Reviewer Findings）

经过独立 adversarial reviewer 深度审查（50+ 轮压力测试），发现了 5 处隐藏边界缺陷，已全部修复并补齐回归测试：
1. **[P0] 注释剥离前置**：在入口 `discoverModels` 前置调用 `stripJsonComments`，彻底解决含行注释/块注释的 `models.json` 被直接 parse 失败导致模型列表为空的问题。
2. **[P0] 空 override 对象单行插入**：在空对象（如 `{}`、`{ }`）中插入属性时增加紧邻字符检测，杜绝生成非法尾随逗号（trailing comma）。
3. **[P1] 行内注释下的逗号安全清理**：修复删除末尾属性时，前序属性带有行内注释（`"id": "m1", // comment`）导致逗号未被剥离的语法解析异常。
4. **[P1] Key 生成与展示带入 `kind` 维度**：`makeKey` 扩展为 `${provider}::${kind}::${modelId}`，并在列表展示中区分 `model` 与 `override`，彻底消除同 provider 下同名 model/override 的键冲突与数据覆盖。
5. **[P2] Override 搜索限定在 `modelOverrides` 块**：修复搜索 override 对象时未限定作用域，避免与同名 `headers` 等外层键冲突。

## 明确不做

- 不对全局或官方未配置模型全量刷入 overrides（只针对用户在 `models.json` 已声明的模型与 overrides）。
- 不引入任何外部运行时依赖，严格保持 small-extension 零运行时 import 的单文件约束。

## 改了哪些

- `small-extensions/pi-context-guard/pi-context-guard.ts`：核心实现重构与 5 处审查修复
- `small-extensions/pi-context-guard/pi-context-guard.test.ts`：单元测试覆盖阈值解析、模型发现、文本定位、行删除、还原更新、5 处回归测试、修改-还原全链路端到端模拟（22/22 通过）
- `small-extensions/pi-context-guard/package.json`：更新 description
- `small-extensions/pi-context-guard/README.md`：更新功能说明与使用文档
- `small-extensions/README.md`：表格简介同步更新
- `README.md`：根目录小扩展列表简介同步更新
- `byissue/spec/index.md`：证据索引追加 117
- `byissue/issues/117-x-ff-context-guard-slash-command.md`：本快改记录

## 怎么验证

- `npm --workspace pi-context-guard test`：22 passed，全绿。
- `npm --workspace pi-context-guard run typecheck`：exit 0，0 错误。
- `npm run typecheck --workspaces --if-present`：全仓 exit 0。
- `npm test`：全仓 10 个 workspace 819 个用例全部通过。

## 对 byissue/ 的影响

已同步 spec：在 `byissue/spec/index.md` 证据索引中追加记录。

## 顺手发现

- 在正则匹配时，`\s` 默认匹配包含换行符 `\n`，在定位单行字段末尾时必须使用水平空白 `[ \t]`，否则会意外吞噬换行导致后续行合并不换行。
- JSON 注释过滤如果直接用正则 `\/\/.*$`，会误伤 URL（例如 `https://...` 中的 `//`），必须用识别字符串字面量的状态机来过滤。
- 外科手术式行删除时，若被删除字段是对象的末尾属性，前一属性结尾遗留的逗号必须一并剔除，且必须穿透行内注释。
