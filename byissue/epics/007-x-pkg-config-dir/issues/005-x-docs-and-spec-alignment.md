---
kind: issue
title: "四包 README 与 byissue/spec 的配置落点对齐"
type: chore
status: closed
created: 2026-09-30
closed: 2026-09-30
---

# 四包 README 与 `byissue/spec` 的配置落点对齐

> **读者：** 以后按文档找配置的人——这条把迁移后的真相写回文档，并修掉几处已经和代码不符的旧描述。

## 目标与范围

包含：`packages/pi-web-search/README.md`、`packages/pi-image-gen/README.md`、`packages/pi-vision/README.md`、`packages/pi-subagent/README.md`（如涉及）与 `packages/pi-vendor/README.md` + `skills/pi-vendor/SKILL.md`（只加一句「`models.json` 是有意留在 agent dir 根」）；`byissue/spec/index.md` 的架构落点表与「当前方向」「使用路径」；`byissue/spec/pi-web-search/index.md`、`pi-image-gen/index.md`、`pi-vision/index.md`、`pi-subagent/index.md` 的配置位置段落。

不包含：`pi-browser/index.md`（已删包，属另一件事）、任何代码。

## 要改成什么

- 四处「配置在哪」的答案统一成同一句式：`<pkg-config 根>/<包名>/<文件>`，`$PI_PKG_CFG_DIR` 或 `<agent dir>/pi-pkg-cfg`；老位置作为只读回退列出。
- 顺带修掉已与代码不符的三处：`byissue/spec/index.md` 仍写 image-gen 配置在 Pi `settings.json` 的节（实际早就是独立文件）、写 subagent「无独立持久配置」（实际有 `subagent` 节）、`pi-image-gen` 行说「或可信 `<cwd>/.pi/settings.json` 的节」（该包没有项目层）。
- 根 `README.md` 若列了配置位置，一并对齐。

## 验证方式（计划）

- 全文 grep 老位置字符串（`byte-pi-web`、`pi-image-gen/settings.json`、`settings.json` 的 `pi-vision`/`subagent` 节），确认剩余命中都是「老位置 / 回退」语境的如实描述。
- 不跑代码测试；文档改动随四个实现 issue 一起验证。

## 执行记录

**改动清单（与设计一致）：**

- `packages/pi-web-search/README.md:62-64` —— 配置位置改 `<pkg-config 根>/pi-web-search/config.json`（根 = `$PI_PKG_CFG_DIR` 或 `<agent dir>/pi-pkg-cfg`）+ 0.4.x 升级段（首次读取逐字节复制、原件不动、`$PI_CONFIG_DIR` 只定位老文件）。
- `packages/pi-image-gen/README.md:67,69,78,128` —— 配置路径改 `<pkg-config 根>/pi-image-gen/settings.json` + 0.5.x 升级段（`$PI_AGENT_HOME` 只定位老文件）；`.v1.bak` 措辞改为「落在新文件旁边」；CLI note 的 env 由 `PI_CODING_AGENT_DIR / PI_AGENT_HOME` 改为 `PI_PKG_CFG_DIR / PI_CODING_AGENT_DIR`。
- `packages/pi-vision/README.md:86-88` —— global / project 路径与 0.2.x 升级段。
- `packages/pi-subagent/README.md` —— 新增 `## Settings Files` 段（位于 Interactive Configuration 与 Tool Reference 之间）：global / project 路径、`$PI_PKG_CFG_DIR`、JSON 示例为节本体、0.9.x 升级说明（整节一次性搬迁 + Pi 文件不动可回滚 + `legacy (read-only fallback): <path>` 标注 + 老项目节一直生效直到用户删除）；模型优先级链两条由 `subagent.agents[role].model` / `subagent.defaultModel`（settings）改为 `agents[role].model` / `defaultModel`（settings file）。
- `packages/pi-vendor/README.md:21` —— 补一句 `models.json` 有意留在 agent dir 根（Pi 本体启动要读），不迁入 `pi-pkg-cfg`。
- `packages/pi-vendor/skills/pi-vendor/SKILL.md` —— 同款一句说明。
- `byissue/spec/index.md` —— `:21` 与 `:41` 的 image-gen 行改写；架构落点表四行（web-search / vendor / image-gen / vision / subagent）全部重写为统一句式 + 老位置只读回退；**顺带修掉三处与代码不符的旧描述**：image-gen 不再说写 Pi `settings.json` 节、subagent 不再说「无独立持久配置」、image-gen 行删掉「或可信 `<cwd>/.pi/settings.json` 的节」（该包无项目层）。
- `byissue/spec/pi-web-search/index.md:14`、`pi-image-gen/index.md`（4 处）、`pi-vision/index.md`（5 处，新增「pkg-config 根」「legacy（只读回退）」两条统一语言，并把「无锁并发窗口已知且接受」改写为「写自家文件后该窗口消失」）、`pi-subagent/index.md`（3 处，新增「配置文件」行）、`pi-vendor/index.md:5`。

**范围外（按设计未动）**：`byissue/spec/pi-browser/index.md`（已删包，属另一件事）、任何代码。

## 验证

- 用「老位置字符串」全文 grep（排除 `node_modules` 与 `byissue/archive`），剩余命中全部落在三类语境：(1) 新增的「老位置 / 只读回退」描述，(2) epic 007 / decision 004 与历史 issue（历史记录，不属当前真相），(3) 包名本身。
- 唯一残留陈旧点：`byissue/spec/pi-browser/index.md:144` 的 `PI_CODING_AGENT_DIR → PI_AGENT_HOME → ~/.pi/agent` —— 已删包、按范围外条款保留。
- 未跑代码测试（纯文档）。
- 四个实现 issue 的 README 改动由各自的包测试间接覆盖（README 本身无断言）。

## 关闭结论

- **判断**：四个 README 与 `byissue/spec/` 的配置落点描述已对齐迁移后真相；顺手修掉 `byissue/spec/index.md` 里「image-gen 仍写 Pi `settings.json` 节」与「subagent 无独立持久配置」两处过期描述。无新增沉淀候选——本 issue 的产物即 spec 本身。
- **验证**：纯文档，未跑代码测试；结论随 `byissue/spec/**` 改动就地生效。
- **回写**：`packages/{pi-web-search,pi-image-gen,pi-vision,pi-subagent}/README.md`、`packages/pi-vendor/README.md`（说明 `models.json` 有意留在 agent dir 根）、`packages/pi-vendor/skills/pi-vendor/SKILL.md`、`byissue/spec/index.md`、`byissue/spec/{pi-web-search,pi-image-gen,pi-vision,pi-subagent,pi-vendor}/index.md`。
- **遗留**：`byissue/spec/pi-browser/index.md` 描述的是已删除的 pi-browser 包，不属本 Epic 范围。
