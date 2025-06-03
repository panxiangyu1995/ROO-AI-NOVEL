export function getNovelContentSearchDescription(): string {
	return `## novel_content_search
Description: 在单个小说文件中进行语义搜索，查找与查询相关的内容。这个工具专门用于处理单个长篇小说文件，能够智能分块并进行语义搜索。如果需要搜索整个项目中的多个文件，请使用 codebase_search 工具。
Parameters:
- query: (required) 搜索查询，描述您想要查找的内容
- path: (required) 要搜索的小说文件路径
- type: (optional) 搜索类型，可选值：
  * character - 搜索角色相关内容
  * plot - 搜索情节相关内容
  * setting - 搜索世界设定相关内容
  * theme - 搜索主题相关内容
  * dialogue - 搜索对话内容
  * general - 通用搜索（默认）

Usage:
<novel_content_search>
<query>您的自然语言查询</query>
<path>小说文件路径</path>
<type>搜索类型（可选）</type>
</novel_content_search>

Example: 搜索小说中关于特定角色的描述
<novel_content_search>
<query>主角王小明的性格特点</query>
<path>novels/my_novel.txt</path>
<type>character</type>
</novel_content_search>

注意：此工具仅适用于单个文件的内容搜索。如果您想搜索整个项目中的多个文件，或者不确定内容在哪个文件中，请使用 codebase_search 工具。`
}
