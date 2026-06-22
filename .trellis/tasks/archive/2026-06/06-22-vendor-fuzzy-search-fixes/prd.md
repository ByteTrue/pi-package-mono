# Vendor 优化：模糊搜索与修复

## Goal

改进 `/vendor` 命令的 "Add manual model id" 功能，增加模糊搜索、强制用户确认、修复参数问题，并删除不需要的模板库功能。

## Requirements

### R1：Add manual model id 增加模糊搜索
用户输入搜索关键词，从官方目录中模糊匹配模型 ID，显示匹配结果让用户选择。如果用户想输入不在目录中的模型 ID，应支持手动输入。

### R2：总是显示搜索结果让用户确认
即使只有一个候选结果，也要显示给用户确认，不能自动添加。

### R3：修复模型参数问题
调查为什么 `claude-opus-4-8` 的上下文显示为 200k，确保正确从官方目录加载模型参数（1M 上下文）。

### R4：删除 "Add from local model/template library"
从菜单中移除该选项及相关代码。

### R5：/vendor TUI 风格优化
参考 `pi-mcp-adapter` 的紧凑居中弹窗风格，优化 `/vendor` 自定义 provider 菜单和输入框的边框、分区、选中态、底部帮助提示；不改 provider/model 管理业务逻辑。

## Acceptance Criteria

- [x] 选择 "Add manual model id" 后，用户可以看到模糊搜索界面
- [x] 输入搜索词后，显示匹配的官方模型列表
- [x] 用户可以从列表中选择模型，或选择手动输入自定义 ID
- [x] 即使只有 1 个匹配结果，也显示给用户确认
- [x] 模糊搜索结果先按模型 ID 去重展示，选择模型 ID 后再选择对应官方 provider 配置
- [x] `claude-opus-4-8` 应显示正确的 1M 上下文（从官方目录）
- [x] "Add from local model/template library" 选项已删除
- [x] 现有功能不受影响
- [x] `/vendor` 选择/输入弹窗改为紧凑居中 overlay
- [x] 菜单和输入框使用完整边框、标题说明区、分隔线、footer 帮助区
- [x] 选中态改为 mcp-adapter 风格的 `›` cursor + accent/bold
- [x] 嵌套页面 `Esc` 返回上一页；根 provider 列表 `Esc` 才退出 `/vendor`

## Implementation Summary

### 修改的文件

1. **`enrich.ts`** - 修改 `enrichModelId` 函数，使其在有官方候选时总是返回 "official-ambiguous"，强制用户确认（即使只有1个候选）

2. **`official-catalog.ts`** - 新增 `listAllOfficialModels` / `groupOfficialModelsById` 函数和相关类型，用于列出官方目录模型并按模型 ID 去重供模糊搜索

3. **`command.ts`** - 主要改动：
   - 从 `MODEL_MENU` 中移除 `addTemplate` 选项
   - 移除 `addFromTemplateLibrary` 函数
   - 重写 `addManualModel` 函数，实现模糊搜索流程：
     - 加载官方目录
     - 使用模糊匹配过滤模型
     - 先按模型 ID 去重显示搜索结果，选择模型 ID 后再显示该 ID 的所有官方 provider 候选
     - 支持输入自定义模型 ID
   - 更新 `manageModels` 函数移除模板库相关处理
   - 使用统一居中 overlay 配置，让选择/输入弹窗不再 90% 撑满屏

4. **`enrich.test.ts`** - 更新测试以反映新行为（单个候选也需要确认）
5. **`package.json` / `package-lock.json`** - 补齐 `publishConfig.access=public` 和 `@earendil-works/pi-tui` peer dependency，使现有 monorepo CI/CD release workflow 自动覆盖 vendor

### 新增的文件

1. **`fuzzy.ts`** - 模糊匹配工具函数（`fuzzyMatch` 和 `fuzzyFilter`），基于 pi-tui 的算法实现

2. **`fuzzy.test.ts`** - 模糊匹配工具的测试用例
3. **`custom-select.ts`** - 自定义输入/选择组件，参考 mcp-adapter 风格渲染完整边框、分隔线、footer 和选中态
4. **`custom-select.test.ts`** - 覆盖自定义 TUI 组件的边框/分区/选中态渲染

### 关于键盘导航

- 自定义 select 组件在 vendor 内实现了方向键循环和分页：`↑↓` 在当前页循环，`←→` 翻页。
- `Esc` 语义统一为返回上一页；只有根 provider 列表显示并执行退出。

## Notes

- 键盘导航改进（方向键循环、左右跳转 5 个）需要修改 pi-tui 上游包，不在本次范围
- pi-tui 的 `fuzzyMatch`/`fuzzyFilter` 可用于模糊匹配
- pi-tui 的 `SelectList` 已支持 `setFilter` 进行前缀过滤，但我们需要的是模糊匹配
