# Windows pi-rpc 主机上 unref'd timer 严重迟到

## 结论

在 Windows 传统 S3 睡眠机器 + pi `--mode rpc`（daemon spawn、stdio 管道、jiti 进程内加载 TS 扩展）的环境组合下，runPi 里注册后 `unref()` 的 one-shot `setTimeout` 曾观察到**在 deadline 过后 51s–54m50s 才触发**，落点几乎总是子进程 stdout 新事件（message_end / close / EOF）时刻，而不是 deadline。期间父进程事件循环有活跃铁证（进程内插件 40–90s 周期日志、RPC 即时响应）。

## 事实与排除链（10 项实验均有日志/实验证据）

- 大事故（2026-10-03 UTC）：code review 子代理 deadline 14:53:34，abort 15:48:24 才执行，子进程在 deadline 后又完成 29 turn，elapsed 74m50s；父进程 15:47:09 仍在处理 turn hook。
- 5 次探针（必须 `maxTurns=50`；`maxTurns=1` 触发的是 max_turns 路径，不是 timer 证据）：迟到 51s/60s/102s/54m50s，模式 100% 一致。
- 已排除：系统睡眠（Kernel-Power 事件窗口零条）、墙钟跳变（daemon pino 30s 节奏完美）、系统卡顿（eventLoopDelay p50=15.6ms）、父循环冻结、unref'd timer park 缺陷（裸 Node 同机 3.01s 准点）、stdout 洪流饿死 timers phase（12MB 洪流下 timer 仍 3000ms 准点）、worker 模型（扩展在主线程）、setTimeout monkey-patch（全链 grep 无）、kill 静默失败（kill 后 7ms 死亡）、maxTurns 路径混淆。
- **根因未定位**——环境特有现象，timer 只在 IO 事件时刻被服务。排查方向（未做）：pi rpc 主循环实现、Node 24.21.0 + Windows libuv 管道 handle 组合、jiti 编译产物 vs src 差异（缓存 `%TEMP%/jiti/src-index.*.mjs`）。

## 规则

1. 在该环境组合下**不要信任单一 unref'd one-shot timer 作为唯一超时执行机制**——deadline 的执行必须是冗余的：活动驱动检查（每条子进程事件）+ 周期看门狗 interval。
2. 诊断时加 `PI_SUBAGENT_DEBUG=1` 拿 timer 注册/触发时刻直接证据；旧版 paused 文案报配置值不报实际 elapsed，注意甄别。
3. `maxTurns=1` 的探针结果不能作为 timer 行为证据——它走的是 max_turns 暂停路径。

## 相关位置

- `packages/pi-subagent/src/index.ts`（三重冗余超时：one-shot timer + per-event deadline 检查 + 1s deadlineTicker 看门狗）
- `byissue/issues/108-x-ff-subagent-timeout-watchdog.md`（修复记录，0.13.1 发布）
