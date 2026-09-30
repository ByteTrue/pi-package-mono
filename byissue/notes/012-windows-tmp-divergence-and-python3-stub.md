# 本机 POSIX 兼容层的两个陷阱：`/tmp` 不是同一个目录、`python3` 是个假命令

在这台机器（Windows + MSYS/Git-Bash 风格 shell）上，两件事看起来和 Linux 一样，实际不是。都是**静默**失败或成功到另一个地方，排查时很费时间。

## 一、`/tmp` 在 shell 与 node 里指向不同的目录

```console
$ echo "TMP=$TMP"          # /tmp          ← 环境变量是 POSIX 风格
$ ls -d /tmp               # /tmp          ← shell 内建/工具确实认这个路径
$ node -e "console.log(require('path').resolve('/tmp'))"
C:\tmp                       ← node 解析成 C:\tmp
$ node -e "console.log(require('os').tmpdir())"
C:\Users\byte\AppData\Local\Temp   ← 这才是真正的临时目录
$ cygpath -w /tmp
C:\Users\byte\AppData\Local\Temp   ← cygpath 又说是这个（不是 C:\tmp！）
```

`cygpath` 的答案和 node 的答案**互相矛盾**，`$TMP=/tmp` 又和 `os.tmpdir()` 矛盾。三次查询三个结果。

实测后果（不是理论）：

```console
$ node -e "require('fs').writeFileSync('/tmp/probe.txt','from-node')"
$ cat /tmp/probe.txt
cat: /tmp/probe.txt: No such file or directory      # shell 找不到
$ ls C:/tmp/probe.txt
C:/tmp/probe.txt                                     # 它在 C:\tmp
```

**规则**：跨 shell/node 传临时文件时，别用 `/tmp`。

- 只用 node 读写 → 用 `os.tmpdir()`。
- 只用 shell 读写 → `/tmp` 可用。
- **两边都要碰** → 把工作目录切到 `$HOME`，用**相对路径**；或先在 shell 里 `cygpath -w` 出真实路径再交给 node。

（MSYS 的路径映射只对 shell 及由它启动的程序生效；`node -e` 是原生 Windows 进程，看到的是 `C:\tmp`。）

## 二、`command -v python3` 会成功，但 `python3` 永远跑不起来

```
$ command -v python3
/c/Users/byte/AppData/Local/Microsoft/WindowsApps/python3     ← 有！
$ python3 --version
Python was not found; run without arguments to install from the Microsoft Store,
or disable this shortcut from Settings > Apps > Advanced app settings > App execution aliases.
```

那是 Microsoft Store 的**执行别名存根**（`AppInstallerPythonRedirector.exe`），不是解释器。真正的解释器没装。

**退出码会骗人**：

| 调用方式 | 退出码 |
|---|---|
| `python3 --version` | 49 |
| `python3 -c "print(1)"` | 49 |
| `python3 script.py` | **49**（脚本从未运行） |
| `bash -c "python3 … \| head"` | **0**（管道里是 `head` 的退出码，错误被吞） |

所以「用管道接了一下」会得到成功状态却什么都没跑。**判断有没有 python 不能靠 `command -v`，必须实际执行一次并看退出码。**

**规则**：本机的脚本一律用 **node 或 shell**。不要写依赖 `python3` 的工具链；确实需要 Python 时先确认解释器存在（跑一次而不是查路径）。
