// 修复导入错误 - 触发文件重新加载
import * as vscode from "vscode"
import * as path from "path"
import * as fsPromises from "fs/promises"

import { Task } from "../task/Task"
import {
	ToolUse,
	AskApproval,
	HandleError,
	PushToolResult,
	RemoveClosingTag,
	NovelAnalysisToolUse,
} from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { CodeIndexManager } from "../../services/code-index/manager"
import { novelContentSearchTool } from "./novelContentSearchTool"

// 分析类型枚举
export enum AnalysisType {
	GENRE = "genre", // 小说类型分析
	WORLDVIEW = "worldview", // 世界观分析
	CHARACTER = "character", // 角色关系分析
	PLOT = "plot", // 情节结构分析
	STYLE = "style", // 写作风格分析
	THEME = "theme", // 主题探索分析
	FULL = "full", // 完整分析（包含所有类型）
}

/**
 * 小说分析工具 - 分析小说的类型、世界观、角色关系、情节结构、写作风格和主题
 */
export async function novelAnalysisTool(
	cline: Task,
	block: NovelAnalysisToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	try {
		// 检查当前模式是否为分析模式
		const { mode } = (await cline.providerRef.deref()?.getState()) || {}
		if (mode !== "analysis") {
			const errorMessage = "小说分析工具只能在分析模式下使用。请使用 switch_mode 工具切换到分析模式。"
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		// 检查是否提供了路径参数
		let relPath = block.params.path

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
				"请提供要分析的小说文件名。例如：novel_analysis path=我的小说.md 或者使用@引用：@我的小说.md",
			)
			pushToolResult("未提供文件路径，请在对话中提供文件名。")
			return
		}

		const analysisType = (removeClosingTag("type", block.params.type) || "full") as AnalysisType
		const title = removeClosingTag("title", block.params.title) || "未命名小说"

		// 创建默认输出路径
		const fileNameWithoutExt = path.basename(relPath).replace(/\.[^/.]+$/, "")
		const analysisTypeName = getAnalysisTypeDisplayName(analysisType as AnalysisType).replace(/分析$/, "")
		const outputPath = block.params.output_path || `${fileNameWithoutExt}_${analysisTypeName}分析.md`

		// 告知用户使用的源文件和输出路径
		await cline.say("text", `将分析文件: ${relPath}，分析结果将保存到: ${outputPath}`)

		// 处理部分工具使用
		if (block.partial) {
			const partialMessageProps = {
				tool: "novel_analysis" as const,
				path: getReadablePath(cline.cwd, relPath),
				type: analysisType,
				title: title,
			}
			await cline.ask("tool", JSON.stringify(partialMessageProps), block.partial).catch(() => {})
			return
		}

		// 验证文件是否存在
		const absolutePath = path.resolve(cline.cwd, relPath)
		const fileExists = await fileExistsAtPath(absolutePath)

		if (!fileExists) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("novel_analysis")
			const formattedError = formatResponse.toolError(
				`文件不存在：${absolutePath}\n找不到指定文件。请检查文件路径并重试。`,
			)
			await cline.say("error", formattedError)
			pushToolResult(formattedError)
			return
		}

		// 验证访问权限
		const accessAllowed = cline.rooIgnoreController?.validateAccess(relPath)
		if (!accessAllowed) {
			await cline.say("rooignore_error", relPath)
			pushToolResult(formatResponse.rooIgnoreError(relPath))
			return
		}

		// 重置连续错误计数
		cline.consecutiveMistakeCount = 0

		// 读取源文件内容
		let sourceContent = ""
		try {
			// 获取文件状态以检查文件大小
			const stats = await fsPromises.stat(absolutePath)
			const fileSize = stats.size

			// 如果文件大小超过15KB，使用novelContentSearchTool进行处理
			if (fileSize > 15 * 1024) {
				await cline.say(
					"text",
					`文件较大（${(fileSize / 1024 / 1024).toFixed(2)} MB），将使用优化的处理技术进行分析。`,
				)

				// 创建一个novelContentSearch工具的参数对象
				const novelSearchBlock = {
					name: "novel_content_search" as const,
					params: {
						query: `分析小说《${title || path.basename(relPath, path.extname(relPath))}》的${getAnalysisTypeDisplayName(analysisType as AnalysisType)}`,
						path: relPath,
						type: analysisType === AnalysisType.FULL ? "general" : analysisType,
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
				return
			}

			// 如果文件较小，直接读取全部内容
			sourceContent = await fsPromises.readFile(absolutePath, "utf-8")
		} catch (error) {
			const errorMessage = `无法读取源文件：${relPath}，错误：${error instanceof Error ? error.message : String(error)}`
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		if (!sourceContent) {
			const errorMessage = `源文件为空：${relPath}`
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		// 提取小说标题
		const novelTitle = title || extractNovelTitle(sourceContent)

		// 生成分析内容
		let analysisContent = ""

		// 使用 AI 生成分析内容
		const analysisPrompt = generateAnalysisPrompt(analysisType, sourceContent, novelTitle)

		// 创建一个临时的用户消息并获取响应
		const tempMessages = [{ role: "user" as const, content: analysisPrompt }]
		let analysisResponse = ""

		try {
			// 创建消息流
			const stream = cline.api.createMessage("", tempMessages)

			// 处理流中的内容
			for await (const chunk of stream) {
				if (chunk && typeof chunk === "string") {
					analysisResponse += chunk
				}
			}

			// 格式化分析内容
			analysisContent = formatAnalysisContent(analysisType, novelTitle, analysisResponse)
		} catch (error) {
			console.error("获取分析响应时出错:", error)
			const errorMessage = `生成分析内容失败：${error instanceof Error ? error.message : String(error)}`
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		// 写入分析结果到输出文件
		const absoluteOutputPath = path.resolve(cline.cwd, outputPath)
		const outputDir = path.dirname(absoluteOutputPath)

		try {
			// 确保输出目录存在
			await fsPromises.mkdir(outputDir, { recursive: true })

			// 写入分析结果
			await fsPromises.writeFile(absoluteOutputPath, analysisContent, "utf-8")

			// 跟踪文件编辑操作
			await cline.fileContextTracker.trackFileContext(outputPath, "roo_edited" as RecordSource)

			// 返回成功消息
			const successMessage = `小说分析完成！分析结果已保存到：${getReadablePath(cline.cwd, outputPath)}`
			await cline.say("text", successMessage)
			pushToolResult(successMessage)
		} catch (error) {
			const errorMessage = `写入分析结果失败：${error instanceof Error ? error.message : String(error)}`
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
		}
	} catch (error) {
		await handleError("小说分析", error instanceof Error ? error : new Error(String(error)))
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
 * 生成分析提示
 */
function generateAnalysisPrompt(type: AnalysisType, content: string, title: string): string {
	const maxContentLength = 10000 // 限制内容长度
	const truncatedContent = content.substring(0, maxContentLength)

	switch (type) {
		case AnalysisType.GENRE:
			return `分析以下小说《${title}》内容，确定其所属的文学类型或流派，并详细说明判断依据：\n\n${truncatedContent}`
		case AnalysisType.WORLDVIEW:
			return `分析以下小说《${title}》内容，提取并详细描述其世界观设定、背景规则和独特元素：\n\n${truncatedContent}`
		case AnalysisType.CHARACTER:
			return `分析以下小说《${title}》内容，识别主要角色，并详细描述他们的特点、动机和相互关系：\n\n${truncatedContent}`
		case AnalysisType.PLOT:
			return `分析以下小说《${title}》内容，识别其情节结构、关键转折点、冲突设置和叙事节奏：\n\n${truncatedContent}`
		case AnalysisType.STYLE:
			return `分析以下小说《${title}》内容，识别作者的语言风格、叙事技巧和修辞特点：\n\n${truncatedContent}`
		case AnalysisType.THEME:
			return `分析以下小说《${title}》内容，探索其核心主题、隐含意义和哲学思考：\n\n${truncatedContent}`
		case AnalysisType.FULL:
		default:
			return `对小说《${title}》进行全面分析，包括：
1. 小说类型与流派
2. 世界观与背景设定
3. 角色特点与关系
4. 情节结构与叙事节奏
5. 写作风格与技巧
6. 核心主题与深层含义

请提供详细分析，并在适当位置引用原文内容作为支持：\n\n${truncatedContent}`
	}
}

/**
 * 格式化分析内容
 */
function formatAnalysisContent(type: AnalysisType, title: string, analysisResponse: string): string {
	switch (type) {
		case AnalysisType.GENRE:
			return `# ${title} - 小说类型分析\n\n## 小说类型分析\n\n${analysisResponse}\n`
		case AnalysisType.WORLDVIEW:
			return `# ${title} - 世界观分析\n\n## 世界观分析\n\n${analysisResponse}\n`
		case AnalysisType.CHARACTER:
			return `# ${title} - 角色关系分析\n\n## 角色关系分析\n\n${analysisResponse}\n\n## 角色关系图\n\n请根据以上分析绘制角色关系图。\n`
		case AnalysisType.PLOT:
			return `# ${title} - 情节结构分析\n\n## 情节结构分析\n\n${analysisResponse}\n\n## 情节发展曲线\n\n请根据以上分析绘制情节发展曲线图。\n`
		case AnalysisType.STYLE:
			return `# ${title} - 写作风格分析\n\n## 写作风格分析\n\n${analysisResponse}\n`
		case AnalysisType.THEME:
			return `# ${title} - 主题探索分析\n\n## 主题探索分析\n\n${analysisResponse}\n`
		case AnalysisType.FULL:
		default:
			return `# ${title} - 小说全面分析报告\n\n## 引言\n\n本报告对《${title}》进行了全面分析，包括小说类型、世界观设定、角色关系、情节结构、写作风格和主题探索等方面。\n\n${analysisResponse}\n\n## 结论\n\n通过以上分析，我们可以更全面地理解《${title}》的艺术价值和文学意义。`
	}
}

/**
 * 获取分析类型的显示名称
 */
function getAnalysisTypeDisplayName(type: AnalysisType): string {
	const displayNames: Record<AnalysisType, string> = {
		[AnalysisType.GENRE]: "类型分析",
		[AnalysisType.WORLDVIEW]: "世界观分析",
		[AnalysisType.CHARACTER]: "角色关系分析",
		[AnalysisType.PLOT]: "情节结构分析",
		[AnalysisType.STYLE]: "写作风格分析",
		[AnalysisType.THEME]: "主题探索分析",
		[AnalysisType.FULL]: "全面分析",
	}

	return displayNames[type] || "分析"
}
