import * as path from "path"
import * as vscode from "vscode"
import * as fs from "fs/promises"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import {
	ToolUse,
	AskApproval,
	HandleError,
	PushToolResult,
	RemoveClosingTag,
	ContentExpansionToolUse,
	ToolParamName,
} from "../../shared/tools"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { askFollowupQuestionTool } from "./askFollowupQuestionTool"
import { novelCommentTool } from "./novelCommentTool"
import { newTaskTool } from "./newTaskTool"

/**
 * 内容扩展工具
 * 提供文本扩写选项，并根据章节数量或行数进行任务拆分
 */
export async function contentExpansionTool(
	cline: Task,
	block: ContentExpansionToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	try {
		// 检查当前模式是否为扩展模式
		const provider = cline.providerRef.deref()
		const state = provider ? await provider.getState() : null
		const currentMode = state?.mode ?? ""

		if (currentMode !== "expansion") {
			await cline.say("text", "请先切换到内容扩展模式(expansion)再使用此工具。")
			pushToolResult(formatResponse.toolError("此工具只能在内容扩展模式下使用。"))
			return
		}

		// 提取参数
		const sourcePath = block.params.path || ""
		const ratio = block.params.ratio || "2" // 默认扩写比例为2倍
		const outputPath = block.params.output_path
		const useComments = block.params.use_comments === "true" || false // 是否使用注释

		// 如果是部分工具使用，直接返回
		if (block.partial) {
			return
		}

		// 验证源文件路径
		if (!sourcePath) {
			pushToolResult(formatResponse.toolError("请提供源文件路径。"))
			return
		}

		// 获取工作区根路径
		const rootPath = cline.cwd

		// 构建完整文件路径
		const fullPath = path.isAbsolute(sourcePath) ? sourcePath : path.join(rootPath, sourcePath)

		// 检查文件是否存在
		if (!(await fileExistsAtPath(fullPath))) {
			pushToolResult(formatResponse.toolError(`文件不存在: ${sourcePath}`))
			return
		}

		// 读取源文件内容
		const sourceContent = await fs.readFile(fullPath, "utf8")

		// 记录文件访问
		await cline.fileContextTracker.trackFileContext(fullPath, "roo_read" as RecordSource)

		// 分析文本内容，获取章节数量和行数
		const { wordCount, paragraphCount, chapterCount, lineCount } = analyzeContent(sourceContent)

		// 确定是否需要拆分子任务以及拆分的子任务数量
		const { needsSubtasks, subTaskCount, subTaskReason } = determineSubTaskNeeds(chapterCount, lineCount)

		// 构建扩写选项
		const expansionOptions = generateExpansionOptions(wordCount, paragraphCount, parseFloat(ratio))

		// 使用ask_followup_question工具提供选项给用户
		const optionsMessage = formatExpansionOptionsMessage(
			expansionOptions,
			wordCount,
			chapterCount,
			lineCount,
			needsSubtasks,
			subTaskCount,
			subTaskReason,
		)

		// 创建一个用于ask_followup_question的工具使用块
		const followupBlock = {
			type: "tool_use" as const,
			name: "ask_followup_question" as const,
			params: {
				question: optionsMessage,
			},
			partial: false,
		}

		// 调用askFollowupQuestionTool获取用户选择
		await askFollowupQuestionTool(
			cline,
			followupBlock,
			askApproval,
			handleError,
			async (result) => {
				// 用户已选择扩写选项

				// 如果用户选择使用注释功能，询问是否需要添加注释
				if (useComments) {
					const commentApprovalBlock = {
						type: "tool_use" as const,
						name: "ask_followup_question" as const,
						params: {
							question:
								"您希望在扩写过程中添加HTML注释来解释扩写思路吗？这些注释不会出现在最终文本中，但可以帮助理解扩写逻辑。",
						},
						partial: false,
					}

					await askFollowupQuestionTool(
						cline,
						commentApprovalBlock,
						askApproval,
						handleError,
						async (commentResult) => {
							// 根据用户选择决定是否使用注释
							const useCommentsInExpansion = !!(
								commentResult &&
								typeof commentResult === "string" &&
								(commentResult.toLowerCase().includes("是") ||
									commentResult.toLowerCase().includes("yes") ||
									commentResult.toLowerCase().includes("添加"))
							)

							// 处理扩写任务
							await handleExpansionTask(
								cline,
								sourcePath,
								outputPath,
								parseFloat(ratio),
								needsSubtasks,
								subTaskCount,
								subTaskReason,
								useCommentsInExpansion,
								askApproval,
								handleError,
								pushToolResult,
							)
						},
						removeClosingTag,
					)
				} else {
					// 不使用注释，直接处理扩写任务
					await handleExpansionTask(
						cline,
						sourcePath,
						outputPath,
						parseFloat(ratio),
						needsSubtasks,
						subTaskCount,
						subTaskReason,
						false,
						askApproval,
						handleError,
						pushToolResult,
					)
				}
			},
			removeClosingTag,
		)
	} catch (error) {
		await handleError("analyzing content for expansion", error as Error)
	}
}

/**
 * 分析文本内容，获取字数、段落数、章节数和行数
 */
function analyzeContent(content: string): ContentAnalysis {
	// 计算字数
	const wordCount = content.replace(/\s+/g, "").length

	// 计算段落数
	const paragraphCount = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length

	// 计算行数
	const lineCount = content.split("\n").length

	// 识别章节（通过标题标记如 # 第X章 或 ## 章节名）
	const chapterRegex = /^#+\s*(第[一二三四五六七八九十百千万\d]+[章节卷集部]|Chapter\s*\d+|CHAPTER\s*\d+)/gm
	const chapterMatches = content.match(chapterRegex)
	const chapterCount = chapterMatches ? chapterMatches.length : 0

	return {
		wordCount,
		paragraphCount,
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
 * 生成扩写选项
 */
function generateExpansionOptions(wordCount: number, paragraphCount: number, ratio: number): ExpansionOption[] {
	const options: ExpansionOption[] = []

	// 基于段落的扩写选项
	options.push({
		id: "paragraph_detail",
		title: "段落细节扩写",
		description: "为每个段落添加更多细节描述，丰富场景和环境",
		effort: "medium",
	})

	// 基于对话的扩写选项
	options.push({
		id: "dialogue_expansion",
		title: "对话内容扩展",
		description: "扩展对话内容，增加对话深度和角色互动",
		effort: "medium",
	})

	// 基于心理活动的扩写选项
	options.push({
		id: "inner_thoughts",
		title: "内心活动描写",
		description: "添加角色的内心活动和心理描写，展现角色情感变化",
		effort: "high",
	})

	// 基于感官描写的扩写选项
	options.push({
		id: "sensory_details",
		title: "感官细节描写",
		description: "增加视觉、听觉、嗅觉、触觉等感官描写，提升沉浸感",
		effort: "medium",
	})

	// 如果段落较多，添加情节扩展选项
	if (paragraphCount > 5) {
		options.push({
			id: "plot_extension",
			title: "情节扩展",
			description: "在关键情节点添加更多发展和转折，丰富故事脉络",
			effort: "high",
		})
	}

	// 如果字数较少，添加全面扩写选项
	if (wordCount < 1000) {
		options.push({
			id: "comprehensive_expansion",
			title: "全面扩写",
			description: "对全文进行全面扩写，包括情节、对话、描写等各方面",
			effort: "very_high",
		})
	}

	// 如果字数较多，添加重点扩写选项
	if (wordCount > 2000) {
		options.push({
			id: "focused_expansion",
			title: "重点扩写",
			description: "只对关键段落和情节进行重点扩写，保持整体结构",
			effort: "medium",
		})
	}

	return options
}

/**
 * 格式化扩写选项消息
 */
function formatExpansionOptionsMessage(
	options: ExpansionOption[],
	wordCount: number,
	chapterCount: number,
	lineCount: number,
	needsSubtasks: boolean,
	subTaskCount: number,
	subTaskReason: string,
): string {
	let message = `## 内容扩写分析\n\n`

	message += `当前文本字数：${wordCount}字\n`

	if (chapterCount > 0) {
		message += `章节数量：${chapterCount}章\n`
	}

	message += `文本行数：${lineCount}行\n\n`

	if (needsSubtasks) {
		message += `> 注意：根据${subTaskReason}，将会创建${subTaskCount}个子任务进行分段处理。\n\n`
	}

	message += `### 扩写方向选项\n\n`

	options.forEach((option, index) => {
		let effortLabel = ""
		switch (option.effort) {
			case "low":
				effortLabel = "⚪ 低"
				break
			case "medium":
				effortLabel = "🔵 中"
				break
			case "high":
				effortLabel = "🟠 高"
				break
			case "very_high":
				effortLabel = "🔴 很高"
				break
		}

		message += `${index + 1}. **${option.title}** (工作量：${effortLabel})\n   ${option.description}\n\n`
	})

	message += `请选择您希望的扩写方向（可多选，如"1,3"），或直接描述您的具体扩写需求。`

	return message
}

/**
 * 处理扩写任务
 */
async function handleExpansionTask(
	cline: Task,
	sourcePath: string,
	outputPath: string | undefined,
	ratio: number,
	needsSubtasks: boolean,
	subTaskCount: number,
	subTaskReason: string,
	useComments: boolean,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
): Promise<void> {
	try {
		// 确定输出路径
		const finalOutputPath = outputPath || generateOutputPath(sourcePath)

		// 如果需要子任务，创建子任务
		if (needsSubtasks) {
			// 创建一个用于new_task的工具使用块
			const taskMessage = `继续扩写文件 ${sourcePath}，扩写比例为${ratio}倍。将分为${subTaskCount}个子任务处理，基于${subTaskReason}。`
			const taskBlock = {
				type: "tool_use" as const,
				name: "new_task" as const,
				params: {
					mode: "expansion",
					message: taskMessage,
				},
				partial: false,
			}

			// 调用newTaskTool创建子任务
			await newTaskTool(
				cline,
				taskBlock,
				askApproval,
				handleError as any, // 使用类型断言解决参数类型不匹配问题
				(result) => {
					pushToolResult(
						`已创建扩写子任务。将根据${subTaskReason}分为${subTaskCount}个子任务进行扩写处理。输出文件将保存为：${finalOutputPath}`,
					)
				},
				(tag: ToolParamName, content?: string) => content || "", // 正确实现RemoveClosingTag
			)
		} else {
			// 不需要子任务，直接返回结果
			pushToolResult(
				`Ready to start expanding file ${sourcePath}, the expansion ratio is ${ratio} times. ${useComments ? "Will add comments to explain the expansion ideas." : ""}`,
			)
			//(`准备开始扩写文件 ${sourcePath}，扩写比例为${ratio}倍。${useComments ? '将添加注释以解释扩写思路。' : ''}`);
			// 如果需要使用注释，添加一个示例注释
			if (useComments) {
				const commentBlock = {
					type: "tool_use" as const,
					name: "novel_comment" as const,
					params: {
						path: sourcePath,
						line: "1",
						content: "这是扩写过程中添加的注释，用于解释扩写思路和重点。",
						explain: "expansion_note",
					},
					partial: false,
				}

				// 调用novelCommentTool添加注释
				await novelCommentTool(
					cline,
					commentBlock,
					(message) => askApproval("tool", message) as any, // 使用类型断言解决参数类型不匹配问题
					(error) => handleError("adding comment", error as Error),
					() => {},
					() => {},
				)
			}
		}
	} catch (error) {
		await handleError("handling expansion task", error as Error)
	}
}

/**
 * 生成输出文件路径
 */
function generateOutputPath(sourcePath: string): string {
	const dirName = path.dirname(sourcePath)
	const baseName = path.basename(sourcePath, path.extname(sourcePath))
	const extName = path.extname(sourcePath)

	return path.join(dirName, `${baseName}_扩写${extName}`)
}

/**
 * 内容分析接口
 */
interface ContentAnalysis {
	wordCount: number
	paragraphCount: number
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

/**
 * 扩写选项接口
 */
interface ExpansionOption {
	id: string
	title: string
	description: string
	effort: "low" | "medium" | "high" | "very_high"
}
