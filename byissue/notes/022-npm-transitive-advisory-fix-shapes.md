# npm 转依赖 advisory 的三种修法：overrides 只对全新解析有效

## 结论

`npm audit` 报出的转依赖（transitive）advisory，**不能靠 `npm audit fix` 对着已有 lock
修掉**。本仓库已有 `overrides`（`undici`），所以直觉是"加一条 override 就行"——也不对：
npm 11 的 `overrides` 只对**全新解析**生效，对着已有 `package-lock.json` 不会重新解析。
能稳定落地的修法是把被要求的包写成**根 devDependency 的确切版本**（不能与 override 并存）。

三种方式与失效条件（npm 11.19.1 实测）：

1. `npm audit fix` — 对 lock 里已 pinned 的转依赖条目无效。它只顺带把 workspace 版本同步
   进 lock（`packages/<pkg>.version`），advisory 项原样留下。
2. `overrides: {"<pkg>": "^<fixed>"}` — **在临时目录做全新解析时有效**（lock 生成时即取
   修复版本，`npm ls` 干净、`npm audit` 0）。对着已有 lock：`npm ls` 报
   `invalid: "^<fixed>" from node_modules/<parent>`，`npm install` 与 `npm install --force`
   都保留原版本。要让它生效只能删 lock 重解析，那是整个 lock 的重写，diff 不可控。
3. 根 `devDependencies: {"<pkg>": "<fixed>"}`（**不要**同时保留 override，会
   `EOVERRIDE: Override for <pkg>@<fixed> conflicts with direct dependency`）— 有效。npm 把
   parent 的 semver 需求去重（dedupe）到顶层那一份，`npm ci` 逐字装上该版本。代价是根包
   声明了一个它并不 import 的包，所以根 package.json 要写明为什么在。

## 为什么

npm 的 lockfileVersion 3 把每个包的 resolved 版本写进 lock；`npm ci` 逐字照装，`npm install`
在 lock 已存在时优先复用 lock 条目。override 是解析期规则，不参与"已有 lock 的局部更新"，
所以只有从零解析时才会体现。

判断该不该修，先看暴露面：`npm ls <pkg>` 看它挂在谁下面。若链是 dev 依赖（vitest 之类），
且没有任何 `packages/*/package.json` 声明它（`rg -l "<pkg>" packages/*/package.json
small-extensions/*/package.json` 无命中），`npm pack` 的产物文件里也没有它，那么风险只落在
"本地跑测试"，不在用户装上发布物之后。这时一条确切版本的 devDependency pin 是相称的修法，
不必升级上游测试框架（跨包、可能改测试行为）。

## 规则

1. 先跑 `npm ls <pkg>` 与 `rg -l` 查声明面，确认是 dev-only 还是进入发布物；进入发布物
   就必须走上游升级，不能只 pin。
2. 要修时按顺序试：`npm audit fix`（对已有 lock 基本无效，先确认它改了什么）→ overrides
   （只在全新解析有效，本仓库已有先例，可用，但要预期它不会改动现有 lock）→ 根 devDependency
   确切版本（能落地，与 override 二选一）。
3. 修完必须验三件事：`npm ci` 后 `node_modules/<pkg>` 的实际版本、`npm audit` 是否 0、
   全仓 typecheck + test（见 `byissue/notes/021-npm-ci-before-full-typecheck.md`：本地依赖
   对齐 lock 后 typecheck 才可信）。
4. **不要 `npm audit fix --force`**：它跨 major 换 dev 依赖（vitest/vite 整条链），把一个
   patch bump 换成真实的兼容性风险。

## 验证

2026-10-18（`chore(repo): pin transitive source-map-js 1.2.2 to clear the npm audit
advisory`，`6a462a3`）：`source-map-js 1.0.0–1.2.1`（GHSA-68fv-2mgg-jv7q，畸形 source map
的事件循环 DoS）经 `vitest → vite → postcss → source-map-js@1.2.1`，链纯 dev。
`npm audit fix` 与 override 均无效（`npm ls` 报 `invalid: ^1.2.2 from node_modules/postcss`），
override + 直接依赖 → `EOVERRIDE`；加根 devDependency `source-map-js: 1.2.2` 后
`npm ci` 装上 1.2.2、`npm audit` 0 vulnerabilities、全仓 typecheck exit 0、`npm test`
全 workspace 全绿。全新解析的有效性在临时目录对照验证过（`postcss@8.5.28` +
`overrides: {"source-map-js":"1.2.2"}` → lock 取 1.2.2、audit 0）。

## 复用场景

- 任何转依赖 advisory：先查声明面与发布物，再选修法。
- 已有 `overrides` 先例的本仓库，加一条 override 的诱惑很大，先确认"它只在全新解析生效"
  这条语义，再决定要不要动 lock。
