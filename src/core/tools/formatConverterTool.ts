import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { Task } from "../task/Task"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath } from "../../utils/fs"
import { getWorkspacePath, getReadablePath } from "../../utils/path"
import { formatResponse } from "../prompts/responses"
import { askFollowupQuestionTool } from "./askFollowupQuestionTool"
import { newTaskTool } from "./newTaskTool"

/**
 * 移除Markdown格式
 * 清理各种Markdown标记，保留纯文本内容
 */
function removeMarkdownFormatting(content: string): string {
	// 移除标题标记
	let result = content.replace(/^#+\s+(.*)$/gm, "$1")

	// 移除粗体和斜体
	result = result.replace(/\*\*(.*?)\*\*/g, "$1")
	result = result.replace(/\*(.*?)\*/g, "$1")
	result = result.replace(/__(.*?)__/g, "$1")
	result = result.replace(/_(.*?)_/g, "$1")

	// 移除引用
	result = result.replace(/^>\s+(.*)$/gm, "$1")

	// 移除列表标记
	result = result.replace(/^[\*\-+]\s+(.*)$/gm, "$1")
	result = result.replace(/^\d+\.\s+(.*)$/gm, "$1")

	// 移除代码块
	result = result.replace(/```[\s\S]*?```/g, "")
	result = result.replace(/`(.*?)`/g, "$1")

	// 移除链接
	result = result.replace(/\[(.*?)\]\(.*?\)/g, "$1")

	// 移除图片
	result = result.replace(/!\[(.*?)\]\(.*?\)/g, "")

	// 移除水平线
	result = result.replace(/^---+$/gm, "")
	result = result.replace(/^===+$/gm, "")
	result = result.replace(/^\*\*\*+$/gm, "")

	return result
}

/**
 * 移除注释
 * 清理HTML注释和其他非内容元素
 */
function removeComments(content: string): string {
	// 移除HTML注释（包括多行注释）
	let result = content.replace(/<!--[\s\S]*?-->/g, "")

	// 移除行内注释
	result = result.replace(/\/\/.*/g, "")

	// 移除多行注释
	result = result.replace(/\/\*[\s\S]*?\*\//g, "")

	// 移除novel_comment工具使用痕迹
	result = result.replace(/<novel_comment[\s\S]*?\/>/g, "")

	// 移除空行（连续的换行符）
	result = result.replace(/\n{3,}/g, "\n\n")

	return result
}

/**
 * 转换Markdown文件为TXT格式
 */
function convertMarkdownToText(content: string, preserveParagraphs: boolean): string {
	// 提取章节标题
	const titleMatch = content.match(/^#+\s+(.*)$/m)
	const title = titleMatch ? titleMatch[1] : "无标题章节"

	// 处理内容
	let processedContent = content

	// 移除Markdown格式
	processedContent = removeMarkdownFormatting(processedContent)

	// 移除注释
	processedContent = removeComments(processedContent)

	// 分割段落并重新格式化
	const paragraphs = processedContent
		.split(/\n+/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0)

	// 组装最终内容
	if (preserveParagraphs) {
		// 使用双换行分隔段落
		return [title, ...paragraphs].join("\n\n")
	} else {
		// 连续文本，段落之间只有一个换行
		return [title, ...paragraphs].join("\n")
	}
}

/**
 * 分析文本内容，获取章节数量和行数
 */
function analyzeContent(content: string): ContentAnalysis {
	// 计算行数
	const lineCount = content.split("\n").length

	// 识别章节（通过标题标记如 # 第X章 或 ## 章节名）
	const chapterRegex = /^#+\s*(第[一二三四五六七八九十百千万\d]+[章节卷集部]|Chapter\s*\d+|CHAPTER\s*\d+)/gm
	const chapterMatches = content.match(chapterRegex)
	const chapterCount = chapterMatches ? chapterMatches.length : 0

	return {
		chapterCount,
		lineCount,
	}
}

/**
 * 确定是否需要拆分子任务以及子任务数量
 */
function determineSubTaskNeeds(chapterCount: number, lineCount: number): SubTaskNeeds {
	// 如果有章节，根据章节数量决定
	if (chapterCount > 0) {
		if (chapterCount === 1) {
			return {
				needsSubtasks: false,
				subTaskCount: 1,
				subTaskReason: "单章节内容",
			}
		} else {
			return {
				needsSubtasks: true,
				subTaskCount: chapterCount,
				subTaskReason: `${chapterCount}个章节`,
			}
		}
	}
	// 如果没有章节，根据行数决定
	else {
		if (lineCount < 2000) {
			return {
				needsSubtasks: false,
				subTaskCount: 1,
				subTaskReason: "行数较少",
			}
		} else {
			// 每250行作为一个子任务
			const taskCount = Math.ceil(lineCount / 250)
			return {
				needsSubtasks: true,
				subTaskCount: taskCount,
				subTaskReason: `${lineCount}行文本`,
			}
		}
	}
}

/**
 * 批量处理文件
 */
async function batchProcessFiles(
	sourcePaths: string[],
	outputDir: string,
	mergeFiles: boolean = false,
	preserveParagraphs: boolean = true,
): Promise<string[]> {
	// 确保输出目录存在
	await fs.promises.mkdir(outputDir, { recursive: true })

	// 读取并处理所有文件
	const processedContents: { path: string; content: string }[] = []

	for (const sourcePath of sourcePaths) {
		try {
			const content = await fs.promises.readFile(sourcePath, "utf8")
			const formattedContent = convertMarkdownToText(content, preserveParagraphs)

			if (mergeFiles) {
				// 收集内容以便后续合并
				processedContents.push({
					path: sourcePath,
					content: formattedContent,
				})
			} else {
				// 直接保存单个文件
				const fileName = path.basename(sourcePath, path.extname(sourcePath)) + ".txt"
				const outputPath = path.join(outputDir, fileName)
				await fs.promises.writeFile(outputPath, formattedContent, "utf8")
			}
		} catch (error) {
			console.error(`处理文件 ${sourcePath} 时出错:`, error)
			throw error
		}
	}

	// 如果需要合并文件
	if (mergeFiles && processedContents.length > 0) {
		// 按文件名排序
		processedContents.sort((a, b) => {
			const nameA = path.basename(a.path)
			const nameB = path.basename(b.path)
			return nameA.localeCompare(nameB)
		})

		// 合并内容
		const mergedContent = processedContents.map((item) => item.content).join("\n\n===========\n\n")
		const outputPath = path.join(outputDir, "merged_novel.txt")
		await fs.promises.writeFile(outputPath, mergedContent, "utf8")

		return [outputPath]
	}

	// 返回处理后的文件路径
	return sourcePaths.map((sourcePath) => {
		const fileName = path.basename(sourcePath, path.extname(sourcePath)) + ".txt"
		return path.join(outputDir, fileName)
	})
}

/**
 * 查找当前工作目录下的所有Markdown文件
 */
async function findMarkdownFiles(workspaceRoot: string): Promise<string[]> {
	try {
		// 获取当前打开的文件
		const activeEditor = vscode.window.activeTextEditor
		if (activeEditor && activeEditor.document.fileName.toLowerCase().endsWith(".md")) {
			// 如果有打开的Markdown文件，优先处理它
			return [activeEditor.document.fileName]
		}

		// 否则查找当前目录下的所有Markdown文件
		const files = await vscode.workspace.findFiles("**/*.md", "**/node_modules/**")
		if (files.length === 0) {
			throw new Error("未找到任何Markdown文件")
		}

		return files.map((file) => file.fsPath)
	} catch (error) {
		throw new Error(`查找Markdown文件失败: ${error.message}`)
	}
}

/**
 * 格式转换工具主函数
 * 将Markdown文件转换为纯文本格式
 */
export async function formatConverterTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	try {
		// 检查当前模式是否为格式转换模式
		const provider = cline.providerRef.deref()
		const state = provider ? await provider.getState() : null
		const currentMode = state?.mode ?? ""

		if (currentMode !== "formatter") {
			pushToolResult(
				formatResponse.toolError("此工具只能在格式转换模式(formatter)下使用。请先切换到格式转换模式。"),
			)
			return
		}

		// 提取参数
		const sourcePath = block.params?.path
		const outputDir = block.params?.output_dir
		const mergeFiles = block.params?.merge === "true" || Boolean(block.params?.merge)
		const preserveParagraphs = block.params?.preserve_paragraphs !== "false"

		if (block.partial) {
			return
		}

		// 获取工作区根路径
		const rootPath = getWorkspacePath()
		if (!rootPath) {
			pushToolResult(formatResponse.toolError("未找到工作区根路径"))
			return
		}

		// 如果未提供源路径，自动查找当前工作目录下的Markdown文件
		let sourcePaths: string[] = []

		if (!sourcePath) {
			try {
				sourcePaths = await findMarkdownFiles(rootPath)
				if (sourcePaths.length === 0) {
					pushToolResult(formatResponse.toolError("未找到任何Markdown文件。请指定path参数。"))
					return
				}
			} catch (error) {
				pushToolResult(formatResponse.toolError(`自动查找Markdown文件失败: ${error.message}。请指定path参数。`))
				return
			}
		} else {
			// 构建完整文件路径
			const fullPath = path.isAbsolute(sourcePath) ? sourcePath : path.join(rootPath, sourcePath)

			// 检查是否是目录
			try {
				const stats = await fs.promises.stat(fullPath)
				if (stats.isDirectory()) {
					// 读取目录中的所有.md文件
					const files = await fs.promises.readdir(fullPath)
					sourcePaths = files
						.filter((file) => file.toLowerCase().endsWith(".md"))
						.map((file) => path.join(fullPath, file))
				} else {
					// 单个文件
					if (!fullPath.toLowerCase().endsWith(".md")) {
						pushToolResult(formatResponse.toolError("只支持转换Markdown(.md)文件"))
						return
					}
					sourcePaths = [fullPath]
				}
			} catch (error) {
				pushToolResult(formatResponse.toolError(`无法访问路径: ${sourcePath}`))
				return
			}
		}

		if (sourcePaths.length === 0) {
			pushToolResult(formatResponse.toolError(`没有找到匹配的Markdown文件`))
			return
		}

		// 确保所有路径都是绝对路径
		sourcePaths = sourcePaths.map((p) => (path.isAbsolute(p) ? p : path.join(rootPath, p)))

		// 如果未提供输出目录，使用源文件所在的目录
		let targetOutputDir: string
		if (!outputDir) {
			// 获取第一个文件的目录
			targetOutputDir = path.dirname(sourcePaths[0])
		} else {
			targetOutputDir = path.isAbsolute(outputDir) ? outputDir : path.join(rootPath, outputDir)
		}

		// 检查文件是否存在
		for (const p of sourcePaths) {
			if (!(await fileExistsAtPath(p))) {
				pushToolResult(formatResponse.toolError(`文件不存在: ${getReadablePath(rootPath, p)}`))
				return
			}
		}

		// 如果是单个文件，分析其内容以确定是否需要子任务
		if (sourcePaths.length === 1) {
			const content = await fs.promises.readFile(sourcePaths[0], "utf8")

			// 分析文本内容，获取章节数量和行数
			const { chapterCount, lineCount } = analyzeContent(content)

			// 确定是否需要拆分子任务
			const { needsSubtasks, subTaskCount, subTaskReason } = determineSubTaskNeeds(chapterCount, lineCount)

			// 如果需要子任务，询问用户
			if (needsSubtasks) {
				// 创建一个用于ask_followup_question的工具使用块
				const followupBlock = {
					type: "tool_use" as const,
					name: "ask_followup_question" as const,
					params: {
						question: `检测到该文件包含${subTaskReason}，建议创建${subTaskCount}个子任务进行处理。您是否希望：\n\n1. 创建子任务分段处理\n2. 直接处理整个文件`,
					},
					partial: false,
				}

				await askFollowupQuestionTool(
					cline,
					followupBlock,
					askApproval,
					handleError,
					async (result) => {
						if (
							result &&
							typeof result === "string" &&
							(result.includes("1") ||
								result.toLowerCase().includes("创建子任务") ||
								result.toLowerCase().includes("分段处理"))
						) {
							// 用户选择创建子任务
							const taskMessage = `继续转换文件 ${getReadablePath(rootPath, sourcePaths[0])} 为纯文本格式。将分为${subTaskCount}个子任务处理，基于${subTaskReason}。`
							const taskBlock = {
								type: "tool_use" as const,
								name: "new_task" as const,
								params: {
									mode: "formatter",
									message: taskMessage,
								},
								partial: false,
							}

							// 调用newTaskTool创建子任务
							await newTaskTool(
								cline,
								taskBlock,
								askApproval,
								handleError as any,
								(result) => {
									pushToolResult(
										`已创建格式转换子任务。将根据${subTaskReason}分为${subTaskCount}个子任务进行处理。输出目录：${getReadablePath(rootPath, targetOutputDir)}`,
									)
								},
								removeClosingTag,
							)
						} else {
							// 用户选择直接处理
							await processFiles()
						}
					},
					removeClosingTag,
				)
			} else {
				// 不需要子任务，直接处理
				await processFiles()
			}
		} else {
			// 多个文件，直接处理
			await processFiles()
		}

		// 处理文件的函数
		async function processFiles() {
			// 请求用户批准
			const fileList = sourcePaths.map((p) => getReadablePath(rootPath, p)).join("\n- ")
			const approvalMessage = JSON.stringify({
				tool: "format_converter",
				sourcePaths: sourcePaths.map((p) => getReadablePath(rootPath, p)),
				outputDir: getReadablePath(rootPath, targetOutputDir),
				mergeFiles: mergeFiles,
				preserveParagraphs: preserveParagraphs,
			})
			const approved = await askApproval("tool", approvalMessage)

			if (!approved) {
				pushToolResult("用户拒绝了格式转换操作。")
				return
			}

			// 执行格式转换
			const outputPaths = await batchProcessFiles(sourcePaths, targetOutputDir, mergeFiles, preserveParagraphs)

			// 跟踪文件操作
			for (const p of outputPaths) {
				await cline.fileContextTracker.trackFileContext(p, "roo_edited" as RecordSource)
			}

			// 返回结果
			const resultMessage = mergeFiles
				? `已将 ${sourcePaths.length} 个Markdown文件合并并转换为纯文本格式，保存至: ${getReadablePath(rootPath, outputPaths[0])}`
				: `已将 ${sourcePaths.length} 个Markdown文件转换为纯文本格式，保存在目录: ${getReadablePath(rootPath, targetOutputDir)}`

			pushToolResult(resultMessage)
		}

		return
	} catch (error) {
		await handleError("converting format", error)
		return
	}
}

/**
 * 内容分析接口
 */
interface ContentAnalysis {
	chapterCount: number
	lineCount: number
}

/**
 * 子任务需求接口
 */
interface SubTaskNeeds {
	needsSubtasks: boolean
	subTaskCount: number
	subTaskReason: string
}
