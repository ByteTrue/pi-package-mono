---
kind: note
title: "Chromium profile 登录态：哪些原语能保住手动登录（实测）"
created: 2026-09-14
tags: [pi-browser, playwright-cli, chromium, cookies, import]
status: open
---

# Chromium profile 登录态：哪些原语能保住手动登录（实测）

> **读者：** 以后有人（包括我们自己）再提"重导会不会冲掉手动登录 / 能不能不冲掉"时——省掉重新调研的功夫。
> **一句话：** 冲掉是文件级覆盖的必然结果；能绕开的原语实测过，但用户 2026-09-14 判定成本不值，明确接受现状。别自研 cookie 解密。

## 结论：为什么必然冲掉

managed profile 是**副本**。`buildStagingProfile` 的做法是"保留现有 profile → 用新快照按文件覆盖"。Cookies 是 SQLite、Local Storage/IndexedDB 是 leveldb，**都无法字段级合并**（leveldb 更是只能整目录换）。所以只要重导，手动登录的东西就被源浏览器的同名文件整体替掉。

## 实测过的原语（playwright-cli 0.1.19）

| 能力 | 结果 |
| --- | --- |
| `state-save` | **导出已解密的明文** cookie + localStorage（`{cookies:[{name,value,domain,path,expires,…}],origins:[…]}`）。这是唯一能拿到明文的路子，**不需要**自己碰 Keychain / AES |
| `state-load` | localStorage 部分**能落盘**（跨会话还在）；cookie 那次没落盘 |
| `cookie-set`（带 `--expires`） | **能被同 profile 的新会话读到**（手动登录成立的基础） |
| session cookie（不带 `--expires`） | 随会话销毁，**存不住**——任何方案都救不了 |

坑：Chromium **异步刷库**，直接读 `Default/Cookies` 会得到假空结果（我第一次就被这个误导，差点判成"登录态根本不落盘"）。可靠判据只有一个——**close 会话，再开新会话 `cookie-list`**；读文件必须连 `-journal`/`-wal` sidecar 一起复制再读。

## 验"能否解密"的两个仪器级陷阱（踩过三轮才想明白）

1. **写方与读方必须用不同 keychain 后端**。`--headless=new` 的 Chrome/Edge 在 macOS 上**也走 mock keychain**（无法弹钥匙串授权），所以"headless 写 → headless 读"两边同钥，必然都成功——零信息量。真判据要么用**有头**浏览器写，要么直接拿**真实日常 profile** 的密文副本做读方实验。
2. **先确认两臂真的不同**：对比实验必须 `ps -A -ww -o command` 把两边实际 argv 拉出来 diff。本例所谓"A 臂带 mock keychain"其实根本没加上（两臂 argv 仅 userDataDir 不同），直接得出了假结论。另：`ps` 不加 `-ww` 会截断长 argv，grep 不到 ≠ 不存在。
3. 附：playwright-core 里有**两个** chromium 开关列表，只有非 persistent 的那个含 `--use-mock-keychain`；而 `launchOptions.args` 是**追加**在默认列表之后，盖不住前面已有的同名项，想真去掉只能用 `ignoreDefaultArgs`。

## 直连【活】真实 profile 的代价（实测，勿重踩）

对真实 Edge 日常档案（Default 2.7G）：即使浏览器已退、`SingletonLock` 已释，playwright-cli 直连仍 **180s 启动超时**，而失败前已改写 **111 个档案文件**（含 `Cookies`/`Preferences`/`Secure Preferences`/Local+Session Storage），cookie 376→336。**同一档案的 /tmp 完整副本却秒开、登录态可用**（message.bilibili.com 不被跳转）。要复现只能在 /tmp 副本上做，并验完立即 `rm -rf`（内含全部凭据）。

## 如果将来要重评（两条路，都没做）

1. **双层 profile**：基座=导入快照（可随意重导）+ 账本=`vault.json`（手动登录，重导后 `state-load` replay 回去，vault 覆盖快照）。真正解决，代价是多一个模块 + vault 明文落盘的安全面；且要先钉死"cookie 能否经 state-load 持久化"（未验证完，我 close 太快可能是假阴性）。
2. **Cookies 表行级合并**：唯一索引实测是 `(host_key, top_frame_site_key, has_cross_site_ancestor, name, path, source_scheme, source_port)`，同 channel 同密钥故合并后可解密。但**只救 cookies**、救不了 leveldb，且依赖 Chromium 表结构不变——比 1 更脏更脆。

**用户判定：** 两条都不做，接受"重导后手动登录需重做"。Manual sign-in 入口保留，菜单与 confirm 均已写明会丢。
