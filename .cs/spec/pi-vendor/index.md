# pi-vendor

## 这一层是什么

`@bytetrue/pi-vendor` 管理 pi 的自定义 provider / model 配置文件 `models.json`。交互分两层：**TUI 高频快捷**与**一次性本地 Web 完全管理**；两边共用同一套配置与模型源语义。

Peer：`@earendil-works/pi-coding-agent` `>=0.79.10`。

## 它负责什么

- **TUI `/vendor`**：Add model / Add provider / Open Web / Cancel；Save 恰好一次 commit + registry refresh；Cancel / Esc / Add another 零写入。
- **Web `/vendor web`**：loopback 一次性 modal；内存 draft；Save 校验 + revision + SecretRef hydration + 原子写；Cancel / Pi Esc / session_shutdown 回收 server。
- **Config core**：快照、局部校验、Pi `ModelRegistry` oracle、revision 条件提交、provider/model 纯 mutation（`MutationResult` / `ConfigCoreError`）。
- **Model source core**：官方 catalog、enrich、OpenAI-compatible `/models` 发现（信任预检、截止时间、体预算、typed errors、closed DTO）。
- **密钥**：已知 secret 路径以 opaque `SecretRef` 进浏览器；exact path + baseRevision hydration；移动/伪造 fail closed。

## 它不负责什么

- 不管理 `auth.json`、OAuth `/login`、stream 实现或扩展安装本身。
- 不做常驻 daemon、固定端口、DB、WebSocket、多用户协作、autosave。
- 不监听非 loopback；不引入运行时 Web 框架或远程 CDN。
- 不把完整 Pi schema 反射成通用表单；未知字段靠 round-trip + Raw JSON。

## 统一语言

- **revision**：`sha256:<64 hex>`，乐观并发，不是跨进程锁。
- **SecretRef**：`pi-vendor-secret:<128-bit base64url>`。
- **MutationResult**：领域 identity 操作的判别联合结果。
- **ConfigCoreError**：读/写/oracle 路径错误。
- **ConflictPolicy**：`reject` | `overwrite-confirmed`；默认不隐式 upsert。
- **first-terminal-action-wins**：saving 中 Cancel 只标记 closeAfterResponse；saving 拒绝新终端动作（409）。
- **opaque keep-value**：浏览器不拿已有明文 known secret。

## 使用路径

| 想完成的事 | 入口 |
|---|---|
| 快速给已有 provider 加模型 | `/vendor` → Add model |
| 最短路径新建 provider | `/vendor` → Add provider |
| 完整 CRUD / Raw JSON / 批量导入 | `/vendor web` 或 TUI Open Web |
| 冲突 / 陈旧 revision | Web `409 config_changed` → 关闭重开 |
| Secret 路径失效 | 重输或删除，禁止隐式 remap |

## 子系统地图

```text
Config core ──► TUI quick workflows
     ▲                  │
     │                  ▼
     └──────── Web modal runtime ◄── Model source core
                      │
                      ▼
                 static Web UI (draft in browser memory)
```

1. **Config core**：document + mutation + oracle + atomic commit  
2. **Web modal runtime**：session、token、CSP、routes、SecretRef  
3. **Model source core**：catalog / enrich / discover  
4. **TUI / Web workflows**：任务状态机与表单；不复制业务规则  

## 架构考量

- **双 UI 单语义**：校验、冲突、密钥、发现只在 core；UI 只编排。
- **Pi 作兼容 oracle**：不复制完整 schema；未知字段 round-trip。
- **严格 JSON 提交**：canonical `JSON.stringify(..., null, 2)` + newline；不保留注释/BOM。
- **安全默认**：127.0.0.1、随机端口与 bearer、CSP、no-store、0o600 原子写。
- **关闭后的 polish**：第一版 dual-UI owner 曾接受「可用即关」；现已另开 epic **Web 产品化升级**（`.cs/epics/2026/07/14/vendor-web-productization/`）补能力缺口与体验，不在此重复当已完成。

## 当前边界

**做**：models.json 可表达的 provider/model 管理与安全保存。  
**不做**：远程管理、daemon、鼠标 TUI、auth 系统、新发现协议族。

## 证据索引（按需）

- 包 README：`packages/pi-vendor/README.md`
- closed epic：`.cs/epics/2026/07/12/vendor-dual-ui-manager/spec.md`
- closed feature issues：`.cs/issues/2026/07/12/closed-vendor-*.md`
- 旧 design/QA 全量：`.cs/archive/codestable-legacy/features/2026-07-12-vendor-*/`
