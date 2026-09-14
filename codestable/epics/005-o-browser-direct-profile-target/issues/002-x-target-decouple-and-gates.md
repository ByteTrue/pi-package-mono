---
kind: issue
title: "M1：目标选择与导入解耦，Target 直指真实 profile（副本仍是默认）"
type: feature
status: closed
closed: 2026-09-15
created: 2026-09-14
---

# M1：目标选择与导入解耦，Target 直指真实 profile（副本仍是默认）

> **读者：** 跨会话接手的人——「做成了什么形状、别碰什么、怎么验的、还欠什么」。

## 做成以后是什么样

`/browser` 主菜单：**Status / Target: <当前目标> / Data / Sessions / Settings / Setup / Close**。

- **Target** 只改 CLI config，**绝不写任何浏览器数据**（有测试证明选中真 profile 时 `playwright-cli` 一次都没被调用）。列表 = 副本在前 + 所有检测到的真实「浏览器 × profile」。
- 真实 profile 需要**逐次知情同意**：confirm 里写明"agent 以你的身份操作、会写你的 history/cookies、可能被同步推到其他设备、必须完全关闭该浏览器"；若该档案正被占用（读 `SingletonLock` 的 pid 存活判定），**先报错指名占用者，不弹同意窗、不改 config**。
- **Data**（原 Login data）承载 Import / Re-import / Manual sign-in / Clear，目的地**永远是副本**，且导入**不再改变当前 Target**（`keep ?? copyTarget(...)`）。
- 非 `Default` profile 经 `launchOptions.args` 的 `--profile-directory=<X>` 指定（`ManagedBrowserConfig.profileDirectory`）。
- Status 报出目标种类与风险（`copy, owned by pi-browser` / `YOUR REAL PROFILE` + 占用者），副本行只在目标为副本时出现。

## 三条硬闸（本次最重要）

1. **导入目的地**：`assertImportDestination` —— 非本包副本一律拒绝，含真实档案的**子目录**（`startsWith(dir + "/")`）。每次导入前重新计算，不依赖菜单顺序。
2. **冒烟测试不复用 live config**：`runImportSmoke` 改为显式写一份 `<pkg>/smoke.config.json` 指向副本再启动。旧写法会用当前 config 启动——若目标已是真实档案，就等于后台偷偷开用户档案（M0 已证明那会改写 111 个文件）。
3. **Manual sign-in 同理钉在副本**：新增 `<pkg>/sign-in.config.json`，`openLoginWindow(exec, configPath, …)` 必须吃显式 config 路径，不再沿用全局。

## 动哪些

- 新增 `src/target.ts`：`Target`（id/kind/channel/userDataDir/profileDirectory/label）、`listTargets`、`currentTarget`、`copyTarget`、`assertImportDestination`、`copyHasData`。
- `config.ts`：`ManagedBrowserConfig.profileDirectory` + merge 时注入 `--profile-directory`；`managedBrowserSummary` 回读 `profileDirectory`。
- `import/apply.ts`：抽出 `readProfileLockPid`；`isProfileInUse` 重写——**SingletonLock 是悬空 symlink，`existsSync` 会返回 false**，必须 lstat。
- `import/verify.ts`：smoke 与 sign-in 走独立 config；`--config=` 位置实测过（`-s=X --config=Y open` 与会话名前置两种都生效）。
- `paths.ts`：`smokeConfigPath`、`signInConfigPath`。
- `browser-command.ts`：Target/Data 两套菜单、`lockHolder`、`informedConsent`、Status 重写。

## 验证

74 单测（含新增：Target 列表内容与"选择即不执行"、知情同意文案命中 "acts as you"、占用时拒改 config、Status 真 profile 风险行、sign-in 用独立 config 且不含 live config 路径）+ 全仓 typecheck/test 绿 + `tsc --noEmit --noUnusedLocals` 干净。

真机只读核对（未写任何档案）：检测到 3 个真实目标（Edge·Profile 1 / Edge·Profile 2 / Chrome·Byte），当前目标为副本，三道导入硬闸分别返回 ALLOWED / 拒绝 / 拒绝（子目录）。

## 关闭时

- 回写候选：`spec/pi-browser` 已按新模型重写（本次一并做）；note 008 增加"真档案直连的代价"；`talks/006` 是来路。
- 关闭判断：目标/导入解耦、三条硬闸、真 profile 知情同意均已实现并验证；Epic 未关闭（仍欠真档案路径的稳定性结论与版本发布）。
- 遗留：真实 profile 启动超时的根因（M0 的 B 组）；本次未做 headed 真机走查（需用户关浏览器，属 M0 已做过一轮的范围）。
