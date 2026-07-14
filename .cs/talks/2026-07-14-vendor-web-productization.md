# pi-vendor Web 产品化升级 talk

## 原始想法

dual-UI 大改已交付，但成品很烂，要全面升级。问题多到说不完，不知从哪开始。举例：按模型 id 查 Pi 内置配置模板在 Web 上没有；大量交互简陋。

## 真问题

第一版 dual-UI 交付了可用骨架与安全边界，但 Web 还没达到「日常愿意用」的产品完成度：相对 TUI 有能力缺口、任务路径不完整、交互与视觉偏原型。问题混在 **能力 / 路径 / 观感** 三层，需要先清单再分批，而不是无边界全面重写。

## 术语

- **官方模板 / enrich**：按 model id 查 Pi 官方 catalog 或 enrich，填充 name/api/context 等字段
- **产品化**：能力可用 + 主路径顺 + 观感可接受，不是再堆一个原型页
- **填充策略**：新增 vs 编辑时如何把模板写进表单

## 已确认决策

- 推进方式：**短清单（C）→ 能力优先（A）** 开新 epic，不挂回已关闭的 dual-UI epic
- 出口：**新 epic** `pi-vendor Web 产品化升级`
- 首批顺序：① 编辑器 id→官方填充 ② Add model 主路径对齐 TUI ③ 模型表单常用字段 ④ 动作栏/文案 ⑤ 布局密度
- **填充策略**：新增默认整表用模板；编辑已有模型点「从官方填充」时二次确认后覆盖模板字段；headers 等用户密钥字段不覆盖
- 安全边界（SecretRef、revision、loopback、原子写）默认不重开

## 约束

- 不重写 config core
- 本 epic 默认只 Web（TUI 仅在共用 enrich 暴露时顺带）
- 未确认前不做 npm 发版

## 影响面、风险与取舍

- 会动 web client 模型编辑器/主路径，可能小改 session 状态暴露
- 能力先补可避免「抛光仍不能用」；布局后置可能阶段性仍难看
- Cancel/dialog 生命周期等 bug 并入路径批或单独修

## 分歧

- 无（本轮已确认）

## 初步出口草案

- 建议出口：新 epic + 首批 open feature issues
- 落点：`.cs/epics/2026/07/14/vendor-web-productization/spec.md`
- 暂不纳入：远程管理、daemon、TUI 大改、发版
