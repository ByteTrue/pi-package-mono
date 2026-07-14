# 配置原子写与 0o600

## 结论

含密钥的配置文件（`models.json`、web-search `config.json`）写入使用 **tmp + rename**，创建权限 **0o600**。中断不会留下半截 JSON；明文 key 至少不因默认 umask 变 world-readable。

## 触发场景

改任何写用户配置的路径；审计“权限/损坏/半写”。

## 细节

- vendor config core commit 与历史 `writeModelsJson` 均遵循此约定  
- 无跨进程文件锁；极端并发仍可能 last-write-wins / revision 冲突  

## 相关位置

- closed：`.cs/issues/2026/07/11/closed-atomic-config-write.md`  
- closed：`.cs/issues/2026/07/11/closed-web-config-key-perms.md`  
- vendor：`.cs/spec/pi-vendor/index.md`
