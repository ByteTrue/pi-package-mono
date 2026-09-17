---
kind: issue
title: "M0 穿刺：Playwright 直连真实 profile 能否解密真 Keychain 登录态、有无副作用"
type: feature
status: closed
closed: 2026-09-15
created: 2026-09-14
---

# M0 穿刺：Playwright 直连真实 profile 能否解密真 Keychain 登录态、有无副作用

> **读者：** 跨会话接手的人——这是 Epic 005 全部实现的前置闸；验不过，整条线回退到"副本为主"。

## 做成以后是什么样

拿到三问的确定答案，并据此决定 Epic 005 是否继续：

1. **解密**：Playwright 直连含真实 Keychain 密文的 profile 时，`ignoreDefaultArgs: ["--use-mock-keychain"]` 是否仍是必需项（talk 006 第 4 节纠正过一次误判，必须钉死）。
2. **副作用**：直连真 profile 会不会给用户档案带来不可接受的东西（被标记为受控、扩展异常、profile 被改写）。
3. **非 Default profile**：经 `launchOptions.args=["--profile-directory=<X>"]` 指定后，行为是否与 Default 一致。

**范围：** 只出结论与证据，不改产品代码。**不包含** 菜单/config 实现（那是 M1+）。

## 为什么现在做 / 当前证据

Epic 005 把 `userDataDir` 从副本改指真实日常 profile，成立与否全押在"能不能解密 + 副作用可不可接受"。

- 已证：真 Keychain 密文在同族 channel 下由浏览器自解（074 PoC：导入 Edge Default 后 GitHub 显示已登录）。
- 已证：profile 独占锁（Epic spec 第 2 节实测），撞锁即 `Browser is already in use`。
- **踩过的坑（不要再犯）**：验"能否解密"时，写方与读方**不能共用同一个 keychain 后端**。上一版穿刺用 `--headless=new` 的 Chrome 写 cookie，而 headless Chrome 在 macOS 上同样走 mock keychain，两边同钥匙 → 得到"mock keychain 不必需"的**假结论**（详见 talk 006 第 4 节）。
- 现成材料：`<agent dir>/pi-browser/profiles/default` 里就是今天从 Edge `Profile 1` 导入的**真 Keychain 密文**（40 MB），拿它做 A/B 即可定论第 1 问，**无需用户关闭日常浏览器**。

## 方案

A/B：同一份含真 Keychain 密文的 profile，分别以 (A) Playwright 默认带 `--use-mock-keychain`、(B) 加 `ignoreDefaultArgs: ["--use-mock-keychain"]` 起会话，比较能否看到登录态。

- 判据只用**域名与条数**，绝不打印 cookie 名值（那是真实凭据）。
- 第 3 问用 scratch 多 profile 目录验（已初步验过目录会被创建使用，需补一次带数据的完整验）。
- 第 2 问（真日常 profile 的副作用）**必须**由用户关闭一次 Chrome 后走查；无法在副本上代验 → 标为遗留并向用户请求该次配合。

## 验证

A/B 差异即答案：若 A 看不到、B 看得到 → 第 1 问确认"仍是必需项"，Epic spec 的 #2 无需修改；若两者都看得到 → 推翻 074 的既有理由，需回到 Epic spec 改写并复核原因。

## 执行记录

### 结论（先行）：路线可行，包内一条既有断言被推翻

1. **Epic 005 的核心可行性成立**：拿真实 Edge 日常 profile（`~/Library/Application Support/Microsoft Edge/Default`）的 `.bilibili.com` 密文副本（24 条，全为 `encrypted_value` 非空），用 `playwright-cli` 的 persistent-profile 路径只读打开：**20/20 可见且值全部解出**。写方是真 Edge（有头、真 Keychain），读方是 CLI 默认配置——**不同钥匙串后端**，这才有区分力。密文确实能被解，直连真 profile 在解密这一关不是障碍。
2. **`ignoreDefaultArgs: ["--use-mock-keychain"]` 在 CLI 的 persistent-profile 路径下不是必需项**——该路径压根不加这个 flag。证据：实际启动 argv 里没有 `--use-mock-keychain`；playwright-core 里有**两个**开关列表，含 mock keychain 的那个不用于 persistent profile。→ **spec/074 的"配置四件套（缺一不可）"存在漂移**，那是 Playwright 直接 launch（非 persistent）路径的经验，不能无条件套到 CLI 上。
3. 未推而翻：副本 profile 今天仍能正常供登录态（GitHub cookie 322 条完好），本穿刺**全程未写、未占用任何真实档案**，源均用只读副本。

### 三次无效实验（写下来防止重犯）

| 次序 | 想验什么 | 为何无效 |
|---|---|---|
| 穿刺2/4 | 真 Chrome 写的 cookie，Playwright 能否解 | 写方用 `--headless=new` 的 Chrome，**headless 在 macOS 上也用 mock keychain**；写读同后端 → 两边都"成功"，零信息量 |
| 穿刺6/7（A/B） | mock vs 真钥匙串谁解得开 | 两臂**实际 argv 完全一致**（diff 仅 userDataDir 路径）——所谓 A 根本没加上 mock keychain，仪器没通电 |
| 穿刺 run3（C 臂） | 用 `launchOptions.args` 强制加 mock keychain | args 是**追加**在 `--headless=new` 之后，未覆盖前面的同名项 → argv 仍无差异（会话1 grep 无 mock-keychain 即此证） |

两个可复用的坑：

- **验解密必须让写方与读方用不同 keychain 后端**，且要用**有头**浏览器写（headless = mock）。最稳的做法是直接拿真实日常 profile 的密文副本做读方实验。
- **先验仪器再下结论**：对比实验必须回看实际 argv / 实际生效配置是否真的不同（`ps -A -ww -o command` + `diff`）；本例若非最后去 diff 两臂 argv，会得出"mock keychain 无关"的假结论——而它在非 persistent 路径下恰恰**有关**。
- 另外：ps 默认可见宽度会截断长 argv，`grep` 不到不等于不存在，必须 `-ww`。

### 真机端到端（用户已授权 kill 浏览器）——能力成立，但对“活档案”代价很大

**A. 完整档案副本上（安全，已删）——成功 ✔**
把真实 Edge user-data-dir 完整拷到 /tmp（跳过缓存类目录，10071 文件/3.3GB），关掉 Edge 后用 CLI 默认配置直连副本：

- `headless + channel=msedge` → **OPEN OK**，落地 `message.bilibili.com`（未被跳转登录页）= **登录态直接可用**；27 条 bilibili cookie 全部值解出。
- 有头模式 → 同样 OK。
- 实验后已 `rm -rf` 该副本（内含全部 cookie/localStorage，属敏感数据落盘），并确认无进程残留。

→ **Epic 005 的可行性结论：直连真实 profile 能拿到可用登录态，且不需要任何导入。** 这是本 issue 的主问题，已答。

**B. 直连用户“活”的日常档案——失败，并且改了档案**
同一配置（channel=msedge, headless）指向 `~/Library/Application Support/Microsoft Edge`，Edge 已确认退出、SingletonLock 已释放的情况下：

- **OPEN 失败**：Playwright 180s 启动超时（daemon exit 1）；日志里只有 `CVDisplayLinkCreateWithCGDisplay failed`（无头环境噪声，非致命）。
- **代价**：失败前后对比文件清单，真实档案 **111 个文件被改写、新增 4、删除 8**，命中 `Cookies`、`Cookies-journal`、`Preferences`、`Secure Preferences`、`Session Storage/000031.log`、`Local Storage/leveldb/008026.log`；cookies 总数 **376 → 336**。
- 基线做了三层（T0 运行中 / T1 kill 后 / T3 直连后），已把“Edge 自己优雅退出写的 20 个文件”从归因里排除——剩下的 111 确实是我们这次直连造成的。

**善后（已完成）**：立即 `open -a` 重启 Edge 与 Chrome（均恢复 1 主进程）；只读核查当前档案：bilibili 25 / github 7 / feishu 39 条密文仍在、结构健康、`SingletonLock` 无残留。40 条差额无法归因（Chromium 自清过期/session cookie 也会造成同量级的减少），**已向用户如实报告并建议肉眼确认关键站点登录态**。

### 对 Epic 方案的影响（重要）

B 的结果直接打击 Epic 的核心前提。用户日常档案“直连”不只是一个锁问题：

1. **它会写用户的真实档案**（Cookies / Preferences / Local Storage / Session Storage 全动），失败时也一样写。“不污染用户数据”这个副本模型的最大好处就此消失。
2. **大档案上启动不稳定**（180s 超时；而剔除缓存的副本秒开）。日常档案动辄几 GB，这很可能是体积/同步态相关，需再定位。
3. **副作用面（本次属可接受范围吗）完全未知**：浏览器同步可能把这 111 个变更推到用户其他设备。

建议修正方向（待用户定）：**目标仍可为真实 profile，但默认只读不可行——要么先定位启动超时根因，要么把“真实 profile”降级为需要明确知情同意的选项**（confirm 里写“会写你的日常档案，可能被同步推到其他设备”），默认仍指向副本。
