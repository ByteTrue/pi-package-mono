# npm workspaces 而非 pnpm filter

## 结论

本仓库用 **npm workspaces**。跑包脚本用 `npm --workspace <name> ...`，不要用 `pnpm --filter`（无 `pnpm-workspace.yaml`，pnpm 解析不了 workspace devDependencies）。

## 触发场景

装依赖、跑单包 test/typecheck、pack-smoke、发版前检查。

## 细节

```bash
npm test
npm --workspace @bytetrue/pi-web-search test
npm --workspace @bytetrue/pi-vendor run typecheck
```

## 相关位置

- 根 `package.json` `workspaces: ["packages/*"]`
- `.cs/spec/index.md`
