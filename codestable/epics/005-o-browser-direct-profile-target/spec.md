---
kind: epic
title: "pi-browser：目标直指真实浏览器 profile，选择与导入解耦"
status: open
created: 2026-09-14
---

# pi-browser：目标直指真实浏览器 profile，选择与导入解耦

> **读者：** 在这条有界变化里对齐的人——「相对现状要改什么、现在怎么理解方案、哪些能推、哪些还悬着、关了合回哪里」。

---

## 这条线要改变什么

把包的核心模型从**「副本 profile + 导入即选浏览器」**换成**「目标 = 真实浏览器 × profile，导入降级为独立的 profile→profile 数据搬运」**。

相对 `spec/pi-browser` 现状：

- **改变**：`userDataDir` 从"本包拥有的副本目录"变成"可以指向用户日常浏览器的 user data dir"；非 Default profile 经 `launchOptions.args=["--profile-directory=<X>"]` 指定（实测可行）。
- **改变**：菜单 `Browser: X` → `Target: <浏览器>·<profile>`，选择目标不再隐含执行导入（080/081 两轮 UI 补丁都是在绕这个别扭耦合）。
- **新增**：Data 二级菜单承载导入（profile→profile），并加硬闸限制目的地。
- **移除**：以副本为唯一目标的世界观（副本仍在，但降级为可选目标 + 导入的唯一合法目的地）。

为何值得用 epic：三处限制一次性消失（重导冲掉手动登录 / Google source-bound 失效 / 为移植付出的快照-重试-原子替换-冒烟整套复杂度），同时牵动 config 语义、导入语义、state 结构、菜单、README/spec，且**有一个需要用户配合的真机穿刺作为前置闸**。

- 来源 Vision：`codestable/vision/index.md` 未单列此能力，不强行挂靠。
- 关联 spec：`codestable/spec/pi-browser/index.md` — 定位、当前表面、工作方式（导入四步）、配置四件套、会话生命周期、已知限制全部要动。
- 前序：`talks/006-browser-direct-profile-target.md`（本 epic 的来路与论证）；`issues/074`（副本模型的原始理由）；`issues/080`、`081`（UI 演进与本轮踩坑）；`notes/008`（复制为何必然丢字段级合并 + Chromium 异步刷库的判据坑）。

## 当前怎么理解（活规格）

**一句话：** 选择目标 = 写 config；导入 = 把数据从一个 profile 搬到另一个 profile；两者不再有隐含关系。

目标三元组：`(channel, userDataDir, profileDirectory?)`。`profileDirectory` 非 `Default` 时通过 `launchOptions.args` 传 `--profile-directory=<X>`。

**配置四件套（理由已修正，M0）**：`browserName: "chromium"`、`channel` 与目标浏览器同族、`userDataDir` 指向目标——三条必需。第四条 `ignoreDefaultArgs: ["--use-mock-keychain"]` 在 **playwright-cli 的 persistent-profile 路径上是 noop**（该路径实际 argv 不含此 flag；playwright-core 有两个开关列表，含 mock keychain 的那个不用于 persistent），但**已定：继续写入**（无害，且防上游换列表）。它仍是 **Playwright 直接 launch（非 persistent）** 路径的必需项——074 得出"缺一不可"就是那个场景，所以旧表述要按场景区分。

- 直连真 profile 的解密可行性已正证：真实 Edge 日常 profile 的 24 条 `.bilibili.com` 密文副本，用 CLI 默认配置只读打开，20/20 可见且值全解出（写方为真 Edge、读方为 CLI，不同钥匙串后端，因而具区分力）。

导入 = 现有 `snapshot → apply` 管线，目的地受限：**只能落在副本 profile**。整文件覆盖（Cookies 是 SQLite、storage 是 leveldb，无法字段级合并，见 note 008），落到真实 profile 等于静默抹掉用户日常登录数据，且目标开着时覆盖必然损坏——两条都做成硬闸拒绝。

锁是本 epic 的中心约束：**Chromium user-data-dir 独占**。日常浏览器常开，所以 agent 要用真 profile 时那个浏览器不能开着。处理方式已确认：

- 撞锁时**只报错并指明占用者**（浏览器名 + profile + pid），引导用户去关；
- **绝不自动退出用户的浏览器**（会带走用户自己的窗口）。

诚实面（已实现）：选真实 profile 需逐次**知情同意**（confirm 写明：agent 以你身份操作、写你的 history/cookies、可能被同步推到其他设备、必须完全关浏览器）；Status 标出 `YOUR REAL PROFILE` 与占用者。**默认目标仍为副本**（用户 2026-09-14 采纳推荐）。

**三条硬闸（不得退化）：**

1. `assertImportDestination` —— 导入目的地必须等于本包副本目录，真实档案及其子目录一律拒；
2. 冒烟测试写独立 scratch config（`smoke.config.json`）指向副本，**绝不复用 live config**；
3. Manual sign-in 同样写 `sign-in.config.json`，不拿用户当前目标去开窗（否则选真 profile 后会被后台静默开窗）。

导入完成后**保持当前 Target 不变**（首次无 config 时默认落到副本）。

**术语：** 目标（target）= 当前 config 指向的 浏览器×profile；副本（copy profile）= 本包自有的 `<agent dir>/pi-browser/profiles/<name>`；真 profile = 用户日常浏览器的 profile。

## 现在推什么、先搁什么

**已完成（M1 = issue 002）：** 菜单 `Status / Target: X / Data / Sessions / Settings / Setup`；目标三元组与 `--profile-directory`；三条硬闸（导入目的地 / 冒烟独立 config / sign-in 独立 config）；占用者指名报错；Status 风险行。74 单测 + 全仓 typecheck/test 绿 + 真机只读核对。

**当前默认**（用户 2026-09-14 采纳推荐）：默认目标仍是**副本**；真实 profile 作为需逐次知情同意的可选项。选择与导入已彻底解耦，副本路线完全成立。

**Issues：**（均位于同目录 `issues/`；编号仅在本 Epic 内有效）

- [x] `issues/001-x-m0-real-profile-pierce.md` — 解密可行性已正证（真 Edge 档案的副本上登录态直接可用）；修正旧断言（persistent 路径不需 mock-keychain 剥离）；**活档案直连实测失败且改写 111 个文件**，转为下方未确认项。
- [x] `issues/002-x-target-decouple-and-gates.md` — 上述 M1 的实现与验证。

**暂不推进 / 未确认：**

- **活档案启动超时根因未定**：真实日常档案（Default 2.7G）下 `playwright-cli` 直连 180s 超时，且失败前已改写 111 个文件（含 `Cookies`/`Preferences`/`Secure Preferences`）；而 /tmp 上的完整副本秒开、登录态可用。未定论前**不得再对活档案做直连实验**（已写入 note 008 与项目记忆）。要推这条路：先在 /tmp 按量级复现定位根因（体积？同步态？扩展？），而不是再碰真档案。

- `ignoreDefaultArgs: ["--use-mock-keychain"]` — **已定（用户采纳推荐）：保留写入**。它在 CLI 的 persistent 路径上是 noop，但无害，且万一上游改用含 mock keychain 的开关列表就变成真需要。同时把 spec/074 “配置四件套（缺一不可）”改为**按场景区分**（非 persistent launch 必需；CLI persistent 路径无关），实现时一并清算。
- **spec 漂移清算**：`spec/pi-browser` 与 074 的"配置四件套（缺一不可）"需改写为按场景区分（见上条），实现时一并处理。
- attach / extension / CDP 路线：不做（074 既定 + talk 006 第 3 节政策核查：Chrome 136+ 禁止对默认 user-data-dir 开远程调试端口；144+ 的 `chrome://inspect/#remote-debugging` 要手动进隐藏页面且每个客户端各弹一次授权窗；`playwright-cli` 0.1.19 不含 Playwright #40027 的协议支持）。
- 多目标并发、跨 workspace 会话接管：不做。

**关闭时要满足：**

- M0 有真机证据（真 profile 上需鉴权页面显示为已登录，且未破坏用户档案）；
- 选择目标与导入在 UI 上完全独立可验证（选目标不产生任何数据写入）；
- 导入目的地硬闸有测试覆盖（拒绝真实 profile、拒绝被占用 profile）；
- 撞锁报错能指名占用者；
- README + `spec/pi-browser` 回写完成，note 008 与旧限制条目按新模型清算。

**合并回 project spec 的候选：** 目标三元组语义、四件套（含 mock keychain 的真实理由）、锁约束与占用者报错、导入目的地限制、副本的新定位；三条旧限制（重导丢手动登录 / Google source-bound / 移植补丁）从"已知限制"移入"历史取舍"。

**Vision 同步检查：** 关闭时确认 `vision/index.md` 是否需要为"复用日常浏览器身份"这一能力立条目。

## 相关材料

- `codestable/talks/006-browser-direct-profile-target.md` — 为什么走 1 不走 2，以及第 4 节那个判据错误（动手前必读，避免重犯）。
- `codestable/spec/pi-browser/index.md` — 当前真相。
- `codestable/notes/008-chromium-profile-login-state-primitives.md` — 覆盖式导入为何必然丢数据；**Chromium 异步刷库导致直接读库得假空结果**，验证落盘的唯一可靠判据是"close 后开新会话 `cookie-list`"。
- `packages/pi-browser/src/{config,import/*,browser-command}.ts` — 被改动面。
