# 017 – before_agent_start 的 systemPromptOptions 在 Pi 1.1.0 变成归一化形态

**日期**：2026-10-12　**来源**：issue 116-x（pi 升级 1.1.0 + 两个 small-extension）

## 事实

Pi 1.1.0 起，`BeforeAgentStartEvent.systemPromptOptions` 的类型从 `BuildSystemPromptOptions`
（除 `cwd` 外全可选）收紧为 `NormalizedBuildSystemPromptOptions`：

```ts
export type NormalizedBuildSystemPromptOptions = BuildSystemPromptOptions & {
    selectedTools: string[];
    hiddenTools: string[];
    toolSnippets: Record<string, string>;
    toolGuidelines: Record<string, string[]>;
    promptGuidelines: string[];
    appendSystemPrompt: string;
    sections: Record<string, string>;   // 扩展写自定义 prompt 段的地方
    contextFiles: Array<{ path: string; content: string }>;
    skills: Skill[];
};
```

扩展在 `before_agent_start` 里拿到的已经是归一化后的对象（runner 调
`normalizeBuildSystemPromptOptions` 之后再 emit），所以运行时按字段读写没问题；
但**测试 fixture 只给 `{ cwd: "/tmp" }` 会直接 typecheck 失败**（TS2322，缺 9 个字段）。

## 坑：normalizer 拿不到，只能显式构造

pi 导出了 `NormalizeBuildSystemPromptOptions` 类型，但：

- `normalizeBuildSystemPromptOptions()` **没有从包根 re-export**（只有类型导出了）；
- 深路径 `@earendil-works/pi-coding-agent/dist/core/system-prompt.js` 被 package.json
  的 `exports` map 拒绝（只放行 `.` / `./rpc-entry` / `./client` / `./experimental/plugin`）——
  运行时 `import` 和 TS 的 NodeNext 解析都会报 `Package subpath ... not defined by "exports"`。

结论：**测试里无法调用 pi 的归一化函数**，只能自己拼一个集合完整的字面量。
仓库做法：`packages/pi-vision/src/test-helpers.ts` 的 `fixtureSystemPromptOptions(cwd)`
（全字段空集合）与 `beforeAgentStartEvent(images, prompt)`，两个 fixture 共用。
扩展自己写 `sections` 时不受影响——`sections` 是 `Record<string, string>`，直接赋值即可。

## 复用场景

给任何构造 `BeforeAgentStartEvent` 的测试写 fixture 时，别只给 `cwd`；空集合补齐九个字段，
或复用 pi-vision 的 helper 形态。升级 pi 时若该类型又加字段，报错会直接指出缺哪个。
