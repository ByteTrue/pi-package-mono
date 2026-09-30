# Prompt 指引方向审计：机制全绿也可能教模型做反的事

## 结论

面向模型的指引文本（promptGuidelines / description / schema description）写反方向时，所有机制层验证都会照常全绿——测试锁的是代码行为，没人锁「指引教的动作是不是你想要的动作」。079 的真实事故：意图是「超时失败引导向 background_run」，落进代码的 guideline 却写成 "when you need the result of a longer command, pass a larger timeout to bash"——与 issue 记录、commit message 双双相反，发布三版无人发现，直到另一台机器上 bash 挂死几十分钟（2026-09-17，byissue/issues/099-x-ff-bash-timeout-cap-bypass.md）。

## 何时适用

任何 ff/issue 改了面向模型的措辞（新增或修改 guideline、description、示例值），以及 review 这类 diff 时。

## 细节/规则

- **把指引当命令读一遍**：遇到「when X, do Y」句式，分别核对 X（触发条件）和 Y（教的动作）各自指向哪里。079 的事故里 Y 从 background_run 换成了 bash，一个词的差别。
- **三处对照**：issue 记录的意图、commit message 声称的行为、实际字符串。三者不一致时以字符串为准排查——issue 和 message 都可能描述的是「想要」而非「写了」。
- **指引是安全网的旁路入口**：任何「默认值 + 显式参数尊重原值」的设计，其指引一旦教模型传显式大值，默认值就形同虚设。写这类指引前先问：显式路径的正当出口在哪里（如 background_run），指引必须指向那个出口。
- 静态 guideline 在开场说一遍，模型在压力下未必记得；失败瞬间的 tool_result 上下文内引导 recency 更强（099 的第三层防线）。
- 顺带模式耦合警示：tool_result 匹配错误文本（`Command timed out after N seconds`）依赖 pi 核心措辞，核心改格式时静默失效——升级核心时对照检查。
