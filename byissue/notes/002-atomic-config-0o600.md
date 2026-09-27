# 配置原子写与 0o600

## 结论

含密钥的配置文件（`models.json`、web-search `config.json`）写入使用 **tmp + rename**，创建权限 **0o600**。中断不会留下半截 JSON；明文 key 至少不因默认 umask 变 world-readable。

## 触发场景

改任何写用户配置的路径；审计“权限/损坏/半写”。

## 细节

- vendor config core commit 与历史 `writeModelsJson` 均遵循此约定
- 无跨进程文件锁；极端并发仍可能 last-write-wins / revision 冲突
- 一次性格式迁移的重写走同一写入通道（同一个原子写函数），不因「只是升级」而降格为普通 `writeFile`；原文先落 `.v1.bak`。重写失败只在内存生效，不阻断运行时读取——交互写入仍 fail-closed，两种失败姿态共用一个文件。

## 相关位置

- closed：`byissue/issues/001-x-atomic-config-write.md`
- closed：`byissue/issues/005-x-web-config-key-perms.md`
- vendor：`byissue/spec/pi-vendor/index.md`
- image-gen：`packages/pi-image-gen/src/settings.ts`（`migrateAndPersist`），决策见 `byissue/decisions/003-image-gen-v2-single-container-explicit-route.md`
