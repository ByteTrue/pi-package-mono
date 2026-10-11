# 016 – small-extension 注册带参 tool 的两条上游事实

**日期**：2026-10-11　**来源**：issue 113（pi-ask-user small-extension）

## 事实一：Pi 参数校验器支持无 Kind 符号的 plain JSON Schema

Pi 的工具参数校验（pi-ai `utils/validation.js` 的 `validateToolArguments`）先用
`Object.getOwnPropertySymbols(tool.parameters).includes(Symbol.for("TypeBox.Kind"))`
判断 schema 是否为 TypeBox 产物；**没有 Kind 符号的 plain JSON Schema 走专门分支**：
先做 JSON 类型 coercion（含 union 尝试与逐属性修正），再正常 `Compile` + `Check`。

含义：small-extension 的零运行时 import 约束与「注册带参数的 tool」不冲突——
不需要 `import { Type } from "typebox"`，手写 schema 对象字面量即可，校验器照样
验证与纠偏。仓库先例：`packages/pi-subagent/src/index.ts` 的 tool parameters、
`small-extensions/pi-ask-user/pi-ask-user.ts`。

注意：这条不等于「TypeBox 的一切特性都可用」。plain 分支只做类型层面的
coercion；TypeBox 的 `$ref`、`optional 标记`（symbol 属性）等运行时增强不在其中。
small-extension 场景（扁平 object/array/string schema）足够。

## 事实二：AgentToolResult 的 details 是必填字段

`@earendil-works/pi-agent-core` 的 `AgentToolResult<T>` 把 `details: T` 定义为
必填属性（工具没有结构化详情时传 `undefined` 即可），execute 的返回类型签名会
强制检查它。单文件扩展的标准写法：

```ts
const result = await core(...);
return { ...result, details: undefined };
```

漏掉它 typecheck 直接报 `Property 'details' is missing`，且这不是 optional 标记
能绕的——字段在接口上是 required。

## 复用场景

任何 small-extension（零运行时 import 单文件）要注册带参数的 tool 时，照
pi-ask-user 的形态写：手写 plain schema + `as unknown as TSchema` cast +
`{ ...result, details: undefined }` 返回。
