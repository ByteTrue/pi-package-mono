---
kind: issue
title: "全仓审计 Should fix 第二批:17 项修复 + Lean 清理(BYTE-6)"
type: bug
status: open
created: 2026-10-09
---

# 全仓审计 Should fix 第二批:17 项修复 + Lean 清理

> **读者:** 验收 BYTE-6 修复批次的接手人;想了解某条审计发现的落点与验证方式的人。姊妹批次(第一批 Must fix)见 `byissue/issues/110-o-audit-must-fix-eight.md`,基线分支 `byissue/110-audit-must-fix`(74bc721),本批在其之上推进,两批合并与本 issue 关闭随收尾一并处理。

## 范围与来源

BYTE-4 全仓审计(主报告 #8–#20 + 增补 A1/A3/A4/A5)与 Lean 清理约 -430 行。Nice to have 18 项按"顺带评估、性价比低的记录不修"处理。

## 执行痕迹(按包)

**pi-vendor**(f63daf8)
- **#8 目录搜索双实现**:新建 `src/shared/vendor-shared.js` 单一实现(.d.ts 供 tsc,allowJs 关闭下不进编译),TUI 的 `searchOfficialModels` 改为调用共享层,语义即脚本原语义(token 化 + 归一化 + 三档 score);"gpt 5" 在 TUI 现在给出完整候选表,不再把字面量当模型 id 写进配置。脚本与 TUI 共用同一文件,无复制。
- **#9 set-key 非 TTY 挂起**:`readSecret` 非 TTY 直接 fail(usage 退出码 2),永不进入 `for await stdin`;setKey 导出 + 注入 reader/modelsPath 供测试,main-guard 保证 import 无副作用;usage 串补上 set-key。CAS/转义/原子写契约由注入 reader 的测试覆盖。
- **#10 models-json 死层**:删除 writeModelsJson/readModelsJson/upsertProvider/draft 全部 7 个导出,模块只留类型 + getModelsJsonPath;测试钉住导出面防复活。
- **#11 动态 import 无校验**:`isPlainDataTree`(拒绝函数/getter/setter/类实例,cycle 安全)+ `isCatalogObject` 形状守卫,TUI 与脚本两侧的 catalog 加载都过闸;毒化 module(function/getter/错误形状)测试覆盖。
- Lean:NTH `ID_MAX_BYTES_PER_CHAR` 死常量与冗余长度预检删除;quick-add-provider 空 API 名改为重问不再静默默认、API key trim。
- 语义注意:catalog 排序从"首见序"变为"id 字母序"(脚本原语义,有意统一);prefix 组内顺序测试已按新语义更新。

**pi-web-search**(9d5dc63 + 93ece4b + 59f559b)
- **Lean 7 provider 收敛**:`providers/json-provider.ts` 泛型 + `factory.ts` 里 `JSON_PROVIDER_SPECS` 配置表;bocha/tavily/exa/brave/jina/firecrawl/searxng 七个近拷贝文件删除(净 -105 行);registry↔spec 完整性契约测试防漂移。`listAvailableSearchProviders` 死导出删除。`engines: node>=20` 补齐(AbortSignal.any 依赖)。
- **#13 代理校验**:保存前只放行 http/https(socks5 拒绝且不落盘);env 侧非法代理 warn 一次(进程级去重)而非静默忽略。
- **A1 spill 清理**:web_fetch 溢出改写包私有目录 `%TEMP%/byte-web-fetch/`,每次 spill 前 await 清扫超过 7 天的孤儿;3 个行为测试(落点/过期清扫/新鲜保留)。
- **#12 输出保真**:content-type 白名单(text/*、+xml/+json 及常用基类;PDF/zip 直接拒);按响应 charset 解码(GBK/GB18030/Big5 等 16 个 label,未知回退 UTF-8);实体单遍解码(`&amp;lt;` 保持字面 `&lt;`,不再二次解码成 `<`);标签剥离 quote-aware(属性含 `>` 不断裂);未闭合 script/style/注释不再泄漏正文;标题实体解码。11 个新测试。

**pi-image-gen**(11c5218)
- **#14 Gemini candidateCount**:恒为 1,n>1 循环单张请求(README 的 n 1–8 契约成立);中途 HTTP 错误正常冒泡。
- **#16 三处丢数据**:401/403 提示指向包级 settings.json(原指向已废弃的 Pi settings.json 路径);清凭据时 "Keep current headers" 选项保留(原确认后 headers 被抹成空);模型列表编辑改为对落盘列表施加 delta(add/alias/remove 各自的 delta 函数),不再整份快照写回,双开不丢另一窗新增。
- **#15 $VAR 插值**:核对现码——探针(chooseRemoteModel)的 baseUrl/apiKey/headers 全部经 `resolveProviderRoute` → `resolveConfigString` 插值,审计指的两处不一致在当前代码已不成立;加回归测试钉住(base/apiKey/headers 三处 ${VAR} 解析)。
- **A5 Skill dist 守卫**:`image-gen.mjs` import dist 失败时给出"先跑 npm run build"指引并 exit 2,不再裸 ERR_MODULE_NOT_FOUND;构建后正路径验证 exit 0。

**pi-subagent**(edbe439)
- **#18 resume/id 校验**:`SESSION_ID_PATTERN` 在 `normalizeTask` 与 `buildPiArgs`(argv 边界纵深)两层生效;错误信息区分 resume/id。
- **#17(2) reload 分支**:`session_shutdown` 的 reload 不再提前 return——先 flush pendingExits(保住完成通知)再清 statusTicker,与全量关闭分支一致的 teardown。
- **#17(1) stop 竞态核对**:真实子进程测试(长跑假 pi,abort 后 close 带非零码)证明现行代码经 aborted 分支报 cancelled——审计描述的"覆盖为 failed"在基线代码未复现,测试固化该契约;manager 级 stop → complete(cancelled) 幂等亦有测试。

**pi-vision**(3b8d9a3)
- **#19 deadline 兜底**:除 signal 外加 `Promise.race` 兜底——completeFn 完全无视 signal 时 60s 墙钟仍然生效(fake timers 测试);ctx.signal 已取消时直接返回 undefined,不再走 failure() 注入"请改用 image_ask"反向指令。
- **A3 工具路径预算**:`image_ask` 复用 auto 的规则——不超过 4 张、合计不超过 20MiB(解码后),超限报错且不调模型。
- **A4 MIME 归一化**:`normalizeDeclaredMime` 把常见非标 `image/jpg` 归一为 `image/jpeg` 再比较;真实错配(GIF 标 PNG)仍然整批拒绝。

**docs**(ccef21e,#20)
- `byissue/spec/index.md`:七个改六个,删 pi-browser 条目(能力地图/使用路径/架构表/边界/证据索引),留一行归档指向;孤儿子 spec 目录 `spec/pi-browser/` 移入 `archive/pi-browser-spec/`(附 ARCHIVED.md 说明)。
- `README.md`:补 pi-subagent 行(包表/安装/能力划分),five 改 six。

**Nice to have 处置**
- 已修:vendor 空 API 名/未 trim key、bounded-discover 死常量与冗余检查、web-search engines 字段、localhost:8080 双份默认(收敛到 registry 单源)、usage 串漏列 set-key、credentialEcho 最小长度(第一批 #6 已落 `CREDENTIAL_MIN_LENGTH = 8`,Authorization token 剥 scheme 后同阈;修复发生在第一批,本批未重复列)。
- 记录不修(性价比低或需上游配合):STRIPPED_FIELDS 双份拷贝(vendor-shared 单源后仅剩 TS/JS 语言差异,契约测试守护)、URL 下载大小上限、content-type 压过魔数嗅探、markdown 路径转义、Windows 保留文件名、resolvePiCli Windows 全局兜底、formatPiOutput 前缀剥离复用、BBC 截断替换符、image_ask 全有或全无、vision 常量别名、含换行 base64 预检、subagent 别名死代码(已是公共导出)、config-core CAS 写后复核(竞窗仅剩 rename 前几个系统调用,真正关窗需文件锁;写后复核只能报告丢失不能挽回,已在 `commitWithDependencies` 落决策注释)。如需全清建议另开小批次。

## 验收补齐(2026-10-09,BYTE-6 验收反馈 3 类小项)

1. **#16 两个子修复补直接测试**(`config-command.test.ts`,各 1 条):「清凭据保留 headers」——清空 apiKey 的同一次编辑里选 "Keep current headers",断言落盘 `headers` 原样、`apiKey` 为空;「模型列表 delta 写入」——菜单开着时另一窗写盘新增 `from-another-window`,本窗按旧快照预览删除 `image-v0`,断言提交后并发新增存活、被删项仍删(delta 语义,非整份快照写回)。
2. **Nice-to-have 3 项去向补记**:① config-core CAS——不修,理由与决策注释落点见下方"Nice to have 处置";② credentialEcho——第一批 #6 修复(`CREDENTIAL_MIN_LENGTH = 8`)已覆盖此项,非本批遗漏;③ URL 下载整图 base64 解码(嗅探用)——已修,`classifyImageOutput` 裸 base64 分支改为只解码 16 个 base64 字符(=12 字节,覆盖全部签名所需)的前缀探针,padding 处截断与 Buffer 解码器语义一致,接受/拒绝与整图解码逐例一致。
3. **image-gen Lean 子项(-30 行)交代**:执行时未单列,现补记——实测后发现无 -30 行可删,故未动。逐符号核查:全部导出均有内部消费方,无一死导出;唯一同构近拷贝(gemini adapter 的 inline data 组装,约 5 行)过小,抽共享层反而加间接层;改前(e480899)与改后(HEAD)的导出面完全一致,该包改动均为 #14/#15/#16/A5 的修复本体。
4. 顺手项:pi-web-search/package.json 补回行尾换行符(验收反馈"不阻塞"项)。
5. vendor config-core CAS 决策注释落码:窗口为 compare→write+rename 几个系统调用,真正关窗需文件锁,写后复核只能报告不能挽回;竞窗外并发由同一次 re-read 兜住,残窗最小。

## 验证(验收补齐后)

- 全仓 `npm test`:**702 通过 / 10 跳过**(验收补齐 +2:#16 两条行为测试;基线 664/10,零回退)。分计:bg-terminal 52+1skip、image-gen **134**、subagent 80、vendor 193、vision 95、web-search 148+9skip。
- `npm run typecheck --workspaces --if-present` 全绿(exit 0,六包 0 error)。
- 关键行为测试锚点:vendor `vendor-script.test.ts`(set-key 非 TTY 拒绝)、`official-catalog.test.ts`(毒化 module 拒绝);web-search `html-fidelity.test.ts`(GBK 解码/PDF 拒绝/双转义)、`spill-cleanup.test.ts`(TTL 清扫)、`proxy-validation.test.ts`(socks 拒绝+warn-once);image-gen `byte6-fixes.test.ts`(n=3 三请求/discovery 插值/401 指向);subagent `byte6-fixes.test.ts`(真实子进程 abort 竞态/malformed resume 拒绝/reload flush);vision `byte6-fixes.test.ts`(无视 signal 的 60s 兜底/image/jpg 接受/5 张拒绝)。

## 关闭候选(待验收后毕业)

- `byissue/spec/pi-vendor/index.md`:catalog 语义段补"TUI 与脚本共用 src/shared/vendor-shared.js,token 匹配;set-key 非 TTY 拒绝;catalog 模块过数据守卫"。
- `byissue/spec/pi-web-search/index.md`:web_fetch 补 content-type 白名单与 charset 解码;代理补"保存前 http/https 校验,socks 拒绝;env 非法 warn 一次";spill 临时目录 7 天 TTL。
- `byissue/spec/pi-image-gen/index.md`:补 Gemini n 循环实现方式;401 指引指向包级 settings;模型列表 delta 写入。
- `byissue/spec/pi-subagent/index.md`:补 resume/id 形状校验与 reload flush 契约。
- `byissue/spec/pi-vision/index.md`:补 60s race 兜底、取消不注入、工具路径 4 张/20MiB 预算、image/jpg 别名。
- 关闭时本文件改名 `111-x-audit-should-fix-batch-two.md`。
