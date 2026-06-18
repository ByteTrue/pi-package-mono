# pi-package-mono

个人自用的 [pi coding agent](https://pi.dev) package 集合(npm workspaces monorepo)。

每个包在 `packages/` 下平铺。pi 通过 jiti 直接加载 `.ts` 源码,无需编译。

## Packages

| 包 | 说明 |
|---|---|
| [`@byte/pi-web`](packages/pi-web) | `web_search` + `web_fetch` 两个工具,默认零配置走 Bing(大陆可直连),一个源失败自动切换其他源,可选接入 Bocha / Tavily / Exa / Brave / Jina / Firecrawl。 |

## 本地开发

```bash
# 直接加载某个包(本地路径,无需发布 npm)
pi install /Users/byte/workspace/projects/pi-package-mono/packages/pi-web

# 或临时挂载一个扩展试跑
pi -e /Users/byte/workspace/projects/pi-package-mono/packages/pi-web
```
