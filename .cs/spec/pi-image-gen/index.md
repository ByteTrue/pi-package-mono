# pi-image-gen

## 这一层是什么

`@bytetrue/pi-image-gen` 是低频图像生成包，刻意分成两个表面：

- 人类通过 `/image-gen` 在 Pi TUI 内完整配置；
- Agent 只在真正生成或编辑图片时加载 `pi-image-gen` Skill，并通过 bash 调 bundled CLI。

package 不注册常驻 Agent tool。

## 它负责什么

- `/image-gen` 一次配置 built-in 或 custom provider/model、base URL、credential、headers、output directory。
- 配置始终写 Pi `settings.json` 的 `pi-image-gen` 节；支持 active global 与可信 project 两层。
- literal key 使用遮罩输入；也支持标准 env、任意 `$ENV_VAR` 和无 key 本地 route。
- TUI 选择 `No API key` / `No extra headers` 时分别持久化 `apiKey: ""` / `headers: {}` tombstone，以显式阻断 lower layer 与标准 env fallback。
- 已损坏或嵌套 shape 非法的 settings runtime fail-soft 为无配置；交互写入 fail-closed，绝不覆盖原文件。
- Skill wrapper 把一个 stdin JSON request 交给 `dist/cli.js`；CLI 固定使用 settings 的 `defaultModel`，不接受 model override。
- extension、CLI 和 tests 共用同一 model resolution、provider adapter、图片输入与落盘 core。
- custom provider id 不得与 `openai`、`gemini`、`dashscope`、`ark`、`openrouter` 五个 built-in routing prefix 冲突。
- 支持 OpenAI、Gemini、DashScope、Ark、OpenRouter 五种真实 wire protocol。

## 配置与信任边界

读取顺序：

1. `~/.pi/agent/settings.json`；
2. `$PI_CODING_AGENT_DIR/settings.json` 或 `$PI_AGENT_HOME/settings.json`；
3. 仅在运行中 Pi 对 exact canonical cwd 判定 trusted 时合并 `<cwd>/.pi/settings.json`。

extension 在 `session_start` 把 `ctx.isProjectTrusted()` 绑定 cwd 后传给它启动的 Skill CLI。CLI 独立运行时默认不读取 project 层。该边界防止普通 Skill 路径把 global/env credential 发送到未受信 project 覆盖的 endpoint；它不是对主动篡改 shell invocation 的沙箱承诺。

写入使用随机临时文件、`wx`、`0600` 与 atomic rename；malformed settings fail closed；保留其它 top-level key 和同节未修改字段。取消为零写入。

## CLI 契约

stdin：一个不超过 1 MiB 的 JSON object：

```ts
{
  prompt: string;
  image?: string[];
  n?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  size?: string;
  filename?: string;
  outputDir?: string;
}
```

- 未知字段拒绝。
- stdout 成功时只返回 generated file 的 markdown 与非敏感元数据。
- stderr 失败且退出非零。
- settings literal、解析后的标准/自定义 env credential、credential header 值不得出现在 stdout/stderr；上游 revised prompt 同样经过遮罩。
- `--list` 只显示 route、output directory 与 credential 是否存在，不显示值。

## 它不负责什么

- 不注册 `image_generate` 或其它 Agent tool。
- 不提供 CLI model override。
- 不做 provider/model discovery。
- 不新增 wire protocol。
- 不把配置迁移到独立 JSON、env-only 或 CLI-only。
- 不让 Skill/CLI 取代 TUI 配置面。

## 关键考量

- **低频能力按需加载**：避免每轮携带 tool schema。
- **安装后自描述**：用户无需读 GitHub 或手改 JSON，即可在 `/image-gen` 配到可用。
- **单一 core**：构建 `dist` 是为了让 extension 与 Skill CLI 共享生产实现，不复制 provider 逻辑。
- **keyless 是真实 route**：本地或自托管 endpoint 可不带 auth；空 credential/header tombstone 阻断 lower layer 与 env fallback，五种 adapter 都只在最终 route 确有 credential 时发送 auth header。
- **归因保留**：fork 的 Apache-2.0 `LICENSE` / `NOTICE` 随包发布。

## 验证

```bash
npm --workspace @bytetrue/pi-image-gen test
npm --workspace @bytetrue/pi-image-gen run typecheck
node packages/pi-image-gen/scripts/pack-smoke.mjs
```

pack smoke 必须证明 tarball 含 extension、Skill、wrapper、CLI dist；packed extension 注册 `/image-gen` 且零 tools；解包 CLI 可执行。

## 证据索引

- 包 README：`packages/pi-image-gen/README.md`
- 已关闭 agent surface 变更：`.cs/epics/004-x-image-gen-web-agent-surface/spec.md`
- License：`packages/pi-image-gen/LICENSE`、`packages/pi-image-gen/NOTICE`
