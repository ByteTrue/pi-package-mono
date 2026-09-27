---
kind: decision
title: "pi-image-gen 配置定型为单容器 + 显式 default route，迁移单向且只留 .v1.bak 作退路"
created: 2026-09-27
superseded-by: ""
---

# pi-image-gen 配置定型：单容器 + 显式路由，迁移单向

`settings.json` 只有一个 `providers` 容器（built-in 与 custom 同权），路由真相只有 `default: {provider, model}` 一处；`models` 退化为清单（供选择器与文件名），不再参与解析。迁移是一次性硬重写：读到旧形状就重写为 v2 并把原文保留为 `settings.json.v1.bak`，之后不再镜像写回 `defaultModel`，也不提供 downgrade 路径——`version > 2` 拒绝重写、built-in 与 custom 的 id 冲突时不动文件，这两类歧义宁可留着让人手处理，也不替用户猜。

## 背景与取舍

- 旧形状有三处各自为政的路由线索：`defaultModel` 字符串（可含 alias，也可含 provider 前缀）、`providers` + `customProviders` 双容器、以及「provider 没有 `models` 字段 ⇒ 接受任意 id」的 catch-all。三者组合出的级联能从代码重建，但语义无法在菜单里如实呈现——改一个模型 id 必须重走配 URL 和 key 的完整向导。
- 备选：保留 catch-all 以兼容「未声明 models 的放开状态」。否决理由：路由显式化之后，「没有清单」和「放开任意 id」是两件事，用同一个缺失表达会永久混淆；v1 的放开语义随显式 default 一并退役。
- 备选：alias 继续参与路由。否决理由：`default` 已点名 provider，alias 再参与解析就仍有第二条隐含路由线索，与「唯一真相」冲突；降级为清单标签与文件名前缀。
- 代价：磁盘格式破坏性变更，且单向。用户已明确授权破坏性变更，前提正是「迁移要做好」——所以备份、幂等重读、失败非致命这三条是这块板的前提而非附加项。
