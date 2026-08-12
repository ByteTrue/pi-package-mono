---
kind: issue
title: "pi-vision：让无视觉能力的模型通过 image_ask 读图"
type: feature
status: closed
created: 2026-08-02
epic: ""
---

# pi-vision：让无视觉能力的模型通过 image_ask 读图

## 目标

用户主力模型没有视觉能力（如 `bytetrueapi/qwen3.7-max`，`images: no`）时，仍能完成"把前端截图发给 agent 让它修 bug"这类工作：agent 用 `image_ask(paths, question)` 把图交给一个**有**视觉能力的模型（`bytetrueapi/qwen3.7-plus`），拿回文本答案继续干活。

当前模型本身支持图片时，本扩展完全不介入。

## 范围

- 包含：新包 `@bytetrue/pi-vision` = 一个工具 `image_ask`（支持多图）+ 一个 `tool_result` 兜底 hook + 一行 setting + 一个 `/vision` 配置菜单。
- 不包含：
  - `input` 事件 hook（**经查证是死代码**，见下文"现状如何工作"）
  - `pi -p @shot.png` / TUI 启动参数 / RPC 三条 `images` 通路（真需要时再加，加法已知）
  - 独立 provider 配置、图片落盘与清理（Pi 自己已做）
  - http(s) URL 输入（先只收本地路径；模型可先用 `web_fetch` / `bash curl` 落地）
  - `/vision` 不写 project 级 settings、不选 scope、不管理 provider/apiKey；只写 `pi-vision.model` 一个字段

> **范围变更（2026-08-02，用户提出）**：原本"不做 `/vision` 命令"是我提的排除项，用户驳回："不然用户都不知道配置文件加啥字段"。实测印证了这个判断：没有菜单时，用户唯一的引导是工具报错里那段 JSON 示例——而那段只有在他**已经试用并失败**之后才看得到。

## 归属

- 独立 issue。
- 相关 spec：`codestable/spec/index.md`（能力地图需新增一行）
- 讨论：本 issue 背景章节即讨论结论，未另立 talk（四轮收敛，结论无外溢）

## 背景与证据

用户原始诉求：使用无视觉能力的模型（DeepSeek V4 PRO）时，"前端有问题，图片发给他，让他修 bug"做不到；模型的实际反应是**直接说自己看不到**，不报错。用户猜测业界做法是"弄个 MCP 路由到能识图的模型"。

讨论中方案被砍了两轮，每轮都因为一个查证到的事实：

**第一轮砍掉 MCP。** 非视觉模型不知道有图存在 —— 它连图被丢掉了都不知道，所以纯工具方案要求模型"自己想起来该看图"这一点在粘贴截图的场景里不成立。而 MCP server 既拿不到粘贴的图片，也拿不到"当前模型支不支持图片"，只能被动接受一个路径。Pi 扩展能做 MCP 做不到的事（在图进模型前改写），所以载体选 Pi 扩展。

**第二轮砍掉 input hook（用户提出的质疑，查证后用户正确）。** 我原本设计 `input` hook 拦 `event.images`、落盘、transform。用户指出他在 Pi TUI 里粘贴图片看到的**已经是路径形式**，怀疑 Pi 自己就落盘了。核实 `dist/modes/interactive/interactive-mode.js:2076-2103`：

```js
// Handle clipboard paste (triggered on Ctrl+V). Images are attached by path;
// otherwise, paste plain text from the system clipboard.
async handleClipboardPaste() {
    const image = await readClipboardImage();
    if (image) {
        const filePath = path.join(os.tmpdir(), `pi-clipboard-${crypto.randomUUID()}.${ext}`);
        fs.writeFileSync(filePath, Buffer.from(image.bytes));
        this.editor.insertTextAtCursor?.(filePath);   // ← 插入的是路径文本
```

Pi 的 ctrl+v **自己就落盘**到 `$TMPDIR/pi-clipboard-<uuid>.png`，再把路径当普通文本插进输入框。注释是 Pi 自己写的：`Images are attached by path`。

进一步查 `images` 的全部产地，只有三处，**全都不是 TUI 交互输入**：`print-mode.js:95`（`pi -p @shot.png`）、`interactive-mode.js:632`（TUI 启动参数）、`rpc-mode.js:303`（RPC）。TUI 里敲字提交（`onSubmit`）永远不带 `images`。

结论：input hook 在目标场景里是死代码，且落盘代码、清理策略全部不需要写。

**用户已确认的取舍**：

1. `image_ask` **不自动描述** —— 由 agent 自己提问，而不是在 hook 里替它问一遍。理由：用户粘图时说的是"这个按钮位置不对"，agent 真正需要问的是"按钮相对容器的对齐和间距是多少"；提问的人应该是要用答案的那个。代价是多一轮往返，用户判断对前端 bug 划算。
2. **支持多图**。不是加功能：`UserMessage.content` 本来就是 `(TextContent | ImageContent)[]`，多图零额外代码；而"设计稿 vs 实际渲染"的对比在前端场景是刚需。
3. 包名 `@bytetrue/pi-vision` —— 说能力，不说实现。

**已核实的技术事实**：

- Pi 模型配置有 `input: ("text" | "image")[]`（`docs/models.md:206`）；`pi --list-models` 直接列 images yes/no。用户环境：`bytetrueapi/qwen3.7-plus` = yes，`bytetrueapi/qwen3.7-max` = no。
- 内建 `read` 读图时已有降级：模型不支持图片则**丢弃图片**，只回 `[Current model does not support images. The image will be omitted from this request.]`（`dist/core/tools/read.js:44-50`，函数 `getNonVisionImageNote`）。这是 hook 的锚点字符串。
- 扩展调另一个模型是一等公民：`getModel`/`complete` from `@earendil-works/pi-ai/compat` + `ctx.modelRegistry.getApiKeyAndHeaders(model)`（`examples/extensions/summarize.ts` 完整示范）。
- `ctx.modelRegistry`（`dist/core/model-registry.d.ts`）提供 `find(provider, modelId)`、`getAvailable()`、`getApiKeyAndHeaders()`。**必须走 registry 而不是 `getModel()`**：用户的 `bytetrueapi` 是 models.json 里的自定义 provider，不在 Pi 内置 catalog 里。
- `AgentToolResult.usage?: Usage`（`pi-agent-core/dist/types.d.ts:310-324`）→ 嵌套模型的 token 消耗可以如实上报，成本可见性免费。
- `ImageContent = { type: "image", data: string /* base64 */, mimeType: string }`（`pi-ai/dist/types.d.ts:248`）。
- Pi 的 `processImage` / `detectSupportedImageMimeTypeFromFile` **没有从主入口导出**，不可静态 import（见 `codestable/notes/005`，import 不存在的符号是 link-time 错误，会让整个扩展加载失败）。自己做 magic-byte 嗅探。

## 现状如何工作

```
用户 ctrl+v 粘贴截图
  → Pi handleClipboardPaste 写 $TMPDIR/pi-clipboard-<uuid>.png，把路径插入输入框
  → 提交：一段含路径的纯文本，images 为空
  → 非视觉模型看到路径，调 read
  → read 检测到是图片 + 当前模型 input 不含 image
  → 图片被丢弃，模型只收到 "[Current model does not support images…]"
  → 模型告诉用户"我看不到"   ← 现在卡在这里
```

三条来路（粘贴图片、粘贴路径、agent 自己截图）在 Pi 里其实是**同一条**：都以文件路径的文本形式进 agent。

## 影响范围

- **必须新增**：`packages/pi-vision/`（package.json、tsconfig.json、README.md、`src/index.ts`、`src/image-ask.ts`、`src/vision-model.ts`、`src/image-file.ts`）
- **需要验证**：非视觉模型下 `read` 图片撞墙后能被引导到 `image_ask`；视觉模型下本扩展零介入（`read` 行为不变）；`image_ask` 在模型未配置 / 无 key / 超时 / 文件不存在 / 非图片文件时给出可行动的错误而不是崩溃
- **不碰**：任何 Pi 原生工具的注册与行为；其他三个 workspace 包（`codestable/spec/index.md` 的"四包互不依赖"约定继续成立，`sniffMime` 从 `pi-image-gen` **复制**约 30 行而非跨包依赖）

## 质量目标

- **功能正确性**：`image_ask` 返回的答案来自真实的视觉模型调用；视觉模型未配置或凭据缺失时明确报错，**绝不**静默退化成"编一段描述"。证据：单测覆盖模型解析失败 / auth 失败 / 上游失败三条路径；真实 Pi 回归用一张真截图核对答案与图内容一致。
- **信息安全性（Security）**：错误消息与工具输出不得包含 apiKey、resolved 凭据或 Authorization 头内容（继承 `codestable/spec/pi-vendor/index.md` 已有的凭据不外泄约定）。证据：单测断言错误文本不含注入的假 key；错误消息只来自本包常量 + 上游 status code。
- **兼容性 / 隔离性**：不注册同名覆盖任何 Pi 原生工具；当前模型支持图片时 `read` 行为与未装本扩展时完全一致。证据：`index.test.ts` 锁定只注册 `image_ask` 一个工具；hook 在 `model.input.includes("image")` 时直通的单测。
- **可维护性 / 可测试性**：视觉模型解析、图片读取、上游调用三者可独立测试，不需要真实网络。证据：`complete` 以参数注入，单测传假实现。

## 方案判断

- **不做 input hook** —— 上面已证明是死代码。这是本次最大的"少写"。
- **`tool_result` hook 留着**（约 10 行字符串替换）：agent 有 `read` 的肌肉记忆，撞墙时得有人告诉它往哪走。这是唯一覆盖该习惯的兜底，也是唯一让"零学习成本"成立的部件。
- **不做独立 provider 配置**：视觉模型是普通 chat 模型，本来就在 `models.json` 里。这也是它不该塞进 `pi-image-gen` 的理由 —— 生图是 text→image 且在 Pi 模型体系**外**（所以那个包必须自建 provider 配置），识图是 image→text 且在体系**内**。
- **缺省零配置**：没配 setting 就自动挑第一个 `getAvailable()` 里 `input.includes("image")` 的模型。有多个视觉模型且成本差异大时用户再配。
- **`sniffMime` 复制不复用**：`pi-image-gen/src/image-input.ts` 已有一份（PNG/JPEG/GIF/WebP magic bytes），但 project spec 的"四包互不依赖"是有意的架构约定；为 30 行代码破约或抽第三个共享包都更贵。复制时删掉本包不需要的 URL 下载、data-uri、base64 分类。

## 实现设计

### 这次要怎么做

```
src/vision-model.ts   读/写 setting、解析模型与 auth
src/image-file.ts     路径 → { data: base64, mimeType }（magic-byte 嗅探，非图片报错）
src/image-ask.ts      registerTool("image_ask")：读图 → complete() → 文本
src/vision-command.ts registerCommand("vision")：列视觉模型 → ctx.ui.select → 原子写 settings
src/index.ts          注册工具 + 命令 + tool_result 兜底 hook
```

### 请求 / 数据 / 调用怎么走

```
image_ask({ paths: string[], question: string })
  → resolveVisionModel(ctx)                    // 失败 → isError，消息告诉用户去配哪个 setting
  → paths.map(readImageFile)                   // 失败 → isError，指明哪个路径 + 为什么
  → ctx.modelRegistry.getApiKeyAndHeaders(m)   // ok:false → isError（不回显 error 里的凭据）
  → complete(model, { messages: [{ role:"user", content:[...images, {type:"text",text:question}] }] },
             { apiKey, headers, env, signal })
  → { content:[{type:"text",text:answer}], details:{ model, imageCount }, usage }
```

### 哪些边界不碰

- 不改 `read`、不覆盖任何原生工具、不注册命令、不写任何图片文件
- 不缓存（同一张图问两次就调两次；缓存等真实观察到浪费再说）

### 质量目标如何落实

- 三个错误闸门（模型解析 / 文件读取 / auth）都在**任何**网络调用之前，任一失败即 `isError` 返回
- `complete` 通过参数注入，单测不碰网络
- 错误消息只用本包常量拼装；auth 失败时只说"provider 凭据不可用"，不透传 `ResolvedRequestAuth.error` 原文（该字段可能含配置细节）

### 一步步怎么改

1. 建包骨架（package.json / tsconfig / README），照 `pi-background-terminal` 的形状
2. `image-file.ts` + 单测（magic bytes、非图片、不存在、相对路径按 `ctx.cwd` 解析）
3. `vision-model.ts` + 单测（setting 命中 / setting 指向不存在的模型 / 缺省自动挑 / 一个视觉模型都没有）
4. `image-ask.ts` + 单测（成功、三条错误闸门、usage 透传、多图顺序）
5. `index.ts` + hook + 单测（只注册一个工具；hook 命中锚点字符串时替换；模型支持图片时直通）
6. typecheck + test + `npm pack --dry-run`
7. 真实 Pi 回归

### 怎么确认做对

见"验证"。

## 验证

### 单测（40 条，`npm --workspace @bytetrue/pi-vision test`）

- `image-file.test.ts`（12）：四种格式 magic byte；RIFF/WAVE 不被误判成 WebP；纯文本拒绝；扩展名说谎时按文件头判定（`actually-a-png.jpg` → `image/png`）；相对路径按 cwd 解析；缺失文件报出解析后的绝对路径；目录拒绝；URL 拒绝并提示先下载；空路径拒绝；超 20MB 在读取前拒绝。
- `vision-model.test.ts`（12）：global / project settings 分层（project 胜出）；未配置返回 undefined；settings.json 损坏时不抛异常；配置命中并带出 auth；model id 内含 `/`（`vendor/minimaxai/minimax-m3`）解析正确；**未配置时不自动挑模型**而是列候选；一个视觉模型都没有时明说；缺 provider 前缀 / 不在 models.json / 配了非视觉模型三种拒绝；registry auth 错误原文（含 `$SECRET_TOKEN`）不外泄。
- `image-ask.test.ts`（11）：图片在前、问题在后的 content 顺序；多图保序；abort signal 透传；空 paths / 空 question 拒绝且不发请求；未配置模型 / 凭据不可用 / 图片读不出三条闸门均在**任何网络调用之前**返回（断言 `complete` 未被调用）；上游 error 响应上报；上游 error **回显 apiKey 时改为拒绝回显**（响应体与 throw 两条路径各一条）；空答案不静默返回。
- `index.test.ts`（5）：只注册 `image_ask` 一个工具、只挂 `tool_result` 一个 hook、零命令；命中 non-vision note 时追加引导且保留原文与 image part、不就地改 event；模型支持图片时直通（返回 undefined）；非 `read` 工具不介入；read input 不可用时退化为占位路径。

### 变异验证（确认非空测）

| 变异 | 结果 |
|---|---|
| 删掉 `safeUpstreamMessage` 的 apiKey 回显检查 | 2 条失败 |
| 把 `NON_VISION_MARKER` 改成不可能匹配的串 | 1 条失败 |
| 给 `resolveVisionModel` 加"自动挑第一个视觉模型"的 fallback | 1 条失败 |

三处还原后 40 条全绿。

### 真实 Pi 0.83.0 回归

环境：`/tmp/pi-vision-e2e`，`<cwd>/.pi/settings.json` 配 `bytetrueapi/qwen3.7-plus`（**不写用户的 `~/.pi/agent/settings.json`**）；主驱动模型 `bytetrueapi/qwen3.7-max`（`images: no`）；测试图 = Pi 自己的 `docs/images/interactive-mode.png`（内容可独立核对）。

1. **Baseline（不装本扩展）**：非视觉模型被问"这张图是什么应用" → 回答 **macOS System Settings → Accessibility → VoiceOver**，还列了一整套并不存在的 Verbosity / Audio / Voice / Quick Nav 小节。**不是"我看不到"，是编了一整段细节。**这比用户描述的症状更糟，也说明 Pi 那句 `[Current model does not support images…]` 并不能阻止模型瞎编。
2. **主路径（装扩展）**：同一模型同一问题 → 准确答出 **Pi v0.49.3 的 TUI**、pi-mono 项目、快捷键面板、"hi" 对话、状态栏 `gpt-5.2-codex` 与 `$0.009`。JSON 事件流确认走的是 `image_ask({paths:["./shot.png"], question:"What application is shown in this screenshot?"})` —— 问题由 agent 自己生成，验证了"不自动描述"的设计。
3. **`read` 兜底 hook**：强制 `--tools read` 让它先 read → 工具结果实测为 `Read image file [image/png]\n[Image: original 1726x2162…]\n[Current model does not support images…]\nTo actually see it, call image_ask with paths: ["./shot.png"] and a specific question.`，原文与 image part 均保留。
4. **零介入**：把主模型换成视觉模型 `qwen3.7-plus` 再 read → 结果**不含** image_ask 提示（`contains image_ask hint: false`），模型直接看图作答正确。
5. **多图**：一次 `image_ask({paths:["./shot.png","./other.png"]})`（第二张换成 `docs/images/tree-view.png`）→ 正确指出一张是启动帮助面板、另一张是会话树对话历史。两张图真的进了同一次调用。
6. **错误路径**：换到未配置的 cwd → `isError: true`，输出两个可写入的 settings 路径 + 13 个候选模型（含 `bytetrueapi/minimaxai/minimax-m3` 这个 id 内含斜杠的），无任何凭据字样。顺带印证了不做自动 fallback 的价值：列表里排第一的是 `claude-haiku-4-5`，自动挑就会悄悄用上 Claude。
7. **发布形态反验**：`npm pack` 出 tarball 解压到 `/tmp/pi-vision-pack/package`（上方没有 workspace `node_modules`）后 `pi -e` 加载 → 正常工作。证明 `@earendil-works/pi-ai/compat` 在真实安装位置解析到 Pi 自带的 0.83 而非 workspace 的 0.79.10。

### `/vision` 配置菜单（第二轮追加）

单测 `vision-command.test.ts`（8 条，均跑在**真实临时文件系统**上，不 mock fs）：只列 `images: yes` 的模型；标题显示当前值 / "not set yet"；选中后写入且 notify；取消时不写；**保留其它 settings 字段与 0600 权限**；保留 `pi-vision` 节内的其它 key；**settings.json 损坏时拒绝覆盖（断言文件字节不变）**；project 级覆盖时发 warning；无视觉模型时不弹菜单也不建文件。

变异验证：

| 变异 | 结果 |
|---|---|
| 损坏 JSON 时不再拒绝，当作空对象 | 1 条失败 |
| 不合并旧 settings，直接覆盖 | 2 条失败 |
| 跳过 project 覆盖检查 | 1 条失败 |

真实 Pi 0.83 命令注册验证：临时 probe 扩展调 `pi.getCommands()` → `["vision: Choose which vision model image_ask uses", "llama: …"]`。TUI 弹窗本身是 Pi 官方 `ctx.ui.select`，未做人工目测（print 模式 `hasUI` 为 false，交互弹窗无法在非交互回归里验证）。

### 其他

- `tsc --noEmit` 干净；全 workspace `npm test` = 424 passed / 9 skipped（本包 48）。
- `npm pack --dry-run` 7 个文件（5 个源码 + README + package.json），测试与 `test-helpers.ts` 未泄漏。

## 执行记录

- 按设计实现四个源文件，无偏差。范围未暗扩：没写 input hook、没写落盘、没写清理、没加 provider 配置、没加命令。
- **`AgentToolResult` 的 `usage` 与 `isError` 字段在 workspace 的 Pi 0.79.10 里不存在**（0.83 才有）。原设计想用 `usage` 上报嵌套模型 token（背景里写过"成本可见性免费"），实测不免费——要么抬 peerDependency 下界，要么放弃。选择**放弃 usage**，错误改用 `throw new Error(...)`，与同仓 `pi-background-terminal` 的既有做法一致，且跨版本可用。代码因此更短。
- 顺带删掉了自己刚写的 `ImageFileError` 类：改用 throw 之后不再需要区分错误来源，`image-ask.ts` 里那个 catch/rethrow 也一起消失。
- `@earendil-works/pi-ai/compat` 的 doc comment 自称临时（"deleted with the coding-agent ModelManager migration"），但它是 Pi 官方 `examples/extensions/summarize.ts` 用的入口，也是唯一暴露 `complete()` 的地方。已按约定打 `ponytail:` 注释标明天花板与升级路径。`complete` 同时以参数注入，单测因此完全不碰网络。
- `sniffMime` 从 `pi-image-gen/src/image-input.ts` 复制约 30 行而非跨包依赖，遵守 project spec 的"包互不依赖"约定；复制时删掉了本包用不到的 URL 下载、data-uri 解析和 `classifyImageOutput`。

### 第二轮：`/vision` 菜单

- 用 Pi 官方的 `ctx.ui.select(title, string[])`，**没有**拄 `pi-vendor` 那套自研分页 `SelectList`（`quick-adapter.ts`，60+ 行 + `@earendil-works/pi-tui` peer 依赖）。Pi 的 `ExtensionSelectorComponent` 确实不分页，但当前 13 个候选模型展开约 20 行，够用；真撞到模型多到撑爆屏幕再换。
- **不用 Pi 的 `SettingsManager` 写**：它的 `Settings` 是封闭 interface，没有扩展命名空间的位置；`FileSettingsStorage`（带 lockfile 的那个）**未从主入口导出**。自己写 tmp+rename 原子写，保留原文件 mode（用户的 settings.json 是 0600）。无锁的天花板已打 `ponytail:` 注释。
- 只写 global scope，不让用户选 scope（多一步）。但写完会**重读一次生效值**，被 project 级覆盖就发 warning——否则“存了但没生效”是个无声陷阱。
- 顺手把自己第一轮重复写两遍的 agentDir 拼接收成 `globalSettingsPath()` / `projectSettingsPath()`；未配置时的错误文案现在首先说 "Run /vision to pick one"。

## 顺手发现

- Baseline 那轮暴露了一个比本 issue 目标更广的事实：Pi 现有的 `[Current model does not support images…]` 提示**完全拦不住模型编造图片内容**。本包在 `read` 那条路上顺手堵了这个洞（引导到 image_ask），但如果哪天模型绕过 `read` 直接凭文件名猜，仍会瞎编 —— 已在 `image_ask` 的 promptGuidelines 里写了"不要凭文件名猜图片内容"。不另开 issue。
- **写本节时实测到自己的 hook 有真实误报**：因为本 issue 文档本身引用了 Pi 那句错误原文作为证据，`read` 这个 issue 文件本身就会触发 `NON_VISION_MARKER` 子串匹配（它并不是图片）。根因是 hook 只按子串匹配，不验证这句话真的来自 Pi 的图片降级逻辑。核实 `read.js` 后确认：真实非视觉 note 永远与 `"Read image file ["` 前缀同处一个 text part。修复为双重匹配（`part.text.startsWith("Read image file [")` 且 `includes(NON_VISION_MARKER)`），新增一条回归测试直接用本 issue 文档引用那句话作为 fixture，确认不再误触发。同时修了一条旧测试的 fixture 缺前缀，修后碰巧也会失败。现在 49 条单测全绿，全 workspace 425 passed / 9 skipped。

## 发布

- 版本 `0.1.0`（npm 首发，不支持 OIDC，手动 `npm publish -w @bytetrue/pi-vision --access public`，用户本机完成 2FA 浏览器授权）。Playwright 确认：npmjs.com 页面显示 `0.1.0`、Public、README 正常渲染；`npm view`/registry API 有几分钟传播延迟（与发布本身无关，同一时间窗 `pi-background-terminal` 的旧查询正常）。
- Trusted Publisher（Playwright 配置，用户完成两次安全密钥/密码二次验证）：`ByteTrue/pi-package-mono` / `release.yml` / Permissions `npm publish`，与其它四包已生效的配置逐字一致（Environment name 留空）。
- Tag `pi-vision-v0.1.0` 推送后触发 `release.yml`（run 30739773091）：typecheck → npm test → OIDC 取得 `NODE_AUTH_TOKEN` → `✓ @bytetrue/pi-vision@0.1.0 already on npm — skipping`，conclusion success。验证了幂等跳过逻辑与 OIDC 信任关系同时生效，后续版本发布（如 `0.2.0`）无需再手动 `npm publish`，只需 bump 版本号 + 打 tag。
- 代码合入主分支：`image-delegation` 分支 fast-forward 到 `main`（`e3c1f82`），无分歧。
- 版本 `0.2.0`：tag `pi-vision-v0.2.0` 触发 `release.yml`（run 30838291139），全 workspace typecheck/test 与 OIDC publish 均成功；registry 已确认 `latest = 0.2.0`。该版本加入按主模型能力门控与 opt-in 附件自动预分析，当前真相见 `codestable/spec/pi-vision/index.md`。

## 关闭回写

- project spec：`codestable/spec/index.md`（能力地图 / 架构落点表 / 阅读路径 / 当前边界均新增 pi-vision；"四包"改"五包"）
- 新建 `codestable/spec/pi-vision/index.md`
- 根 `README.md`：包表格 + 本地开发示例 + test 命令
- notes：`codestable/notes/007-pi-clipboard-image-paths.md`（Pi ctrl+v 自落盘 + `images` 事件只有三个非交互产地）

## 关闭结论

- **关闭判断**：目标达成且范围未暗扩。用户两次明确授权范围变更——第一次确认整体方案（不自动描述、支持多图、包名 `pi-vision`），第二次驳回"不做 `/vision` 命令"的排除项并要求补上，两次变更均已在范围/执行记录中记录理由。
- **验证摘要**（含质量目标证据）：
  - *功能正确性*：49 条单测 + 8 处变异验证均命中；三个错误闸门（模型未配/凭据不可用/图片读不出）均在任何网络调用之前返回；真实 Pi 0.83 回归证实主路径、hook 兜底、零介入、多图、错误引导均真实可用；写作过程中实测到并修复了 hook 的子串匹配误报。
  - *信息安全性*：错误消息与工具输出不含 apiKey/凭据；单测断言回显检测对上游错误文本和传输层 throw 两条路径都生效。
  - *兼容性/隔离性*：只注册 `image_ask` 一个工具与 `vision` 一个命令；模型支持图片时 `read` 行为与未装本扩展时完全一致（单测 + 真实 Pi 回归均确认）。
  - *可维护性/可测试性*：视觉模型解析、图片读取、上游调用三者可独立测试，`complete` 参数注入无需真实网络。
  - 全 workspace 425 passed / 9 skipped（本包 49）；typecheck 干净；`npm pack` 7 个文件无测试泄漏。
- **回写位置**：稳定结论（不自动挑默认模型的理由、`input` hook 是死代码的事实、不用 Pi `SettingsManager` 写的理由、不做自研 TUI 分页的理由）已合入 `codestable/spec/pi-vision/index.md`。Pi 自身行为事实（ctrl+v 自落盘、`images` 产地）单独成 note 供其它包复用。中间过程（四次变异验证、两轮方案反复、自己 hook 的误报发现）留在本 issue，不搜 spec。
- **遗留**：`/vision` 写 settings 无锁，用户手动命令与 Pi 自身写入同时发生的极小窗口会丢一方写入；已打 `ponytail:` 注释标明天花板，真观察到冲突再补锁。首发 npm 版本需手动 `npm publish` 一次（npm Trusted Publishing 不支持首发）——属于正常发布流程，不是缺陷。
