---
kind: issue
title: "background_run 任务寿命硬上限 3600s → 36000s（10h）"
type: ff
status: closed
created: 2026-10-01
---

# background_run 硬上限 3600s → 36000s

**触发（2026-10-01，用户 m00054）**：用户原话「我想说的其实是，确实太短了，给我改到 36000 的上限，就这么简单」。背景是一张上一会话的自述图：Expo dev server（8093）与 dev daemon（6778）各按 3600s 超时被杀，每次都要重起、再重连浏览器，一个会话内反复发生。

## 改动

- `packages/pi-background-terminal/src/tools/background-run.ts`
  - `:27` `export const HARD_CAP_LIFETIME_SECONDS = 36_000;`（原 `3600`）。
  - `:19-26` rationale 注释重写：旧口径「上限只钳会话内僵尸任务，3600s 够覆盖 build/test」保留前半（上限仍存在），但承认后半的账算漏了——**续期不是免费的**，dev server 每次到点都要重启并重连消费者（浏览器/客户端），该成本在单个工作会话内就会发生；10h 长于任何工作会话，上限只为真正被遗忘的任务触发。
  - `:40-42` 注释里的硬编码「3600s」改为引用常量名，防再次漂移。
  - `:66` promptGuidelines 第五条从**硬编码文本**改为模板插值 `(default ${DEFAULT_LIFETIME_SECONDS}s, hard cap ${HARD_CAP_LIFETIME_SECONDS}s …)`——这是本次顺带修掉的漂移源（description/schema 早已插值，只有这条 guideline 写死数字）。
  - `:86` 的 `Math.min(…, HARD_CAP_LIFETIME_SECONDS)` 无需改动；schema `maximum: 2147483` 不受影响。
- `packages/pi-background-terminal/src/tools/background-run.test.ts:43,55-59`：用例名与断言改为 36000s；用例结构不变（仍传 `timeout: 86400`，仍 > 新上限，仍被钳）。
- `packages/pi-background-terminal/README.md:20`：hard cap 3600 → **36000 (10 hours)**。
- `packages/pi-background-terminal/package.json`：description 的 `3600s` 同步；版本 `0.10.0` → `0.11.0`（行为变化，minor）。
- `byissue/spec/pi-background-terminal/index.md:19,63`：规则与使用路径表同步（dev server 推荐 `timeout: 36000`）。

## 设计决策

- **10h 而不是取消上限**：仍是「总寿命硬杀」，只是把天花板抬到工作会话之上。0.8.x 教的 86400（24h）依旧被钳——ff 099 反对的不是「大数字」本身，而是「上限形同虚设」。
- **不动的部分**：bash/powershell 的 300s 前台上限不变（那是另一条账：前台跑飞会挂死 agent，与后台续期成本无关）。
- **成本归属已记录**：这条上限的真实成本不在「僵尸任务烧资源」，而在「到点重启 + 消费者重连」。若未来再收到同类抱怨，正确的解法方向是让服务脱离 background_run 寿命（外部托管/稳定 URL），而不是继续抬上限——但在本次诉求下，抬到 10h 是最短路径。

## 验证

- `npm --workspace @bytetrue/pi-background-terminal test`：8 files / 52 passed + 1 skipped（53）。
- `npm --workspace @bytetrue/pi-background-terminal run typecheck`：通过。
- `grep -rn '3600' packages/pi-background-terminal`：仅剩注释里的历史说明。
- 未做：真实 Pi 回归（模型是否会因上限变大而不续期——短时间内不会触发）；发布（tag `pi-background-terminal-v0.11.0`）待授权。

## 发布（2026-10-01，用户 m00109 授权）

- 提交链：`3016995` feat → `45f52bf` docs(byissue) → `bc385fd` release(pi-background-terminal) 0.11.0。
- 推送前先跑全仓 gate：`npm run typecheck --workspaces --if-present` + `npm test` 退出码 0（本地一次 push 遇 `Recv failure: Connection was reset`，重试成功；tag 指向 `bc385fd`）。
- `git tag pi-background-terminal-v0.11.0` → `git push origin <tag>` 触发 `.github/workflows/release.yml`。
- Actions run `36903936395` 全绿：`npm ci` → workspace typecheck → `npm test` → OIDC 发布（publish 到 registry.npmjs.org，provenance 已签，logIndex 3038861034）。
- npm 落库核验：`0.11.0` 已是 latest，`gitHead` `bc385fdd326f2b41c08e68cbe6a063baee3448ec` 与 tag 一致。
- 遗留：本机 Pi 需 reload 才加载 0.11.0。

## 对 byissue/ 的影响

- spec 已同步（见上）；ff 099 作为历史记录保留原样，两者关系在 spec:19 里写明。
- 无 decision 需改：099 是 `type: ff`，不是 decision。
