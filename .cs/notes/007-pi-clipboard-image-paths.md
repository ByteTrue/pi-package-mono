# Pi 粘贴图片自己就落盘；`images` 事件字段只有三个非交互产地

Pi TUI 的 ctrl+v 粘贴图片（`interactive-mode.js` 的 `handleClipboardPaste`）**自己就把图写到磁盘**：`$TMPDIR/pi-clipboard-<uuid>.<ext>`，然后把这个路径当**普通文本**插入输入框。源码注释原话："Images are attached by path"。

`input` 扩展事件的 `event.images: ImageContent[]` 只在三处被填充，**都不是** TUI 交互期的 `onSubmit`：

| 产地 | 位置 |
|---|---|
| `pi -p @file.png "..."` | `modes/print-mode.js` |
| TUI 启动参数（`pi @file.png`） | `modes/interactive/interactive-mode.js` |
| RPC 客户端显式传 `images` | `modes/rpc/rpc-mode.js` |

结论：想写一个"处理用户发来的图片"的 Pi 扩展，**不需要 `input` hook**，也不需要自己实现落盘/清理——粘贴图片、粘贴路径、agent 自己截图，这三条路最终都是同一条：以文件路径的文本形式进 agent。真正需要处理的只有"当前模型看不看得懂这个路径指向的图片"这一层。

来源：`@bytetrue/pi-vision` 设计过程（`.cs/issues/040-x-vision-package.md`），核实于 Pi 0.83.0。
