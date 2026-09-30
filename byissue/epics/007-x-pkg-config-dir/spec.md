---
kind: epic
title: "扩展私有配置统一到 <agent dir>/pi-pkg-cfg"
status: closed
created: 2026-09-30
---

# 扩展私有配置统一到 `<agent dir>/pi-pkg-cfg`

> **读者：** 在这条有界变化里对齐的人——相对现状要改什么、现在怎么理解方案、哪些能推、哪些还悬着、关了合回哪里。

## 要改变什么

四个包的私有配置落点收敛成一条约定：`<agent dir>/pi-pkg-cfg/<包名>/<文件>`，其中 `<agent dir>` = `$PI_CODING_AGENT_DIR` 或 `~/.pi/agent`，整根可用 `$PI_PKG_CFG_DIR` 覆盖。pi-vision 与 pi-subagent 现在借 Pi `settings.json` 的节存东西，这次搬进各自独立文件——用户 2026-09-30 的原话是「我们所有包，只要需要落盘配置文件的，都用自己独立的文件，别去耦合」。老位置一律只读回退、永不搬迁（见 `byissue/decisions/004-pkg-config-dir.md`）。

不来自 Vision（`byissue/vision/index.md` 没有配置位置条目）；来源是 2026-09-30 的使用反馈与代码核对，关联 `byissue/spec/pi-web-search/index.md`、`pi-image-gen/index.md`、`pi-vision/index.md`、`pi-subagent/index.md`。

## 为何现在做

pi-vision 与 pi-subagent 把配置写进 Pi 本体的 `settings.json`：每次写都是整份读—改—写，与 Pi 自己的 `/settings` 写入存在同毫秒覆盖窗口（pi-vision 源码里那条 ponytail 注释就是它）；两个包也只因共用同一个文件才需要互相谦让。搬成独立文件后，这个共享面直接消失。同时四个包的四套路径解析（三套 env 变量、三种默认基准）让人无法回答「我的配置到底在哪」——正在跑的机器上就同时存在三个真实位置。

## 已确定（相对现状的取舍）

- **统一根 `<agent dir>/pi-pkg-cfg/`**，子目录用不带 scope 的包名（`pi-pkg-cfg/pi-web-search/config.json`，不是 `@bytetrue/pi-web-search`，也不含 `/`）。
- **新位置优先，老位置只做回退**：新文件一存在，老位置永久不再参与读取。因此 TUI 改配置不需要清理老文件，清理反而毁掉回滚退路。
- **任何读或写之前先做整节迁移**：该层新文件缺失且老位置有数据时，先把老内容**完整**搬进新文件，再套本次改动；写路径同样如此。只按需搬单个键会静默丢数据——老全局节 `{model: X, autoAnalyzeAttachments: true}` 加一次 `/vision auto off`，会因新文件一存在老节即被跳过而让 `model: X` 消失。首读迁移与 TUI 写前迁移共用同一入口。
- **迁移是单次原子写**：内存里读出老内容、套上本次改动、一次 temp+rename 落盘——不是「先复制、再改写」两次写（中途崩溃会留下残缺新文件，老位置从此被永久遮住）。新目录建不出来（权限、只读 FS）时，本次操作退回读老位置并如实标注，不得让升级后的第一次 `web_search` 直接报错。
- **项目层不自动迁移**：pi-vision / pi-subagent 的项目层老位置是 `<project>/.pi/settings.json` 的节，只读时绝不写用户仓库；新项目层 `<project>/.pi/pi-pkg-cfg/<包名>/settings.json` 只在用户显式写入该项目作用域时创建，且创建时同样先整节复制老项目节再套改动。项目层是 local 的，不受 `$PI_PKG_CFG_DIR` 影响。
- **老位置标示**：生效值来自老路径时，状态输出与报错写明 `legacy (read-only fallback): <path>`。pi-vision 的项目覆盖从不写（只读），老项目节会一直生效到用户手工删除——有意为之（项目覆盖本就该压过全局），靠状态输出显示生效路径。
- **范围外**：pi-vendor 的 `models.json` 不动（Pi 本体启动要读，属「Pi 按固定路径读的文件」）；`mcp.json` / `auth.json` / Pi `settings.json` 同样留在 agent dir 根；pi-background-terminal 无持久配置（任务输出是数据不是配置）；pi-browser 的 `<agent dir>/pi-browser/profiles/` 是浏览器数据，同理豁免；pi-subagent 的 agent 文档（`.pi/agents/*.md`、`<agent dir>/agents/*.md`、`~/.pi/agents/*.md`）不搬——那是用户/项目内容模板，内置角色与用户文档共用同一套解析。
- **不新开共享包**：四个包各自保留约十行路径解析（`<agent dir>` 解析、`$PI_PKG_CFG_DIR` 优先级、原子写）。防漂移靠四个包测试里的同一组场景断言，不靠共享运行时。

## 仍在变化

- 跨包一致性测试的形态：倾向「每个包用同一张场景表（同一 env → 同一根；覆盖优先级；legacy 标注）」，尚无独立 harness。
- 老位置保留多久：当前无删除计划；等四个新位置在真实使用中稳定后再决定是否值得做一次性清理提示。
- 发布节奏：四包各自 minor 发版还是攒成一次，未定。

## 必须守住

- 每条写入仍是原子写（同目录 temp + rename）；配置目录 `0700`、文件 `0600`（pi-subagent 现状缺 `0600`，本次对齐）。
- 交互写入 fail-closed（坏 JSON / 非对象拒绝覆盖并说明怎么修）；runtime 读 fail-soft。
- 任何输出、错误、日志都不得出现 literal key 或解析后的凭据值。
- 项目层读取继续以 `ctx.isProjectTrusted()` 为闸，新路径与老路径同等对待。
- 修完 spec 里那几处已过期的配置落点描述（`byissue/spec/index.md` 现说 image-gen 仍写 Pi `settings.json` 的节，且说 subagent「无独立持久配置」）。

## 统一语言

- **agent dir**：`$PI_CODING_AGENT_DIR` 或默认 `~/.pi/agent`；Pi 读取 `settings.json` / `models.json` / `mcp.json` / `auth.json` 与 `extensions/`、`skills/`、`prompts/`、`themes/` 的根。
- **pkg-config 根**：`$PI_PKG_CFG_DIR` 或 `<agent dir>/pi-pkg-cfg`，只决定**写**位置。
- **老位置（legacy）**：该包迁移前读写的位置；本次之后只读、只回退、永不搬迁。
- **legacy 回退**：新文件缺失且老位置有数据时，本次读取用老位置的值，并输出 `legacy (read-only fallback): <path>`。
- **整节迁移**：把老位置的整体内容（web-search / image-gen 是整份文件，vision / subagent 是 `settings.json` 里的整个节）一次原子写入新文件，再套改动。
- **层（layer）**：global（`<pkg-config 根>/<包名>/settings.json`）与 project（`<project>/.pi/pi-pkg-cfg/<包名>/settings.json`）；只有 vision / subagent 有 project 层。

## 质量候选（尚非承诺）

- **可逆性**：`rm -rf <agent dir>/pi-pkg-cfg` 后，四个包回落到老位置，行为与迁移前一致。证明：临时目录上删新文件重跑同一组断言。
- **迁移正确性**：老文件仍在原位且逐字节未变；新文件与老内容一致（整份文件迁移逐字节相等，节抽取按解析后深相等）。证明：四个包的迁移测试。
- **一致性**：四个包对同一组 env 解析出同一个根。证明：各包测试中的同一张场景表。
- **可测试性**：全部路径与迁移可脱离真实 `$HOME` 验证。

## 推进视图

- `issues/001-x-pkg-config-web-search.md` — pi-web-search：落成约定参考实现（含 `$PI_CONFIG_DIR` 只作老位置定位）。
- `issues/002-x-pkg-config-image-gen.md` — pi-image-gen：`<agent dir>/pi-image-gen/` → `<pkg-config 根>/pi-image-gen/`，含 `.v1.bak` 落点澄清。
- `issues/003-x-pkg-config-vision.md` — pi-vision：从 Pi `settings.json` 节抽出为独立文件（global + project 层）。
- `issues/004-x-pkg-config-subagent.md` — pi-subagent：同上，并顺手补齐 `0600`。
- `issues/005-x-docs-and-spec-alignment.md` — 四个 README 与 `byissue/spec/` 的落点描述对齐。
- 暂不推进：pi-vendor 路径（`models.json` 留在 agent dir 根）；共享路径包；老位置清理提示。

## 关闭条件与证据

- 四个包的新位置可读写、老位置逐字节未变：四包迁移测试 + 真机 `sha256` 比对（web-search `5769d849...` 两端一致；image-gen 老文件未变）。
- 老版本包降级读取仍生效：`pi-web-search@0.4.1`、`pi-image-gen@0.5.0`、`pi-vision@0.2.3`、`pi-subagent@0.9.1` 在隔离沙箱里均仍读老位置。
- 四包 `typecheck` 绿、`npm test` 全绿：`617 passed`（background-terminal 8/53、image-gen 12/125、subagent 3/54、vendor 19/191、vision 6/87、web-search 12 passed+1 skipped files / 115 passed+9 skipped）。9 skipped 为既有 live E2E 网络依赖，非本次引入。
- 在真实 Pi 里跑通 `/web --show`、`/vision auto off`、`/subagent`、`/image-gen`（含 Q25 整节迁移的真机复现）。
- 交互写 fail-closed、runtime 读 fail-soft：四包各有坏 JSON 拒写用例，且四包 `settingsLocation()` / `configLocation()` 都有「新根建不出来 → 回退 legacy」分支（含 pi-vision 新增的第 22 条用例）。
- 已修 `byissue/spec/index.md` 里两处过期描述（image-gen 写 Pi 节、subagent 无独立持久配置）。

## 关闭回写

- 状态：`closed`
- 合并位置：`byissue/spec/index.md` 的「统一语言」（新增 pkg-config 根 / legacy 回退 / 整节迁移三条）与「架构考量」（新增「包私有配置收在 `<pkg-config 根>`」一条）；四个子 spec 的配置位置段落已由 issue 005 就地改好。
- 约定本体：`byissue/decisions/004-pkg-config-dir.md`（承载取舍、被否决方案与两条代价，不回写 spec）。
- 保留材料：5 个 issue 的执行记录 / 验证 / 关闭结论、Talk 过程中的设计基线推演。

## 关闭结论

四个包的私有配置收敛到 `<agent dir>/pi-pkg-cfg/<包名>/` 单一约定，老位置一律只读回退、永不搬迁。pi-vision / pi-subagent 与 Pi 本体共享 `settings.json` 的写入窗口随之消失。开启 `byissue/decisions/004-pkg-config-dir.md` 前已核完其全部代价项：四份路径层实现的维护成本已点名并接受（不抽共享包——四包 `dependencies` 全空、只依赖 `@earendil-works/*` peer）。

关闭后另行授权的 npm 发布由版本 bump 与 issue 的发布记录承担。

## 相关材料

- 决策：`byissue/decisions/004-pkg-config-dir.md`
- 落点真相：`byissue/spec/index.md`、`byissue/spec/{pi-web-search,pi-image-gen,pi-vision,pi-subagent}/index.md`
- 用户原话（2026-09-30）：「我们所有包，只要需要落盘配置文件的，都用自己独立的文件，别去耦合」
