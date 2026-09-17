---
kind: talk
title: "pi-browser：把「选择目标」与「导入」解耦，直接驱动真实 profile"
created: 2026-09-14
---

# pi-browser：把「选择目标」与「导入」解耦，直接驱动真实 profile

> 自检覆盖：开场意图 · 关键纠正与最终结论 · 已确认决策/约束 · 影响与取舍 · 仍开放项 · 出口。

---

## 1. 用户提出重构模型

原话："把选择和导入解耦开来吧。然后不要自定义 profile 了，直接让用户选择使用哪个浏览器的哪个 profile。然后导入是另外的功能，从一个 profile 导入到另一个 profile。"

先确认这为什么值得改——它一次干掉三个现行限制（`spec/pi-browser` 已知限制、note 008）：

- 重导会冲掉 managed profile 里的手动登录（本轮刚为它折腾过一轮，并已记为"明确接受的取舍"）；
- Google 一类 source-bound 登录移植后失效；
- 为此付出的全部复杂度：稳定快照、指纹重试、原子替换、冒烟、`--use-mock-keychain` 那套移植补丁。

根因是"复制"这个动作本身。**不复制，这三个限制就都不是问题**——所以这不只是改菜单，是把包的核心模型从"副本"换成"直连"。

**已确认：** 方向成立，且选择/导入解耦本就是当前菜单别扭的来源（080/081 两轮都在绕它）。

## 2. 唯一硬约束：Chromium profile 独占锁（实测）

```
占位 Chrome 跑着 → playwright-cli open --profile=<同目录>
Error: Browser is already in use for /tmp/pb2/scratch, use --isolated
关掉占位 Chrome → 立刻成功
```

`--isolated` 等于放弃登录态，无用。**日常浏览器基本常开**，所以"直连真实 profile"必然撞上：agent 要浏览时，那个浏览器不能开着。这是物理约束，不是实现问题。

顺带实测到另一件决定可行性的事：`launchOptions.args` 里塞 `--profile-directory="Profile 9"` 会生效（该 profile 目录被创建并使用），所以"选哪个 profile"在技术上做得到，不限于 `Default`。

## 3. 用户给 2 路线设了门槛，我去验它能不能成立

用户：attach/CDP 的代价是"要用户手动找一个很难找的页面、打开 CDP"；如果有办法无感或低成本开 CDP，那就走 2，否则走 1。

查下来 2 做不到低成本，三条独立证据：

| 证据 | 含义 |
|---|---|
| Chrome 136+ 官方安全政策：`--remote-debugging-port/pipe` 对**默认 user-data-dir 不再生效**，必须配非默认 `--user-data-dir` | 想 CDP 接管日常 Chrome 那条最省事的路被官方堵死；换非默认目录 = 换空档案 = 没有登录态，白绕一圈 |
| Chrome 144+ 的 `chrome://inspect/#remote-debugging` 能在运行中开调试 | 正是用户说的那类隐藏页面 + 手动操作；且 chrome-devtools-mcp #1794（截至本次仍未修）：**每个客户端连接各弹一次 "Allow remote debugging?" 并堆叠**，要点好几次 Allow |
| Playwright 侧不支持该协议变体：#40027 仍挂着，`playwright-cli` 0.1.19 里 grep `handleDevToolsAsPage` 0 命中 | 我们的上游今天连不上 144 那种端点 |

Edge 同为 Chromium 153，政策一样。

**已确认：** 走 **1（直连真实 profile）**。attach/CDP 不是"麻烦"，是当前不可行。

## 4. 我自己的一个误判，以及它如何被纠正（重要，防止后来者重犯）

我在方案 #2 断言："`--use-mock-keychain` 从移植补丁升级为必需项"，并做了穿刺（真 Chrome 写 cookie → Playwright 两种配置读取，两边都读到明文 `REAL_KEYCHAIN`）来"证明"。

**那个实验无效，判据选错了**：写方是 `--headless=new` 的 Chrome，而 headless Chrome 在 macOS 上**同样使用 mock keychain**（无法弹钥匙串授权）。写方和读方用同一把假钥匙，自然两边都通——它测不到真钥匙串。

修正：**在直连真实 profile 路线下，`ignoreDefaultArgs: ["--use-mock-keychain"]` 依然是必需项**，因为日常 profile 的 cookie 由真实 Keychain 加密。这条最终要由一次真机穿刺确认（见下）。

**教训（值得复用）**：验"能否解密"时，**写方和读方不能共用同一个 keychain 后端**；测 macOS cookie 解密必须用有头浏览器写、或直接用真实日常档案。

## 5. 落定的决策（#1–#8，修订版）

| # | 决策 |
|---|---|
| 1 | 目标 = 浏览器 × profile：config 写真实 `userDataDir`；非 Default 加 `launchOptions.args=["--profile-directory=<X>"]` |
| 2 | 四件套**全部保留**（含 `ignoreDefaultArgs: ["--use-mock-keychain"]`）——理由见第 4 节，待 M0 真机最终确认 |
| 3 | 副本 profile **保留**，与真 profile 并列为可选目标，并作为**导入的唯一合法目的地** |
| 4 | 导入 = profile→profile；**硬闸：目标不得是真实 profile**（整文件覆盖等于静默抹掉日常登录数据），也不得是当前被占用的 profile |
| 5 | Manual sign-in 保留，语义改为"打开所选目标的可见窗口"（选真 profile 时基本用不上） |
| 6 | 目标被占用：**只报错并指明占用者**（浏览器名 + profile + pid），绝不自动退用户的浏览器 |
| 7 | 菜单：`Status / Target: <浏览器>·<profile> / Data / Sessions / Settings / Setup`；Data 二级 = `Import to copy profile · Create copy from current target · Clear copy` |
| 8 | 新增风险必须显式：agent 以**用户真实身份**操作（写 history/cookies、能读能发），Status 与选真 profile 时各提示一次 |

**仍开放（进 Epic 的未确认问题）**：真 Keychain 解密的最终确认；Playwright 开真 profile 的额外副作用（自动化告警、扩展状态等）；非 Default 经 `args` 指定后，`tab-list`/`detach` 等不接受 `--config` 的命令是否行为一致。

## 出口

- 已执行：查证 2 路线不可行；实测锁约束与 `--profile-directory` 可行性；纠正自己的 mock-keychain 误判。
- 建议下一步：已立 **Epic 005**（`epics/005-o-browser-direct-profile-target/`），首个动作是 M0 真机穿刺（需要用户关掉 Chrome 一次）。
- 暂不纳入：attach/extension/CDP 路线（074 既定不做 + 本次政策核查）；profile 并发/多目标同时驱动。
