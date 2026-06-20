# pi-package-mono

个人自用的 [pi coding agent](https://pi.dev) package 集合(npm workspaces monorepo)。

每个包在 `packages/` 下平铺。pi 通过 jiti 直接加载 `.ts` 源码,无需编译。

## Packages

| 包 | 说明 |
|---|---|
| [`@bytetrue/pi-web-search`](packages/pi-web-search) | `web_search` + `web_fetch` 两个工具,默认零配置走 Bing(大陆可直连),一个源失败自动切换其他源,可选接入 Bocha / Tavily / Exa / Brave / Jina / Firecrawl。 |
| [`@bytetrue/pi-subagent`](packages/pi-subagent) | 照搬 Claude Code 的 subagent 体系:`Agent` 工具委派任务给隔离的专用子代理(general-purpose / explore / plan,可自定义 `.md`),每个子代理可独立指定 provider/model,`/subagent` 命令交互配置。 |

## 本地开发

```bash
# 直接加载某个包(本地路径,无需发布 npm)
pi install /Users/byte/workspace/projects/pi-package-mono/packages/pi-web-search

# 或临时挂载一个扩展试跑
pi -e /Users/byte/workspace/projects/pi-package-mono/packages/pi-web-search
```
