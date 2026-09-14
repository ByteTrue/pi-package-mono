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

## 如果将来要重评（两条路，都没做）

1. **双层 profile**：基座=导入快照（可随意重导）+ 账本=`vault.json`（手动登录，重导后 `state-load` replay 回去，vault 覆盖快照）。真正解决，代价是多一个模块 + vault 明文落盘的安全面；且要先钉死"cookie 能否经 state-load 持久化"（未验证完，我 close 太快可能是假阴性）。
2. **Cookies 表行级合并**：唯一索引实测是 `(host_key, top_frame_site_key, has_cross_site_ancestor, name, path, source_scheme, source_port)`，同 channel 同密钥故合并后可解密。但**只救 cookies**、救不了 leveldb，且依赖 Chromium 表结构不变——比 1 更脏更脆。

**用户判定：** 两条都不做，接受"重导后手动登录需重做"。Manual sign-in 入口保留，菜单与 confirm 均已写明会丢。
