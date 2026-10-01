# 两个 agent 会话共用一个 worktree：现象、代价与四条约定

2026-10-01 本仓同时跑着两个会话——一个在做 pi-background-terminal 前台上限 600s → 300s（ff 102 / 0.10.0），另一个在做 pi-web-search undici 8.11.2 升级（ff 103 / 0.5.1）。两边都以为自己在独占 `C:/Users/byte/workspace/projects/pi-package-mono`。结果两边都撞了，而且**各自都以为是对方"闯入"**。

## 现象（都是同一个根因）

**会话 B（web-search）视角**：「一个不是我创建的 commit `663c5ba` 出现了，`origin/main` 还变成了我 rebase 出来的 `fb388cb`，有另一个 agent 在同一棵工作树里操作。」

**会话 A（bg-terminal）视角**：`git push origin main` 被拒（`tip of your current branch is behind`），而同一条命令里的 `git tag` + push tag 却成功了——于是 **annotated tag 落在一个后来被 rebase 掉的孤儿提交 `c74b7d5` 上**，而 main 上的等价物是 `fb388cb`。`git reflog` 才看出真相：

```
11:15:35  stash 创建（会话 B）
11:16:07  rebase (start): checkout origin/main
11:17:06  rebase (continue)     ← 在 byissue/spec/index.md 上解冲突
11:17:11  rebase (finish)       → fb388cb
```

冲突文件是 `byissue/spec/index.md`：会话 A 改了前台 300s 的描述，会话 B 改了 image-gen 的措辞，同一段。

**为什么没造成损失**：两边的改动在文件层面不重叠（`git diff c74b7d5 fb388cb -- packages/pi-background-terminal` 为空），tag 指向的孤儿提交子树与 main 上的 `fb388cb` 逐字节相同，release 产物一致。**纯属运气好。**

## 四条约定

1. **推送前重新对齐，不用 force**。每次 push 前 `git fetch` + `git rev-list --left-right --count origin/main...main`；被拒就重新看历史，别 `--force`。会话 B 靠这条在整场里稳住了（每次 push 都是 fast-forward）。
2. **release tag 用显式 hash 创建**：`git tag <name> <已推送的 sha>`，随后 `git ls-remote --tags` 反验。在分支上 `git tag` 再 push tag，一旦中途有 rebase，tag 就会静默钉在孤儿提交上（本次即如此；已决定不动它，provenance 锚点是那个 sha 唯一的长久锚点）。
3. **提交前 `git status`，按路径显式 `git add`**。永远不要 `git add -A` / `git add .`——另一个会话的改动离被卷进你的 commit 只差一个 `-A`。本次两边都恰好按路径 add，才没混提交。
4. **stash 不是跨会话的交接手段**。会话 B 把依赖改动留在 `stash@{0}`（基线是被 rebase 掉的 `c74b7d5`），等它自己把等价改动提交成 `884fbae` 后，那个 stash 就成了纯垃圾（内容还是 v0.4.1 / undici 8.9.0 / brace-expansion 5.0.9）。**收尾时跑一次 `git stash list`**。

## 触发自查的时机

在同一个 worktree 里看到「我没做过的事」——陌生的 commit、莫名其妙的 stash、push 被拒、rebase 进 reflog——先跑 `git log --oneline -5` / `git reflog -20` / `git stash list` 三连，确认是并行会话而不是仓库被污染，再决定动作。
