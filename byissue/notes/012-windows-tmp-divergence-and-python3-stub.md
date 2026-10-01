# 本机 POSIX 兼容层的三个陷阱：`/tmp` 不是同一个目录、`python3` 是个假命令、`statSync().mode` 恒为 0o666

在这台机器（Windows + MSYS/Git-Bash 风格 shell）上，三件事看起来和 Linux 一样，实际不是。都是**静默**失败或成功到另一个地方，排查时很费时间。

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

## 三、`statSync().mode` 在 Windows 上恒为 `0o666`，权限位断言必然失败

```console
$ node -e "const {mkdirSync,statSync,writeFileSync}=require('fs');mkdirSync(d,{mode:0o700});writeFileSync(d+'/f','{}',{mode:0o600});console.log(...)"
dir   666      ← 目录也是 666，不是 700
sub   666      ← mkdirSync 递归出来的子目录同样
file  666      ← writeFileSync 的 mode:0o600 被忽略
```

NTFS 没有 POSIX 权限位；node 对目录和文件一律回填 `0o666`。于是任何 `expect(statSync(p).mode & 0o777).toBe(0o700 | 0o600 | 0o640)` 在 win32 上必红，**而 CI 跑 ubuntu 所以看不到**——红灯只在本机，容易当成「环境问题」放过去。

**规则**：权限位断言一律加守卫：

```ts
if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
// 多条相邻断言用块形式：if (process.platform !== "win32") { ... }
```

既有正确先例（照着抄，别发明第三种写法）：`packages/pi-vendor/src/config-core.test.ts:47`、`packages/pi-vendor/src/models-json.test.ts:97`、`packages/pi-vision/src/vision-command.test.ts:76`、`packages/pi-image-gen/src/__tests__/settings.test.ts:104`、`packages/pi-subagent/src/settings.test.ts:80`（本条新增）。审计办法：`grep -rn "mode & 0o777" packages/*/src | grep -v win32` 应为空。

用内联守卫而非 `it.skipIf(process.platform === "win32")`：Windows 上仍然执行 `updateSubagentSettings` 那条代码路径，只跳过读权限位的那一步。

**旁证**：本机 Windows 上 `npm test` 全绿本身，就是「仓内已无未守卫权限位断言」的最强证据——`pi-vendor` 191 个用例在 win32 上全过，说明它的 `0o600` 断言都已被守卫；草率的 grep 漏检也会被红灯兜住。
