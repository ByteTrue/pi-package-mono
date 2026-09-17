---
kind: issue
title: "pi-browser：Settings 菜单（headless 切换）+ Brave/Arc 源支持"
type: feature
status: closed
created: 2026-09-14
---

# pi-browser：Settings 菜单（headless 切换）+ Brave/Arc 源支持

> **读者：** 跨会话接手的人——本次给 `/browser` 补配置入口（headless），并把导入源从 Edge/Chrome 扩到 Brave/Arc（executablePath 模式）。channel 与导入来源强耦合，不做成自由开关。

---

## 做成以后是什么样

- `/browser` 菜单多一项 **Settings**：可切换 headless ↔ headed（写入 `~/.playwright/cli.config.json`，Status 同步显示）；channel 以只读形式展示，并注明"换浏览器请走 Import"。
- **Import 不再重置 headless**：已有 config 里的 headless 值在重导时保留（首次默认 true，与现状一致）。
- **（2026-09-14 范围转向）导入源维持 Edge/Chrome**：用户决定只支持 Playwright 有 channel 的浏览器，菜单只列这些；Brave/Arc（executablePath 模式）整体撤除，"先不支持"。原 v2 设想中"其他 Chromium 走 executablePath"的方向作废——若未来支持，仅限 Playwright 官方 channel 清单内的浏览器。
- 关闭时 spec 的"只覆盖 Edge 与 Chrome"限制与"Brave/Arc（v2）"遗留随之更新。

**范围：** 包含 Settings 菜单、headless 保留、Brave/Arc 检测与 executablePath 配置；不包含其他 config 键（viewport/args 自定义等）、不包含多 profile/并发浏览器。

**归属：** 独立 issue；相关 spec：`byissue/spec/pi-browser/index.md`；前置：`byissue/issues/done/074-x-browser-package.md`。

## 为什么现在做

用户提出"补齐斜杠菜单里尽可能多的配置项"。盘点结论：headless 是唯一值得做且安全的自由旋钮（当前硬编码 true，`browser-command.ts` 的 `writeManagedConfig`）；"用哪个浏览器"因 Keychain 解密与导入来源强耦合，不能自由切换，Brave/Arc 支持是 spec 里明确的 v2 遗留，本次一并做。

## 现状怎么工作

导入完成后 `writeManagedConfig(channel, target)` 以 `headless: true` 硬编码写四件套到全局 config；`mergePlaywrightConfig` 总是覆写 `launchOptions.channel`。detect 只认 Edge/Chrome 两个 `SourceBrowserDef`（有 channel）。

## 动哪些、验哪些

- 必须改：`browser-command.ts`（Settings 菜单、writeManagedConfig 保留 headless）、`config.ts`（ManagedBrowserConfig 支持 executablePath、merge 时清理旧 channel、summary 展示）、`import/detect.ts`（Brave/Arc 定义 + 可执行文件探测）、`import/pipeline.ts`（ImportSource 透传）。
- 需要验：executablePath 模式下冒烟（browserName=chromium + executablePath、无 channel）；Brave/Arc profile 布局（Local State info_cache 是否同构）。
- 仍未知（穿刺点）：见下。

## 方案与实现安排

**Settings 语义：** config 不存在时提示先 Import（不凭空造 channel）；存在时 toggle 只改 headless 并原子重写。

**executablePath 模式：** `ManagedBrowserConfig.channel` 变为可选；给 executablePath 时 `mergePlaywrightConfig` 必须**删除** launchOptions.channel（避免与旧值冲突），写入 `launchOptions.executablePath`；从 Brave/Arc 换回 Edge/Chrome 导入时反向清理 executablePath。detect 要求用户数据目录与可执行文件同时存在才提供该浏览器。

**穿刺（按不确定 × 失败代价排序）：**
1. executablePath-only 启动：真机/临时 profile 验证 `playwright-cli open` 能用 Brave/Arc 二进制起来（config 键组合未验证过）。打通标准：冒烟 open→close 成功。
2. Brave/Arc cookie 解密：拷贝后由浏览器自己解密的配方是否同样成立（Safe Storage 同机制）。打通标准：需鉴权页面登录态可见。
3. Arc 的 Local State/info_cache 布局是否与标准 Chromium 一致。打通标准：detect 列出真实 profile。

**实现顺序：** M1 = Settings 菜单 + headless 保留 + Status 注记（低风险先行）；M2 = Brave/Arc detect + executablePath 写入 + 穿刺；M3 = README/spec 回写准备。

## 验证

- 全仓 `npm test` / `typecheck`；pi-browser 现有 64 测试不回归。
- Settings：toggle 后 config 文件实际变化、Status 显示同步；无 config 时的提示路径。
- 导入保留：预设 headed config 后模拟导入，headless 仍为 false。
- Brave/Arc：本机若装有所列浏览器则真机走查导入 + 登录态（需鉴权页面）；未装则可执行文件探测与 config 写入以单测覆盖，真机验证标为待办并明确告知。

## 执行记录

**2026-09-13 实现完成（M1+M2+M3）：**

- `config.ts`：`ManagedBrowserConfig.channel` 改可选、新增 `executablePath`；`mergePlaywrightConfig` 互斥处理（给 executablePath 时删 channel，反之亦然）；新增 `setHeadless`（只翻 headless，其他键含外来键不动）；`managedBrowserSummary` 返回 executablePath。
- `browser-command.ts`：菜单加 **Settings**（Status/Setup/Import/Re-import/Clear/Sessions 之后）；Settings = headless toggle（config 不存在时提示先 Import，存在时只改 headless 并原子写+备份）；导入时 headless 保留已有值（首次默认 true）；Status 对 channel/executable 各自条件显示。`writeManagedConfig` 改收 `{channel?, executablePath?}`。
- `import/detect.ts`：`SourceBrowserDef.channel` 可选、新增 `executables` 候选路径；新增 Brave（darwin/win32/linux，win32 含 per-user 安装路径）与 Arc（仅 darwin，Windows 版已停摆）；无 channel 的浏览器要求用户数据目录与可执行文件同时存在才提供。
- `import/pipeline.ts`：`ImportSource` 的 channel 可选、加 executablePath（结构透传，pipeline 内部不使用）。
- README：包 README（菜单、来源浏览器清单、config 表 channel/executablePath 互斥）与根 README 表格行已更新。

**验证：** pi-browser 75 测试（新增 11：executablePath 互斥 merge ×2、setHeadless ×2、summary executablePath、Brave 可执行探测 ×1、Arc 非 macOS ×1、Status executable 行、Settings toggle、Settings 无 config 提示、重导保留 headed）；全仓 typecheck/test 通过；pack dry-run 正常（14 files）。

**穿刺结果：** 本机未安装 Brave/Arc（/Applications 与用户数据目录均不存在），三项真机穿刺（executablePath-only 启动、Safe Storage 解密、Arc 的 Local State 布局）无法执行。已按预案以单测覆盖探测与 config 写入逻辑；**真机验证为遗留待办**——用户装了 Brave 或 Arc 后跑一次 Import + 需鉴权页面登录态检查即可。

**偏差：** 无方案级偏差。Settings 顶层退出项沿用 "Close"，未顺手改文案。

**2026-09-14 范围转向（用户决定）：** Brave/Arc 与 executablePath 模式整体撤除——"只支持 Playwright 支持的那些浏览器，列选项也只列 Playwright 的选项"。已回退 detect（Brave/Arc 定义、executables 探测）、config（executablePath 字段与互斥 merge）、pipeline/browser-command 透传、Status executable 行、README 描述及 6 个相关测试。**保留**：Settings 菜单、headless 导入保留、setHeadless。回退后 69 测试 + 全仓 typecheck 绿。Brave/Arc 真机穿刺待办随之作废。

## 关闭时

- 回写候选：spec/pi-browser「当前表面」加 Settings；「已知限制」改为 Edge/Chrome/Brave/Arc；「配置四件套」补 executablePath 模式；根 README 包描述。
- 关闭判断与验证摘要：见执行记录（2026-09-13）。
- 遗留：Brave/Arc 真机穿刺（等浏览器可用）；登录态抽查；其他 Chromium（Vivaldi 等）。

**关闭结论（2026-09-14）：**
- **判断**：Settings 菜单与 headless 保留已实现并验证；Brave/Arc 部分经用户决定撤除（只支持 Playwright channel 浏览器），目标以转向后的范围达成。
- **验证摘要**：69 测试 + 全仓 typecheck/test 绿；pack dry-run 正常（14 files）；Settings toggle / 无 config 提示 / 重导保留 headed / channel 只读注记均有单测；Brave/Arc 穿刺待办随撤除作废。
- **回写位置**：`byissue/spec/pi-browser/index.md`——「当前表面」Settings 条目、「工作方式」headless 管理语义、「已知限制」Playwright-channel-only 决策、「验证」七入口、「证据」本 issue 链接与 0.1.1 发布状态。
- **遗留**：登录态抽查（新需求，另行建 issue）；Brave/Arc 如未来要支持，仅限 Playwright 官方 channel 清单扩展时再议。
