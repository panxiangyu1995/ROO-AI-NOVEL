export function getCodebaseSearchDescription(): string {
	return `## codebase_search
Description: 在小说项目中查找与搜索查询最相关的内容。\n这是一个语义搜索工具，可以基于语义匹配而非仅仅关键词来查找相关内容。\n如果需要只在特定目录中搜索，请在path参数中指定。\n除非有明确理由使用自己的搜索查询，否则请直接使用用户的确切查询及其措辞。\n用户的确切措辞通常对语义搜索查询很有帮助。保持相同的问题格式也很有帮助。\n重要：查询必须使用英语。在搜索前请将非英语查询翻译为英语。
Parameters:
- query: (required) 用于查找相关内容的搜索查询。除非有明确理由不这样做，否则应重用用户的确切查询/最近消息及其措辞。
- path: (optional) 相对于当前工作目录要搜索的目录路径。此参数应该只是一个目录路径，不支持文件路径。默认为当前工作目录。
Usage:
<codebase_search>
<query>Your natural language query here</query>
<path>Path to the directory to search in (optional)</path>
</codebase_search>

Example: 搜索与特定角色相关的内容
<codebase_search>
<query>关于主角王小明的性格描述和背景故事</query>
<path>/novels/fantasy</path>
</codebase_search>
`
}
