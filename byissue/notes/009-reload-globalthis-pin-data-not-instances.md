# `/reload` 与 globalThis 钉住的单例：钉数据，不钉实例

Pi 的 `/reload` 用 jiti `moduleCache: false` 重新求值每个扩展模块。模块级单例会被换掉（丢任务），所以我们习惯把 manager 钉到 `globalThis[Symbol.for(...)]`。**但钉住实例意味着钉住旧原型**：升级代码后 reload，新模块拿到的是旧类的实例，新加的方法不存在——subagent 088 上线时就炸了 `subagentManager.setProgress is not a function`（第一次测试碰巧没触发，第二次任务直接 failed）。

两种处理：

| 做法 | 例子 | 代价 |
|---|---|---|
| 能力检查，不兼容就换新实例 | background-terminal（ff 076）`isCompatibleManager` 查 `listAll` | 升级那一次 reload 会丢旧任务；每加一个方法要更新检查项 |
| **钉数据（Map），类每次加载新建** | subagent（088）`new SubagentTaskManager(globalStore[KEY] ??= new Map())` | 需要类的全部状态都能放进那份数据；回调类状态每次加载重新 `init` |

优先用第二种：方法永远来自当前代码，任务又能活过 reload。测试模式：两个实例共享同一个 Map，第一个 register、第二个能 get/stop，且第二个有新方法。

判断某个包是否有这个坑：`rg "Symbol.for" -A3` 看钉住的是 `new XxxManager()` 还是 `new Map()`。
