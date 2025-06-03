# 项目修改日志

## 2025年6月1日22:48:21

### 项目名称修改

- 将项目中所有"Roo Code"替换为"Roo-AINovel"
    - 修改了README.md中的项目名称和描述
    - 修改了webview-ui/src/utils/docLinks.ts中的文档链接和描述
    - 修改了webview-ui/src/stories/Welcome.mdx中的欢迎信息
    - 修改了webview-ui/src/i18n/locales/zh-CN/welcome.json中的欢迎文本
    - 修改了webview-ui/src/i18n/locales/zh-CN/settings.json中的设置文本
    - 修改了webview-ui/src/i18n/locales/zh-CN/mcp.json中的MCP服务描述
    - 修改了webview-ui/src/i18n/locales/zh-CN/chat.json中的聊天界面文本
    - 修改了webview-ui/src/i18n/locales/zh-CN/account.json中的账户文本
    - 修改了src/package.nls.json中的扩展名称和相关描述
    - 修改了src/package.nls.zh-CN.json中的扩展名称和相关描述
    - 修改了src/package.nls.zh-TW.json中的扩展名称和相关描述
    - 修改了src/package.json中的作者名称、GitHub链接和关键词
    - 修改了src/shared/package.ts中的输出通道名称

### 文档链接更新

- 将文档链接从https://docs.roocode.com/更新为https://docs.rooainovel.com/

### 功能增强

- 修改了src/shared/modes.ts，替换了原有的代码模式为小说创作相关模式：
    - 添加了"文字生成模式"(writer)：专注于生成高质量小说章节和内容
    - 添加了"小说框架模式"(planner)：从简短提示词生成完整小说框架
    - 添加了"问答模式"(Ask)：解答写作相关问题
    - 添加了"纠错模式"(editor)：系统化诊断和修正文本问题
    - 添加了"正文优化模式"(optimizer)：全方位优化小说内容
    - 添加了"格式转换模式"(formatter)：将Markdown格式转换为纯文本
    - 添加了"小说分析模式"(analysis)：分析小说类型、结构和风格
    - 添加了"剧本改编模式"(script-mode)：将小说改编为剧本
    - 添加了"仿写模式"(imitation)：模仿特定作者风格创作
    - 添加了"扩写模式"(expansion)：扩展和丰富简要内容
    - 添加了"灵感模式"(inspiration)：提供创意思维和灵感激发
    - 添加了"图文模式"(visual-text)：创建图文混合内容

## 2025年6月1日

### 项目名称变更：从"Roo Code"改为"Roo-AINovel"

#### 修改内容：

1. 更新了 `README.md` 文件中的项目名称
2. 更新了 `webview-ui/src/utils/docLinks.ts` 中的文档链接
3. 更新了 `webview-ui/src/stories/Welcome.mdx` 中的项目名称
4. 更新了以下本地化文件中的项目名称：
    - 中文简体 (zh-CN)：
        - `welcome.json`
        - `settings.json`
        - `mcp.json`
        - `chat.json`
        - `account.json`
    - 中文繁体 (zh-TW)：
        - `welcome.json`
        - `settings.json`
        - `mcp.json`
        - `chat.json`
        - `account.json`
5. 更新了扩展配置文件：
    - `src/package.nls.json`
    - `src/package.nls.zh-CN.json`
    - `src/package.nls.zh-TW.json`
    - `src/package.json`
    - `src/shared/package.ts`
6. 修改了模式配置文件：
    - `src/shared/modes.ts`：将代码相关模式替换为小说创作相关模式

#### 文档链接更新：

- 从 `https://docs.roocode.com/` 改为 `https://docs.rooainovel.com/`

#### 配置项更新：

- 将 `roo-cline.rooCodeCloudEnabled` 更新为 `roo-cline.rooAINovelCloudEnabled`

# 开发日志

## 2023-09-15 漫画生成工具开发

### 新增文件

- `src/core/tools/comicGeneratorTool.ts`: 漫画生成工具的主要实现，提供将文本内容转换为漫画风格的HTML内容的功能
- `src/core/prompts/tools/comic-generator.ts`: 漫画生成工具的描述文件，定义了工具的参数和使用说明
- `src/core/tools/index.ts`: 工具索引文件，注册所有工具，包括新增的漫画生成工具

### 修改文件

- `packages/types/src/tool.ts`: 添加了"comic"工具组和"comic_generator"工具名称，以及新的参数名称（style, layout, panels）
- `src/shared/tools.ts`: 添加了ComicGeneratorToolUse接口定义，在TOOL_GROUPS中添加了comic工具组，在TOOL_DISPLAY_NAMES中添加了comic_generator工具的显示名称
- `src/shared/modes.ts`: 在"Visual Text Mode"中添加了"comic"工具组
- `src/core/prompts/tools/index.ts`: 导入并注册了漫画生成工具的描述函数
- `src/core/assistant-message/presentAssistantMessage.ts`: 添加了对漫画生成工具的处理分支

### 功能说明

漫画生成工具（comic_generator）可以将文本内容转换为漫画风格的HTML内容，具有以下特点：

1. 支持多种漫画风格：日式漫画（manga）、美式漫画（american）、欧式漫画（european）、Q版漫画（chibi）、极简漫画（minimalist）
2. 支持多种布局方式：垂直布局（vertical）、水平布局（horizontal）、网格布局（grid）、自由布局（freeform）
3. 可以指定面板数量（1-20）
4. 自动分析文本内容，提取场景、对话和动作
5. 生成包含SVG图形、对话气泡和动作描述的HTML文件
6. 支持大型内容的分块处理

### 修复记录

- 2023-09-16: 修复了`src/shared/tools.ts`中的类型错误，在本地的`toolParamNames`数组中添加了"style"、"layout"和"panels"参数
- 2023-09-16: 重新创建了`src/core/tools/index.ts`文件，注册所有工具，包括漫画生成工具

### 后续工作

1. 添加漫画生成工具的国际化支持
2. 优化SVG图形生成，提供更多样化的图形元素
3. 增加更多自定义选项，如颜色主题、字体样式等
4. 添加预览功能，允许用户在生成前查看效果
5. 实现图片导出功能，支持将HTML内容导出为图片格式
