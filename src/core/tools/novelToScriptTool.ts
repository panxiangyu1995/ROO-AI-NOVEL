import path from "path"
import fs from "fs/promises"
import vscode from "vscode"

import { Task } from "../task/Task"
import {
	ToolUse,
	AskApproval,
	HandleError,
	PushToolResult,
	RemoveClosingTag,
	NovelToScriptToolUse,
	ToolParamName,
} from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { novelContentSearchTool } from "./novelContentSearchTool"

// 剧本类型枚举
export enum ScriptType {
	MOVIE = "movie", // 电影剧本
	TV = "tv", // 电视剧剧本
	STAGE = "stage", // 舞台剧剧本
	RADIO = "radio", // 广播剧剧本
	SHORT = "short", // 短剧剧本
}

/**
 * 小说转剧本工具 - 将小说内容转换为不同类型的剧本格式
 */
export async function novelToScriptTool(
	cline: Task,
	block: NovelToScriptToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	try {
		// 检查当前模式是否为剧本改编模式
		const currentMode = (await cline.providerRef.deref()?.getState())?.mode
		if (currentMode !== "script_adaptation") {
			const errorMessage = "小说转剧本工具只能在剧本改编模式下使用。请使用 switch_mode 工具切换到剧本改编模式。"
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		// 检查是否提供了路径参数
		let relPath = block.params.path as string | undefined

		// 尝试从文本参数中获取@引用
		if (!relPath && block.params.text) {
			// 搜索文本中的@引用
			const atFileRegex = /@([^\s]+)/g
			const matches = block.params.text.match(atFileRegex)
			if (matches && matches.length > 0) {
				// 提取第一个@引用的文件路径（去除@前缀）
				relPath = matches[0].substring(1)
				// 处理转义的空格
				relPath = relPath.replace(/\\\s/g, " ")
			}
		}

		// 如果没有提供路径参数，提示用户提供
		if (!relPath) {
			await cline.say(
				"text",
				"请提供要转换的小说文件名。例如：novel_to_script path=我的小说.md 或者使用@引用：@我的小说.md",
			)
			pushToolResult("未提供文件路径，请在对话中提供文件名。")
			return
		}

		// 获取剧本类型（默认为电影）和标题参数
		const scriptType = block.params.type || "movie"
		const title = block.params.title || "未命名小说"

		// 创建默认输出路径
		const fileNameWithoutExt = path.basename(relPath).replace(/\.[^/.]+$/, "")
		const outputPath = (block.params.output_path as string) || `${fileNameWithoutExt}_${scriptType}剧本.md`

		// 告知用户使用的源文件和输出路径
		await cline.say(
			"text",
			`将把文件: ${relPath} 转换为${getScriptTypeDisplayName(scriptType as ScriptType)}，结果将保存到: ${outputPath}`,
		)

		// 处理部分工具使用
		if (block.partial) {
			const partialMessageProps = {
				tool: "novel_to_script" as const,
				path: relPath,
				type: scriptType,
				title: title,
			}
			await cline.ask("tool", JSON.stringify(partialMessageProps), block.partial).catch(() => {})
			return
		}

		// 检查文件是否存在
		const fullPath = path.resolve(cline.cwd, relPath)
		const fileExists = await fileExistsAtPath(fullPath)

		if (!fileExists) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("novel_to_script")
			const formattedError = formatResponse.toolError(
				`文件不存在：${fullPath}\n找不到指定文件。请检查文件路径并重试。`,
			)
			await cline.say("error", formattedError)
			pushToolResult(formattedError)
			return
		}

		// 如果用户没有指定剧本类型，询问用户想要转换为哪种类型的剧本
		let finalScriptType = scriptType as ScriptType
		if (!block.params.type) {
			const scriptTypeOptions = Object.values(ScriptType)
				.map((type) => `${type}: ${getScriptTypeDisplayName(type)}`)
				.join("\n")

			const approvalMessage = `请选择要转换的剧本类型:\n${scriptTypeOptions}\n\n默认将使用"movie"(电影剧本)类型。`

			const { response, text } = await cline.ask("tool", approvalMessage)

			if (response === "messageResponse" && text) {
				// 尝试从用户回复中提取剧本类型
				const lowerText = text.toLowerCase()
				for (const type of Object.values(ScriptType)) {
					if (lowerText.includes(type.toLowerCase())) {
						finalScriptType = type
						break
					}
				}
				await cline.say("text", `已选择转换为${getScriptTypeDisplayName(finalScriptType)}`)
			}
		}

		// 重置连续错误计数
		cline.consecutiveMistakeCount = 0

		// 读取源文件内容
		let sourceContent: string
		try {
			// 获取文件状态以检查文件大小
			const stats = await fs.stat(fullPath)
			const fileSize = stats.size

			// 如果文件大小超过15KB，使用novelContentSearchTool进行处理
			if (fileSize > 15 * 1024) {
				await cline.say(
					"text",
					`文件较大（${(fileSize / 1024 / 1024).toFixed(2)} MB），将使用优化的处理技术进行剧本转换。`,
				)

				// 创建一个novelContentSearch工具的参数对象
				const novelSearchBlock = {
					name: "novel_content_search" as const,
					params: {
						query: `将小说《${title || path.basename(relPath, path.extname(relPath))}》转换为${getScriptTypeDisplayName(finalScriptType)}格式`,
						path: relPath,
						type: "general",
					},
					partial: false,
					type: "tool_use" as const,
				}

				// 调用novelContentSearchTool进行处理
				await novelContentSearchTool(
					cline,
					novelSearchBlock,
					askApproval,
					handleError,
					pushToolResult,
					removeClosingTag,
				)

				// 提醒用户可能需要进一步整理剧本
				await cline.say("text", "由于文件较大，转换结果可能需要进一步整理和编辑。")
				return
			}

			// 如果文件较小，直接读取全部内容
			sourceContent = await fs.readFile(fullPath, "utf8")
		} catch (error) {
			const errorMessage = `无法读取源文件：${relPath}，错误：${error.message}`
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		// 提取小说标题
		const novelTitle = title || extractNovelTitle(sourceContent)

		// 直接创建剧本内容字符串
		let scriptContent = ""

		// 添加标题和格式化
		const header = `# 《${novelTitle}》${getScriptTypeDisplayName(finalScriptType)}\n\n`

		try {
			// 使用 AI 生成剧本内容
			const scriptPrompt = `将以下小说内容转换为${getScriptTypeDisplayName(finalScriptType)}格式：\n\n${sourceContent.substring(0, 10000)}`

			// 使用API处理内容
			let scriptResponse = ""

			// 创建消息流
			const stream = cline.api.createMessage("", [{ role: "user" as const, content: scriptPrompt }])

			// 使用字符串连接处理API响应
			for await (const chunk of stream) {
				// 确保chunk是字符串类型
				if (chunk && typeof chunk === "string") {
					scriptResponse += chunk
				} else if (chunk && typeof chunk === "object" && "content" in chunk) {
					// 处理可能的对象格式响应
					const content = chunk.content
					if (typeof content === "string") {
						scriptResponse += content
					}
				}
			}

			// 如果 AI 没有生成足够的内容，使用模板
			if (!scriptResponse || scriptResponse.length < 100) {
				switch (finalScriptType) {
					case ScriptType.MOVIE:
						scriptContent = header + generateMovieScriptTemplate(novelTitle)
						break
					case ScriptType.TV:
						scriptContent = header + generateTVScriptTemplate(novelTitle)
						break
					case ScriptType.STAGE:
						scriptContent = header + generateStageScriptTemplate(novelTitle)
						break
					case ScriptType.RADIO:
						scriptContent = header + generateRadioScriptTemplate(novelTitle)
						break
					case ScriptType.SHORT:
						scriptContent = header + generateShortScriptTemplate(novelTitle)
						break
					default:
						scriptContent = header + generateMovieScriptTemplate(novelTitle)
						break
				}
			} else {
				scriptContent = header + scriptResponse
			}
		} catch (error) {
			console.error("生成剧本内容时出错:", error)
			scriptContent = header + generateMovieScriptTemplate(novelTitle)
		}

		// 确保输出目录存在
		try {
			const outputDir = path.dirname(path.resolve(cline.cwd, outputPath))
			await fs.mkdir(outputDir, { recursive: true })
		} catch (error) {
			// 忽略目录已存在的错误
			if (error.code !== "EEXIST") {
				const errorMessage = `创建输出目录失败：${error.message}`
				await cline.say("error", errorMessage)
				pushToolResult(errorMessage)
				return
			}
		}

		// 写入剧本结果到输出文件
		try {
			const fullOutputPath = path.resolve(cline.cwd, outputPath)
			await fs.writeFile(fullOutputPath, scriptContent)
		} catch (error) {
			const errorMessage = `写入剧本结果失败：${error.message}`
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		// 返回成功消息
		const successMessage = `小说转剧本完成！${getScriptTypeDisplayName(finalScriptType)}已保存到：${outputPath}`
		await cline.say("text", successMessage)
		pushToolResult(successMessage)
	} catch (error) {
		await handleError("转换剧本", error)
	}
}

/**
 * 从内容中提取小说标题
 */
function extractNovelTitle(content: string): string {
	// 尝试从内容的第一行或者 # 标题中提取
	const lines = content.split("\n")

	// 查找 Markdown 标题
	for (const line of lines) {
		const titleMatch = line.match(/^#\s+(.+)$/)
		if (titleMatch) {
			return titleMatch[1].trim()
		}
	}

	// 如果没有找到 Markdown 标题，使用第一行非空文本
	for (const line of lines) {
		const trimmedLine = line.trim()
		if (trimmedLine) {
			return trimmedLine
		}
	}

	return "未命名小说"
}

/**
 * 获取剧本类型的显示名称
 */
function getScriptTypeDisplayName(type: ScriptType): string {
	const displayNames: Record<ScriptType, string> = {
		[ScriptType.MOVIE]: "电影剧本",
		[ScriptType.TV]: "电视剧剧本",
		[ScriptType.STAGE]: "舞台剧剧本",
		[ScriptType.RADIO]: "广播剧剧本",
		[ScriptType.SHORT]: "短剧剧本",
	}

	return displayNames[type] || "剧本"
}

/**
 * 生成电影剧本模板
 */
function generateMovieScriptTemplate(title: string): string {
	return `
## 电影剧本格式

**片名：《${title}》**

**作者：**

**改编自：原著小说《${title}》**

**联系方式：**

---

## 场景列表

1. [场景简述]
2. [场景简述]
3. [场景简述]
...

---

## 正文

### 1. 外景 - [场景位置] - [时间]

[场景描述，包括环境、氛围、重要道具等]

**角色A**
(动作描述)
对白内容

**角色B**
(动作描述)
对白内容

[转场说明]

### 2. 内景 - [场景位置] - [时间]

[场景描述]

**角色C**
(动作描述)
对白内容

**旁白**
旁白内容

[转场说明]

---

## 场景统计

- 总场景数：
- 外景场景数：
- 内景场景数：
- 主要角色出场频率：
  - 角色A：
  - 角色B：
  - 角色C：
`
}

/**
 * 生成电视剧剧本模板
 */
function generateTVScriptTemplate(title: string): string {
	return `
## 电视剧剧本格式

**剧名：《${title}》**

**集数：第X集**

**作者：**

**改编自：原著小说《${title}》**

**联系方式：**

---

## 本集概要

[简要描述本集内容]

---

## 场景列表

1. [场景简述]
2. [场景简述]
3. [场景简述]
...

---

## 正文

### 1. 外景 - [场景位置] - [时间]

[场景描述，包括环境、氛围、重要道具等]

**角色A**
(动作描述)
对白内容

**角色B**
(动作描述)
对白内容

[转场说明]

### 2. 内景 - [场景位置] - [时间]

[场景描述]

**角色C**
(动作描述)
对白内容

**旁白**
旁白内容

[转场说明]

---

## 下集预告

[简要描述下一集内容]

---

## 场景统计

- 总场景数：
- 外景场景数：
- 内景场景数：
- 主要角色出场频率：
  - 角色A：
  - 角色B：
  - 角色C：
`
}

/**
 * 生成舞台剧剧本模板
 */
function generateStageScriptTemplate(title: string): string {
	return `
## 舞台剧剧本格式

**剧名：《${title}》**

**作者：**

**改编自：原著小说《${title}》**

**联系方式：**

---

## 人物表

- **角色A**：[角色描述]
- **角色B**：[角色描述]
- **角色C**：[角色描述]
...

---

## 场景设计

[舞台布景、灯光、音效等总体说明]

---

## 第一幕

### 场景一

[场景描述，包括布景、灯光、音效等]

**角色A**
(动作描述)
对白内容

**角色B**
(动作描述)
对白内容

[舞台指示]

### 场景二

[场景描述]

**角色C**
(动作描述)
对白内容

[舞台指示]

## 第二幕

### 场景一

[场景描述]

**角色A**
(动作描述)
对白内容

[舞台指示]

---

## 演出建议

[对演出的总体建议，包括演员选择、舞台效果等]

---

## 场景统计

- 总幕数：
- 总场景数：
- 主要角色出场频率：
  - 角色A：
  - 角色B：
  - 角色C：
`
}

/**
 * 生成广播剧剧本模板
 */
function generateRadioScriptTemplate(title: string): string {
	return `
## 广播剧剧本格式

**剧名：《${title}》**

**集数：第X集**

**作者：**

**改编自：原著小说《${title}》**

**联系方式：**

---

## 本集概要

[简要描述本集内容]

---

## 音效说明

- **音效1**：[描述]
- **音效2**：[描述]
- **背景音乐1**：[描述]
...

---

## 正文

**旁白**
[旁白内容]

**音效**
[音效描述]

**角色A**
(情绪/语气提示)
对白内容

**角色B**
(情绪/语气提示)
对白内容

**背景音乐**
[音乐描述]

**旁白**
[旁白内容]

---

## 下集预告

[简要描述下一集内容]

---

## 统计

- 总时长：
- 对白数量：
- 音效数量：
- 主要角色出场频率：
  - 角色A：
  - 角色B：
  - 角色C：
`
}

/**
 * 生成短剧剧本模板
 */
function generateShortScriptTemplate(title: string): string {
	return `
## 短剧剧本格式

**剧名：《${title}》**

**时长：X分钟**

**作者：**

**改编自：原著小说《${title}》**

**联系方式：**

---

## 剧情概要

[简要描述剧情内容]

---

## 场景列表

1. [场景简述]
2. [场景简述]
...

---

## 正文

### 1. 外景/内景 - [场景位置] - [时间]

[场景描述，简洁明了]

**角色A**
(动作描述)
对白内容

**角色B**
(动作描述)
对白内容

[转场说明]

### 2. 外景/内景 - [场景位置] - [时间]

[场景描述]

**角色A**
(动作描述)
对白内容

---

## 拍摄建议

[对拍摄的建议，包括镜头、节奏等]

---

## 统计

- 总场景数：
- 预计时长：
- 主要角色出场频率：
  - 角色A：
  - 角色B：
`
}
