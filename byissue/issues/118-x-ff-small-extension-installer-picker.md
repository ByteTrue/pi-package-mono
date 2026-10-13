---
kind: issue
title: "快改：small extension 安装脚本合并为 Node 多选安装器"
type: ff
status: closed
created: 2026-10-13
---

# 快改：small extension 安装脚本合并为 Node 多选安装器

> **读者：** 以后搜到这条时——「改了啥、怎么信、动没动制度记忆」。
> **自检：** 做了什么 · 改了哪些文件 · 怎么验证 · 对 `byissue/` 有无影响。

用户诉求：安装 small extension 时能只用方向键勾选想装的那几个（可全选），并且把两个平台脚本（`install-small-extension.sh` 零参数全装、`.ps1` 同逻辑）合并成一个 Node 脚本——pi 用户必然有 node 环境。用户拍板安装命令走**两步流**（先 `curl -o`/`irm -OutFile` 落盘再 `node` 运行），换取所有平台（含 Windows）原生交互——管道喂脚本会占掉 stdin，方向键菜单拿不到终端。

- 做了什么：`scripts/install-small-extension.mjs`（新，唯一安装入口）：readline keypress + raw mode 的方向键多选（↑/↓ 或 j/k 移动、space 勾选、a 全选/全不选、enter 安装、esc/ctrl-c 取消并退出 130），默认全选（enter 等价旧行为）；`--all` 非交互全装；stdin/stdout 非 TTY 且无 `--all` 时报错退出 64 并提示两步流命令；下载改用 Node 内建 `fetch`（不再依赖 curl/Invoke-WebRequest，Node 18+）；写 `<dest>.tmp` 再 rename（沿用旧 ps1 的原子落盘 + finally 清理）。
- 改动：`scripts/install-small-extension.sh`、`scripts/install-small-extension.ps1` — 删除（git rm）。
- 改动：`scripts/check-small-extension-installer.mjs`（新）— 安装通道 gate：`small-extensions/*/` 必须出现在安装器清单里，清单里的源文件必须真实存在；接进 `.github/workflows/ci.yml`（与 README drift gate 并列，`npm ci` 前）。加新扩展漏改清单此前是静默失败（113/116 都靠手工同步两处清单）。
- 改动：`README.md`、`small-extensions/README.md` — 安装段改成两步流双平台命令 + 菜单按键说明 + `--all` 非交互写法。
- 改动：`small-extensions/{pi-bash-timeout,pi-ask-user,pi-context-guard,pi-codemode-only}/README.md` — 各自不再复制整条命令，改为「跑安装器并勾选 `<name>`」+ 指回 `../#install`（消灭 5 份长命令副本）。
- 改动：四个 small-extension 的 `package.json` description、`AGENTS.md` 仓库地图行、`byissue/spec/pi-bash-timeout/index.md`（定位／实现地图／证据三处脚本名与参数语义）。
- 怎么验证：真实 pty（`script -q /dev/null` + `stty cols 100`）驱动 8 个场景，全部符合预期——space×2+↓+enter 只装后两个；裸 enter 装全部 4 个；esc → rc 130 且零文件；`a` 后 enter → "Nothing selected"；`a` 后再 `a` 回到全选；`--all` 装全部；非 TTY → rc 64；未知参数 → rc 64；下载内容与仓库逐字节相同；无 `.tmp` 残留。gate 双向验证（删掉清单一行 → 报缺失；指向不存在文件 → 报不存在）。全仓 `npm run typecheck --workspaces --if-present` exit 0、`npm test` exit 0（10 workspace 全绿）。两个 gate 本地 exit 0。
- byissue：已同步 `byissue/spec/pi-bash-timeout/index.md`（唯一记录安装通道的 spec；`byissue/spec/index.md` 未提安装脚本，无需改）；沉淀 `byissue/notes/020-node-installer-stdin-and-sandbox-home.md`（管道喂 node 无交互 stdin + 测安装脚本须沙箱 HOME）。
- 顺手发现（教训）：跑 `--all` 场景时忘了给该次 bash 加沙箱 `HOME`，安装器往真实 `~/.pi/agent/extensions/` 覆盖了四个 `.ts`——内容与 `main`（工作区 == HEAD）逐字节相同，等于原地重写，无损失；但以后在真实机器上测这个脚本，必须显式 `HOME=/tmp/...`。
- 残余风险：Windows 路径（PowerShell 两步流 + Node raw mode）本机无法验证，未在 CI 覆盖；合并后 `README` 里的 raw URL 才会随 `main` 生效（合并前跑会 404）。
