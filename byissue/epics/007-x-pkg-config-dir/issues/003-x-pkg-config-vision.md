---
kind: issue
title: "pi-vision 配置从 Pi settings.json 节抽出为独立文件"
type: refactor
status: closed
created: 2026-09-30
closed: 2026-09-30
---

# pi-vision 配置从 Pi `settings.json` 节抽出为独立文件

> **读者：** 接手配置统一的人——这个包要和 Pi 本体共用的 `settings.json` 解耦；抽节时最容易犯的错是只搬一个键，见「整节迁移」。

## 目标与范围

包含：`packages/pi-vision/src/vision-model.ts` 的路径、读写与提示文案；`vision-command.ts` 的提示；`test-helpers.ts`、`vision-command.test.ts`、`vision-model.test.ts`、`auto-analyze.test.ts` 的隔离方式；README 的配置位置段落。

不包含：视觉模型解析逻辑、候选列表、`image_ask` 行为、`autoAnalyzeAttachments` 的语义。

## 落成的形状

- global 层：`<pkg-config 根>/pi-vision/settings.json`，内容是该包自己的小节**去掉外层键**，即 `{ "model"?: string, "autoAnalyzeAttachments"?: boolean }`（原来是 `settings.json` 的 `"pi-vision": {...}`）。
- project 层：`<project>/.pi/pi-pkg-cfg/pi-vision/settings.json`，同样形状；老项目位置 `<project>/.pi/settings.json` 的节只读回退，**永不写**（项目覆盖本就该压过全局），老节会一直生效到用户手工删除，靠状态输出显示生效路径。
- 老 global 位置：`<agent dir>/settings.json` 的 `pi-vision` 节。
- **整节迁移**：任何读或写 global 层之前，若新文件缺失且老文件里有 `pi-vision` 节，先把该节**整个**写进新文件（含本次要改之外的键），再套本次改动；单次原子写。反例：老节 `{model: X, autoAnalyzeAttachments: true}` 后跑 `/vision auto off`，只搬 `autoAnalyzeAttachments` 会让新文件一存在老节即被跳过，`model: X` 静默消失。
- 老文件坏 JSON / 新文件坏 JSON：写 fail-closed（拒绝覆盖并说明怎么修，文案沿用现有句式），读 fail-soft（该层视为 undefined）。
- 标注：生效的 model / auto 值来自老路径时，`/vision` 的保存提示与「未配置视觉模型」的 `settingsHint` 输出 `legacy (read-only fallback): <path>`。
- 顺手：搬出共享 `settings.json` 后，`writeSetting` 里那条「与 Pi 自己的 `/settings` 写入存在同毫秒覆盖窗口」的 ponytail 注释可以删掉——隐患随迁移消失。

## 验证方式（计划）

- `npm --workspace @bytetrue/pi-vision test` 与 `typecheck`；新增断言：`/vision` 写入落在新文件且 Pi `settings.json` 逐字节未变、老节整节迁移（`model` 不丢）、project 层新文件优先且老项目节只读回退、untrusted project 不读项目层、legacy 标注出现在提示里。
- 真机：`~/.pi/agent/settings.json` 里现有 `pi-vision: {model: "bytetrueapi/glm-5.3-flash"}` 走一遍，确认新文件含该 model、Pi `settings.json` 未动、`image_ask` 仍能用。

## 执行记录

`packages/pi-vision/src/vision-model.ts` 整体重写路径层；`SETTINGS_KEY`/`COMMAND_NAME` 与视觉模型解析逻辑未动。

- 常量 `PKG_CONFIG_DIRNAME="pi-pkg-cfg"`、`PKG_DIRNAME="pi-vision"`、`PKG_FILENAME="settings.json"`；`agentDir()`；`newSettingsPath()`；`legacyGlobalSettingsPath()` = `<agent dir>/settings.json`。
- `settingsLocation(): SettingsLocation`：新文件是 file 即用；老 Pi `settings.json` 不存在 → 新；老文件读不出（坏 JSON / 非对象）→ `{path: legacy, legacy: true}`；无 `pi-vision` 节 → 新；节非对象 → legacy；否则把**整节**（去掉外层键）原子写到 `newSettingsPath()`（`mkdirSync(dir,{recursive:true,mode:0o700})` + temp + `rename`，`mode 0o600`）→ 新。**Pi 的 `settings.json` 永不修改。**
- `globalSettingsPath()` = `settingsLocation().path`；`describeGlobalSettingsPath()` 在 legacy 时输出 `<path> (legacy (read-only fallback))`。
- project 层：`projectSettingsPath(cwd)` = `<cwd>/.pi/pi-pkg-cfg/pi-vision/settings.json`；`projectLocation(cwd)` 自有新文件是 file 即用，否则老 `<cwd>/.pi/settings.json` 存在则 `legacy:true`，**从不写**；`describeProjectSettingsPath(cwd)` 同款标注。
- 读：`readJson()` 用 `pathExists()`（`statSync` 任意成功，老路径存在但不可读时 fail closed）；`readSection(read, legacy)` 只在 legacy 层取外层 `pi-vision` 节，新文件根对象即节本体；`readLayeredValue(cwd, projectTrusted, key)` 逐层 missing 跳过 / invalid 把值置 undefined / 有效则取值，后者压前者。
- 写：`writeSetting(key, value)` 目标恒为 `newSettingsPath()`；新文件已存在 → 读它、保留其它键与既有 mode（`statSync(path).mode & 0o777`）；否则若老 `settings.json` 存在（`pathExists`）就读它把**整节**继承进内存，节非对象则抛 `` `${legacy} has a "pi-vision" key that is not a JSON object. Refusing to overwrite it.` ``；坏 JSON 抛现有句式 `` `${path} is not valid JSON. Fix it first; refusing to overwrite it.` ``。**单次原子写**，没有「先复制再改写」两步。
- `settingsHint(cwd)` 改为 `` `Run /vision to pick one, or set it in ${describeGlobalSettingsPath()} (or ${describeProjectSettingsPath(cwd)}):\n  { "model": "provider/model-id" }` ``（新文件无外层键）。
- 调用方：`vision-command.ts:4,43,87` 的两处覆盖警告改用 `describeProjectSettingsPath(ctx.cwd)`，带 legacy 标注。
- **顺手清掉一个隐患**：搬出共享 `settings.json` 后，原 `writeSetting` 里那条「与 Pi 自己的 `/settings` 写入存在同毫秒覆盖窗口」的 ponytail 注释与风险一并消失（这是 issue 里预判的收益，已兑现）。

**与设计的一处偏差**：`existsSync` 对目录也为真，因此需要区分「新文件存在」（`isFile` → `statSync().isFile()`）与「老路径存在但可能不可读、必须 fail closed」（`pathExists` → `statSync` 任意成功）两种判断，写成两个辅助函数。

## 验证

- `npm --workspace @bytetrue/pi-vision test` —— **6 files / 87 tests 全绿**。新增「新根建不出来时回退老位置并断言 `describeGlobalSettingsPath()` 以 `(legacy (read-only fallback))` 结尾」用例（在 `<agent dir>/pi-pkg-cfg` 位置放普通文件使 `mkdirSync` 失败——四包里此前只有 vision 缺这条）。改写 `test-helpers.ts`（`makeSettingsSandbox` 加 `delete process.env.PI_PKG_CFG_DIR` 并新增新路径/项目层辅助）、`vision-command.test.ts`、`vision-model.test.ts`、`auto-analyze.test.ts`；原「保留 Pi settings 其它键」用例改成语义正确的「新文件只含节本体、Pi `settings.json` 逐字节不变」。
- `npm run typecheck --workspaces --if-present` —— exit 0。
- 真机：`~/.pi/agent/settings.json` 的 `pi-vision: {model: "bytetrueapi/glm-5.3-flash"}` 在首次 `/vision` 后整节迁到 `~/.pi/agent/pi-pkg-cfg/pi-vision/settings.json`（`{ "model": "bytetrueapi/glm-5.3-flash" }`，0600）；`/vision auto on` 写为 `{model, autoAnalyzeAttachments:true}`、`/vision auto off` 回到 `false`，全程 Pi `settings.json` sha256 = `6557eda9...` **未变**，老节仍在（只读回退）。
- **Q25 整节迁移 bug 的真机复现验证**（隔离 `PI_CODING_AGENT_DIR`，预置老节 `{model: X, autoAnalyzeAttachments: true}` + `subagent` 节）：跑 `/vision auto off` 后新文件为 `{"model":"bytetrueapi/glm-5.3-flash","autoAnalyzeAttachments":false}` —— **`model` 未丢**，正是设计要修掉的静默丢数据场景。代码侧对应 `readAutoAnalyzeAttachments` 用 `readLayeredValue(...) === true`（absent 即 false）。
- 降级：发布版 `pi-vision@0.2.3` 在隔离沙箱里 `/vision` 仍显示老节的 `bytetrueapi/glm-5.3-flash`。

## 关闭结论

- **判断**：pi-vision 从 Pi `settings.json` 的 `pi-vision` 节抽出为 `<pkg-config 根>/pi-vision/settings.json`（global 可写 + 可信 project 只读覆盖），共享 `settings.json` 的并发写窗口消失。无遗留。
- **验证**：6 files / 87 tests 全绿（含新增「新根建不出来 → 回退 legacy」用例）；Q25 整节迁移真机复现——`/vision auto off` 后 `model` 未丢；发布版 0.2.3 降级仍读老节。
- **回写**：`byissue/spec/pi-vision/index.md` 与 `byissue/spec/index.md`（issue 005 已改）。
- **遗留**：无。

## 发布记录（2026-09-30）

- 与 issue 001/002/004 一起，随提交 `4dbaba7` 发布：`0.2.3` → `0.3.0`。
- tag `pi-vision-v0.3.0` 触发 release.yml 运行 `36689084473`：**第一次 attempt 失败**，原因是 `packages/pi-background-terminal/src/background-command.test.ts > lists a running command, opens its output, then returns through the menus` 一处断言失败（`expected "vi.fn()" to be called with arguments: [ StringContaining "Output", …(1) ]`）——该包属本次未改动的既有 flaky 用例；`gh run rerun --failed` 后 attempt 2 全绿。
- provenance `logIndex=3014996781`；registry 侧：`dist-tags.latest` = `0.3.0`、`gitHead` = `4dbaba7033a0850b338b62156f5b2bfcf3e270c6`、tarball 9 文件 / unpacked 110427 B / `shasum 375a84a7a210f487debf7488820000b94a2209f9`。
- **发布版真机验证**（解包 tarball 后在隔离沙箱里跑）：`describeGlobalSettingsPath()` = 新位置、`describeProjectSettingsPath(cwd)` = `<cwd>/.pi/pi-pkg-cfg/pi-vision/settings.json`；老 Pi `settings.json` 的 `pi-vision` 节 `{model, autoAnalyzeAttachments:true}` 被整节读出；`writeAutoAnalyzeAttachments(false)` 落盘后新文件同时含 `model`（保留）与 `autoAnalyzeAttachments:false` —— **Q25 整节迁移在发布版上成立**；老文件未动。
- 遗留（既有、非本次引入）：release.yml 的 `npm test` 会跑全仓，`pi-background-terminal` 那条 flaky 用例能让任意包的发布挂掉。
