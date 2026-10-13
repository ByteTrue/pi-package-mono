# 020 – 管道喂脚本的 node 没有可交互 stdin；测安装脚本必须沙箱 HOME

**日期**：2026-10-13　**来源**：issue 118-x（small extension 安装脚本合并为 Node 多选安装器）

## 事实一：`curl … | node` 拿不到终端

把安装器文档写成一行流 `curl -fsSL <url>.mjs | node` 时：

- **stdin 被管道占掉**，脚本再也不能用方向键交互——报错连"没有 TTY"都不会有，
  而是直接崩：`node` 无参数读 stdin 时**默认按 CommonJS 解析**，`.mjs` 里的
  `import` 立刻抛 `ERR_REQUIRE_ESM` / 语法错误，看起来像脚本本身写坏了。
- 想救回来得手动 `fs.openSync('/dev/tty')` + `tty.ReadStream`，而 **Windows 没有
  `/dev/tty`**（`ENXIO`），跨平台就得分叉。
- 因此带交互的 Node 安装器**必须两步流**：先 `curl -o` / `irm -OutFile` 落盘，再
  `node <file>`。此时 stdin/stdout 都是真 TTY，交互原生可用、全平台一致。
- 脚本仍要显式检查 `process.stdin.isTTY && process.stdout.isTTY`：非 TTY（CI、自动化、
  被管道包住）时给出两步流提示并退出 64，而不是卡在 raw mode 干等输入。
- 非交互兜底保留 `--all`（本仓安装器如此）：一行流做不到，但脚本/CI 有确定出口。

## 事实二：测安装脚本必须显式沙箱 HOME

安装器的目标路径来自 `os.homedir()`（`~/.pi/agent/extensions/`）。本地测「装全部」
场景时若忘了给这次命令加 `HOME=/tmp/...`，脚本会**直接覆盖真实用户目录**——而且是
幂等覆盖，不报任何错。

本次就踩了：测 `--all` 的那条 bash 漏了沙箱 HOME，真实 `~/.pi/agent/extensions/` 下
四个 `.ts` 被原地重写（内容与 `main` 逐字节相同，侥幸无损）。

## 复用场景

- 写任何"下载 + 写入用户目录"的安装脚本：先决定交互怎么拿到终端，再决定文档命令形态。
- 本机验证这类脚本：每条调用都显式带 `HOME=<tmp>`（或平台等价），别依赖命令继承的环境；
  只给 pty 驱动的那条加沙箱、给 `--all` 的那条忘了，是很容易犯的漏。
