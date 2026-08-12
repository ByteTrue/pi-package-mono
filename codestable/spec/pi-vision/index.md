# pi-vision

## 这一层是什么

`@bytetrue/pi-vision` 让一个**没有视觉能力**的主力模型（如 DeepSeek、`qwen3.7-max`）也能“看图”：既可由 `image_ask(paths, question)` 把本地图片交给已配置的视觉模型，也可显式开启附件自动预分析，让首轮主模型调用直接拿到视觉模型的文本结论。

Peer：`@earendil-works/pi-coding-agent` `>=0.79.10`；零 runtime 依赖。npm `latest`：`0.2.1`。

## 起点：用户诉求 vs 业界直觉

用户最初的诉求是"前端截图发给 agent 让它修 bug，但主力模型看不到图"，猜测业界做法是"弄个 MCP 路由到能识图的模型"。讨论中这条路被否掉：**非视觉模型不知道有图存在，它连图被丢掉了都不知道**，纯 MCP 工具方案要求模型"自己想起来该看图"，在粘贴截图这个场景里从一开始就不成立；而 MCP server 也拿不到"当前模型支不支持图片"这个信息。真正需要的是在图片进模型之前拦截、改写——这是 Pi 扩展的钩子能做、MCP 做不到的事。

## 已核实且决定了设计形状的 Pi 行为

- **Pi 的 ctrl+v 粘贴图片自己就落盘**：`interactive-mode.js` 的 `handleClipboardPaste` 把图写到 `$TMPDIR/pi-clipboard-<uuid>.<ext>`，再把路径当普通文本插入输入框（源码注释原话："Images are attached by path"）。
- **`input` 事件的 `event.images` 只有三个产地**：`pi -p @file.png`、TUI 启动参数、RPC——**都不是** TUI 交互期的 `onSubmit`。也就是说本包最初设想的"拦截粘贴图片"的 `input` hook 是死代码：三条来路（粘贴图片、粘贴路径、agent 自己截图）在 Pi 里其实是同一条，都以文件路径的文本形式进 agent。
- **`read` 工具已有降级但会导致模型幻觉**：模型不支持图片时，`read` 丢弃图片只回一句 `[Current model does not support images. The image will be omitted from this request.]`（`core/tools/read.js`）。真实测得的后果不是"模型说看不到"，而是**模型直接编造图片内容**（同一张 Pi 截图被说成 macOS VoiceOver 设置界面）——这条提示完全拦不住模型瞎编，是本包要堵的真正漏洞。

## 它负责什么

- **`image_ask(paths, question)`**：多图（顺序保留，前端"设计稿 vs 实际渲染"对比是刚需，`UserMessage.content` 本来就是数组，零额外代码）。三个错误闸门——模型未配置 / 凭据不可用 / 图片读不出——均在任何网络调用之前触发，不静默用假描述兜底。
- **按当前模型能力门控**：`session_start` 与 `model_select` 根据 `ctx.model.input` 同步 `image_ask` active tool；视觉模型移除它，非视觉模型恢复它，执行路径另有 guard 防止旧 prompt 或竞态调用。
- **`tool_result` hook**：agent 撞上 `read` 那句"看不到图"的提示时，追加一句"改用 image_ask"的引导，不改原文、不碰 image part。当前模型本身支持图片时不介入（该提示压根不会出现）。
- **附件自动预分析**：`/vision auto on` 明确开启后，text-only 主模型收到 `before_agent_start.images` 时，在首轮主模型调用前把整批附件和当前请求交给所选视觉模型；最多 4 张、解码后总计 20 MiB、固定 60 秒 deadline。成功与失败都注入隐藏上下文，失败明确禁止主模型假装看过图。视觉主模型不触发；未信任 project 配置不能开启外发。
- **`/vision`**：列出 `models.json` 里 `input` 含 `image` 的模型，`ctx.ui.select` 选一个，或用 `auto on|off` 切换自动附件分析；原子写入 `pi-vision` 配置，保留其它字段与文件权限；写完重读一次生效值，被 project 级 settings 覆盖时警告而不是无声失败。

## 它不负责什么

- **没有默认视觉模型**。故意的：自动挑"第一个支持图片的模型"会悄悄选中一个可能很贵的模型；未配置时报错并列出候选，而不是替用户做主。
- **没有独立 provider 配置**。视觉模型是普通 chat 模型，凭据全走用户已有的 `models.json`；这也是它和 `pi-image-gen` 的本质区别——生图（text→image）在 Pi 模型体系**外**必须自建 provider 配置，识图（image→text）在体系**内**不需要。
- **不做 `input` hook，也不自动处理 TUI 粘贴落盘后的路径文本**：该 hook 对交互粘贴是死路；自动模式只处理 Pi 明确交给 `before_agent_start.images` 的附件。
- **不收 http(s) URL**：`image_ask` 只收本地路径，自动模式只收 Pi 已附带的 image content；需要网络图片时模型先用其它工具下载。

## 统一语言

- **vision-capable model**：`models.json` 里 `input` 数组包含 `"image"` 的模型；`pi --list-models` 的 `images` 列显示 `yes`。
- **配置项 `pi-vision.model`**：`settings.json` 里 `"provider/model-id"` 形式的字符串，决定 `image_ask` 与自动预分析调用哪个视觉模型。
- **配置项 `pi-vision.autoAnalyzeAttachments`**：布尔值；默认 `false`，只有显式开启才会把附件和当前请求发送给另一个 provider。project 层仅在 Pi 标记为 trusted 时参与覆盖，无效高优先级配置 fail closed。

## 使用路径

| 想完成的事 | 入口 |
|---|---|
| 选/换委托用的视觉模型 | `/vision` |
| 手动配置，不走菜单 | `settings.json` 的 `{ "pi-vision": { "model": "provider/model-id" } }` |
| 让 text-only 主模型自动获得本轮附件分析 | `/vision auto on`；关闭用 `/vision auto off` |
| 问一张或几张本地图片 | agent 自己调 `image_ask(paths, question)`，不需要用户显式要求 |
| 当前模型本身能看图 | `image_ask` 不出现在 active tools；`read` 与本包均不介入 |
| 发 npm 版 | push tag `pi-vision-v<version>`，由 repo `release.yml` + npm Trusted Publishing 自动发布 |

## 架构考量

- **不做自己的 TUI 组件**：`/vision` 用 Pi 官方的 `ctx.ui.select`，不像 `pi-vendor` 那样自研分页 `SelectList`；当前候选数量下够用，真撞到模型多到撑爆屏幕再升级。
- **配置写入不经 Pi 的 `SettingsManager`**：`Settings` 是封闭 interface 塞不下扩展字段，带 lockfile 的 `FileSettingsStorage` 也未从主入口导出；本包自己做 tmp+rename 原子写，保留原文件的字段与权限，JSON 损坏时拒绝覆盖。无锁的极小并发窗口（用户敲 `/vision` 与 Pi 自身同时写 settings）已知且接受，真观察到冲突再补锁。
- **错误一律 `throw new Error`，不用 `AgentToolResult.isError`/`usage`**：这两个字段在 Pi 0.79.10（本 monorepo 声明的 peerDependency 下界）不存在，0.83 才有；沿用 `throw` 与 `pi-background-terminal` 的既有做法一致，且跨声明的版本范围可用。
- **`sniffMime` 从 `pi-image-gen` 复制而非共享依赖**：遵守"四包互不依赖"的既有架构约定；复制时删掉本包用不到的 URL 下载、data-uri 解析。

## 当前边界

**做**
- `image_ask` 多图问答，三闸门错误优先于网络调用
- `read` 撞墙时的一次性文字引导
- `/vision` 零学习成本配置，安全写 settings.json；`auto on|off` 显式控制附件外发
- text-only 主模型的 opt-in 批量附件预分析，含数量/总字节/deadline/trust 边界
- 按当前模型图片能力动态启停 `image_ask`，视觉模型不暴露代理工具

**不做**
- input hook、落盘、清理（Pi 自身已处理）
- 独立 provider 配置、http(s) URL 输入
- 自动挑默认视觉模型

## 证据索引（按需）

- 包 README：`packages/pi-vision/README.md`
- 入口：`packages/pi-vision/src/index.ts`
- 模型解析与配置读写：`packages/pi-vision/src/vision-model.ts`
- 讨论记录：本 spec 无独立 talk，结论收敛在 `codestable/issues/040-x-vision-package.md` 的「背景与证据」
- Pi 落盘/`images` 产地事实：`codestable/notes/007-pi-clipboard-image-paths.md`
- 当前实现与全部验证证据：`codestable/issues/040-x-vision-package.md`
- 当前模型能力门控实现与验证：`codestable/issues/041-x-pi-vision-tool-capability-gate.md`
- 附件自动预分析实现与验证：`packages/pi-vision/src/auto-analyze.ts`、`packages/pi-vision/src/auto-analyze.test.ts`
- 自动发布工作流与 `0.2.0` 发布证据：`.github/workflows/release.yml`、`codestable/issues/040-x-vision-package.md`
