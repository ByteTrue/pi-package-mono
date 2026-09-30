---
kind: decision
title: "扩展私有配置统一到 <agent dir>/pi-pkg-cfg/，老位置只读回退、永不搬迁"
created: 2026-09-30
superseded-by: ""
---

# 扩展私有配置统一到 `<agent dir>/pi-pkg-cfg/`，老位置只读回退

本仓每个扩展的私有配置改成 `<agent dir>/pi-pkg-cfg/<包名>/<文件>` 单一位置（`<agent dir>` = `$PI_CODING_AGENT_DIR` 或 `~/.pi/agent`，整根可用 `$PI_PKG_CFG_DIR` 覆盖）；老位置（`~/.pi/byte-pi-web/config.json`、`<agent dir>/pi-image-gen/settings.json`、Pi `settings.json` 的 `pi-vision` / `subagent` 节）**只读、只做回退**——不重命名、不删除、不回写，新文件一存在老位置即永久不再参与读取。放弃 `<agent dir>/bytetrue/` 与 `~/.bytetrue/pi-pkg-cfg`：前者让包目录与 Pi 自己的 `models.json` / `settings.json` / `auth.json` 平铺在同一层、缺命名空间，后者是组织命名空间而非配置单元，且会让配置与它所属的那套 Pi 配置脱钩。

## 背景与取舍

- 现状是四套各自为政的落点：`PI_CONFIG_DIR → ~/.pi/byte-pi-web/`、`PI_CODING_AGENT_DIR|PI_AGENT_HOME → <agent dir>/pi-image-gen/`、以及 pi-vision / pi-subagent **借 Pi `settings.json` 的节**放自己的东西。最后一类是真正的问题：两个包共用 Pi 本体的文件，每次写都要整份读写（互相覆盖窗口存在），而 Pi 本体从未为这两个节承诺过语义。
- 备选：`~/.bytetrue/pi-pkg-cfg`（用户最初提议）。否决理由：跨 profile 共享听起来是优点，代价是配置与它所属的那套 Pi 配置脱钩——备份、容器挂载、多 profile 不再由同一个 `PI_CODING_AGENT_DIR` 管；且本机已存在 `<agent dir>/pi-image-gen/` 这个「包私有目录放 agent dir 下」的在跑先例，两套约定并存比统一更贵。
- 备选：老位置就地搬迁（rename / 删除 / 留 `.moved.bak`）。否决理由：pi-vision / pi-subagent 的老位置是 Pi 共享 `settings.json` 的节，删节或重命名是碰用户与 Pi 本体的文件；且老文件原地保留是唯一现成的回滚退路——降级回旧版包时配置还在。
- 代价：老文件成为失效副本（内容仍在新文件里，但改它不再生效）。用「生效值来自老路径时状态输出与报错写明 `legacy (read-only fallback): <path>`」补偿；新文件一存在，该提示自然消失。
- 代价：降级期间在旧版包上做的写入会落在老位置，重新升级后因新文件优先而被永久遮住。这是「老位置只读回退」的直接推论，靠上面那条提示可发现，不做自动回并。
- 代价：路径层（`agentDir()`、新/老路径推导、原子写、`legacy` 判定与标注）在四个包里各有一份实现，没有共享包。修一处边界要同步四处；已经踩过的边界坑必须在四份里都补——`existsSync` 对目录也为真，所以「新文件存在」要用 `statSync().isFile()`，「老路径存在但可能不可读、必须 fail closed」要用 `statSync()` 任意成功。抽共享包会让这四包产生互相依赖（当前 `dependencies` 全为空、只依赖 `@earendil-works/*` peer），代价大于收益。
