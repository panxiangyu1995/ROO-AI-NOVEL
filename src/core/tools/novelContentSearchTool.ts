import * as vscode from "vscode"
import * as path from "path"
import * as fsPromises from "fs/promises"
import * as fs from "fs"

import { Task } from "../task/Task"
import {
	AskApproval,
	HandleError,
	PushToolResult,
	RemoveClosingTag,
	NovelContentSearchToolUse,
} from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { CodeIndexManager } from "../../services/code-index/manager"
import { askFollowupQuestionTool } from "./askFollowupQuestionTool"
import { newTaskTool } from "./newTaskTool"

// 搜索类型枚举
export enum SearchType {
	CHARACTER = "character", // 角色相关内容
	PLOT = "plot", // 情节相关内容
	SETTING = "setting", // 设定相关内容
	THEME = "theme", // 主题相关内容
	DIALOGUE = "dialogue", // 对话相关内容
	GENERAL = "general", // 通用搜索
}

// 最大块大小（字符数）
const MAX_CHUNK_SIZE = 1000
// 块重叠大小（字符数）
const CHUNK_OVERLAP = 200
// 最大返回结果数
const MAX_RESULTS = 5
// 最小相关性分数
const MIN_SCORE = 0.6

// 文件大小阈值（字节）
const SMALL_FILE_THRESHOLD = 15 * 1024 // 15KB
const MODEL_CONTEXT_LIMIT = 64 * 1024 // 64KB，假设模型上下文窗口大小
const SUBTASK_CHUNK_SIZE = 8 * 1024 // 8KB，每个子任务处理的大小

// 索引目录名称
const CONTENT_SEARCH_DIR = ".ContentSearch"

/**
 * 小说内容搜索工具 - 在长篇小说中进行语义搜索
 */
export async function novelContentSearchTool(
	cline: Task,
	block: NovelContentSearchToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const toolName = "novel_content_search"

	try {
		// --- 参数提取和验证 ---
		let query: string | undefined = block.params.query
		let relPath: string | undefined = block.params.path
		let searchType: string | undefined = block.params.type

		query = removeClosingTag("query", query)

		if (!query) {
			cline.consecutiveMistakeCount++
			pushToolResult(await cline.sayAndCreateMissingParamError(toolName, "query"))
			return
		}

		if (!relPath) {
			cline.consecutiveMistakeCount++
			pushToolResult(await cline.sayAndCreateMissingParamError(toolName, "path"))
			return
		}

		relPath = removeClosingTag("path", relPath)

		// 验证搜索类型
		if (searchType) {
			searchType = removeClosingTag("type", searchType).toLowerCase()
			if (!Object.values(SearchType).includes(searchType as SearchType)) {
				searchType = SearchType.GENERAL
			}
		} else {
			searchType = SearchType.GENERAL
		}

		const sharedMessageProps = {
			tool: "novelContentSearch",
			query: query,
			path: getReadablePath(cline.cwd, relPath),
			type: searchType,
		}

		if (block.partial) {
			await cline.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
			return
		}

		cline.consecutiveMistakeCount = 0

		// --- 核心逻辑 ---

		// 检查是否启用了小说项目索引功能
		const context = cline.providerRef.deref()?.context
		let isCodebaseEnabled = false

		if (context) {
			const manager = CodeIndexManager.getInstance(context)
			isCodebaseEnabled = manager?.isFeatureEnabled || false

			// 如果启用了codebase索引，提示用户使用codebase_search工具
			if (isCodebaseEnabled) {
				await cline.say("text", "检测到已启用小说项目索引功能，建议使用codebase_search工具进行搜索。")
				await cline.say("text", "codebase_search工具将利用向量索引提供更好的搜索结果。")

				// 继续执行当前工具的逻辑，不强制返回
				// 这样用户可以选择继续使用novelContentSearchTool或切换到codebase_search
			}
		}

		// 验证文件是否存在
		const absolutePath = path.resolve(cline.cwd, relPath)
		const fileExists = await fileExistsAtPath(absolutePath)

		if (!fileExists) {
			cline.recordToolError(toolName)
			const formattedError = formatResponse.toolError(
				`文件不存在：${absolutePath}\n找不到指定文件。请检查文件路径并重试。`,
			)
			await cline.say("error", formattedError)
			pushToolResult(formattedError)
			return
		}

		// 读取文件内容
		let content: string
		try {
			const stats = await fsPromises.stat(absolutePath)
			const fileSize = stats.size

			// 检查文件大小
			if (fileSize <= SMALL_FILE_THRESHOLD) {
				// 小文件直接读取全部内容
				content = await fsPromises.readFile(absolutePath, "utf-8")
				await cline.say("text", `文件大小：${(fileSize / 1024).toFixed(2)} KB，直接读取全部内容进行搜索。`)

				// 执行搜索
				await processSmallFile(content, query, searchType as SearchType)
				return
			} else if (fileSize > MODEL_CONTEXT_LIMIT) {
				// 文件大小超过模型上下文限制
				if (!isCodebaseEnabled) {
					const message = `文件过大（${(fileSize / 1024 / 1024).toFixed(2)} MB），超过模型上下文窗口限制。如果想要支持大文件的读取和更好的支持体验，请在计算机交互设置选项中开启并正确配置embedding模型。`
					await cline.say("text", message)
					pushToolResult(message)
					return
				}
			} else {
				// 中等大小文件，检查是否存在索引目录
				const indexDirPath = path.join(path.dirname(absolutePath), CONTENT_SEARCH_DIR)
				const indexFilePath = path.join(indexDirPath, path.basename(absolutePath) + ".index")

				if (await fileExistsAtPath(indexFilePath)) {
					// 索引文件存在，使用索引进行搜索
					await cline.say("text", `检测到索引文件，将使用索引进行搜索。`)
					await searchWithIndex(indexDirPath, indexFilePath, query, searchType as SearchType)
					return
				} else {
					// 索引文件不存在，询问是否创建索引
					const createIndexMessage = `文件大小为 ${(fileSize / 1024).toFixed(2)} KB，建议创建索引以提高搜索效率。是否创建索引？`

					const followupBlock = {
						type: "tool_use" as const,
						name: "ask_followup_question" as const,
						params: {
							question: createIndexMessage,
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
								(result.toLowerCase().includes("是") ||
									result.toLowerCase().includes("yes") ||
									result.toLowerCase().includes("创建"))
							) {
								// 用户同意创建索引
								await createSearchIndex(absolutePath, fileSize)

								// 创建索引后，使用索引进行搜索
								await searchWithIndex(indexDirPath, indexFilePath, query, searchType as SearchType)
							} else {
								// 用户不同意创建索引，直接读取文件
								content = await fsPromises.readFile(absolutePath, "utf-8")
								await processSmallFile(content, query, searchType as SearchType)
							}
						},
						removeClosingTag,
					)
					return
				}
			}
		} catch (error) {
			cline.recordToolError(toolName)
			const errorMessage = `无法读取文件：${relPath}，错误：${error instanceof Error ? error.message : String(error)}`
			await cline.say("error", errorMessage)
			pushToolResult(formatResponse.toolError(errorMessage))
			return
		}

		// 处理小文件内容的搜索
		async function processSmallFile(content: string, query: string, searchType: SearchType) {
			if (!content) {
				const errorMessage = `文件为空：${relPath}`
				await cline.say("error", errorMessage)
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			// 将内容分块
			const chunks = chunkContent(content)
			await cline.say("text", `已将文件分成 ${chunks.length} 个块进行处理`)

			// 增强查询
			const enhancedQuery = enhanceQuery(query, searchType)

			// 创建临时消息并获取嵌入向量
			const searchResults = await semanticSearch(cline, chunks, enhancedQuery)

			// 格式化结果
			if (!searchResults || searchResults.length === 0) {
				pushToolResult(`未找到与查询"${query}"相关的内容。`)
				return
			}

			const jsonResult = {
				query,
				searchType,
				results: searchResults,
			}

			// 发送结果到UI
			const payload = { tool: "novelContentSearch", content: jsonResult }
			await cline.say("text", JSON.stringify(payload))

			// 格式化输出结果
			const output = formatSearchResults(query, searchType, searchResults)
			pushToolResult(output)
		}

		// 创建搜索索引
		async function createSearchIndex(filePath: string, fileSize: number) {
			const fileName = path.basename(filePath)
			const dirPath = path.dirname(filePath)
			const indexDirPath = path.join(dirPath, CONTENT_SEARCH_DIR)

			// 创建索引目录
			try {
				await fsPromises.mkdir(indexDirPath, { recursive: true })
			} catch (error) {
				console.error("创建索引目录失败:", error)
				await cline.say("error", `创建索引目录失败: ${error instanceof Error ? error.message : String(error)}`)
				return
			}

			// 读取文件内容
			const content = await fsPromises.readFile(filePath, "utf-8")

			// 计算子任务数量
			const numSubtasks = Math.ceil(content.length / SUBTASK_CHUNK_SIZE)

			if (numSubtasks > 1) {
				// 需要创建子任务
				const taskMessage = `为文件 ${getReadablePath(cline.cwd, filePath)} 创建内容索引，将分为${numSubtasks}个子任务处理。`
				const taskBlock = {
					type: "tool_use" as const,
					name: "new_task" as const,
					params: {
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
					async (result) => {
						await cline.say("text", `已创建索引子任务。将文件分为${numSubtasks}个块进行处理。`)

						// 分块处理文件
						await processFileInChunks(content, filePath, indexDirPath)
					},
					removeClosingTag,
				)
			} else {
				// 直接处理
				await processFileInChunks(content, filePath, indexDirPath)
			}
		}

		// 分块处理文件并创建索引
		async function processFileInChunks(content: string, filePath: string, indexDirPath: string) {
			const fileName = path.basename(filePath)
			const chunks = []
			const chunkSize = SUBTASK_CHUNK_SIZE

			// 分块
			for (let i = 0; i < content.length; i += chunkSize) {
				const chunk = content.substring(i, i + chunkSize)
				chunks.push({
					id: chunks.length,
					text: chunk,
					startPos: i,
					endPos: Math.min(i + chunkSize, content.length),
				})
			}

			// 创建索引文件
			const indexData = {
				fileName: fileName,
				totalChunks: chunks.length,
				chunks: chunks.map((chunk) => ({
					id: chunk.id,
					startPos: chunk.startPos,
					endPos: chunk.endPos,
					summary: "", // 将在下一步填充
				})),
			}

			// 为每个块创建文件
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i]
				const chunkFilePath = path.join(indexDirPath, `${fileName}.chunk${chunk.id}`)

				// 写入块文件
				await fsPromises.writeFile(chunkFilePath, chunk.text, "utf-8")

				// 生成块摘要
				const summary = await generateChunkSummary(chunk.text)
				indexData.chunks[i].summary = summary
			}

			// 写入索引文件
			const indexFilePath = path.join(indexDirPath, `${fileName}.index`)
			await fsPromises.writeFile(indexFilePath, JSON.stringify(indexData, null, 2), "utf-8")

			await cline.say("text", `已成功创建索引，包含 ${chunks.length} 个块。`)
		}

		// 生成块摘要
		async function generateChunkSummary(chunkText: string): Promise<string> {
			const prompt = `
请提取以下文本中的关键信息，包括：
1. 主要人物名称
2. 关键情节点
3. 重要场景
4. 关键物品
5. 其他重要元素

请以简洁的形式列出，不要有任何解释或分析。

文本内容:
${chunkText.substring(0, 3000)}
`

			let summary = ""
			try {
				// 创建消息流
				const stream = cline.api.createMessage("", [{ role: "user" as const, content: prompt }])

				// 处理流中的内容
				for await (const content of stream) {
					if (content && typeof content === "string") {
						summary += content
					}
				}
			} catch (error) {
				console.error("生成摘要时出错:", error)
				summary = "摘要生成失败"
			}

			return summary
		}

		// 使用索引进行搜索
		async function searchWithIndex(
			indexDirPath: string,
			indexFilePath: string,
			query: string,
			searchType: SearchType,
		) {
			try {
				// 读取索引文件
				const indexContent = await fsPromises.readFile(indexFilePath, "utf-8")
				const indexData = JSON.parse(indexContent)

				// 增强查询
				const enhancedQuery = enhanceQuery(query, searchType)

				// 首先搜索索引摘要，找出最相关的块
				const relevantChunks = []

				for (const chunk of indexData.chunks) {
					// 构建提示
					const prompt = `
你是一个专门进行文本相关性评估的助手。你的任务是评估以下文本摘要与查询的相关性。
请为文本摘要分配一个从0到10的相关性分数，其中0表示完全不相关，10表示非常相关。
只返回一个数字作为分数，不要有任何其他文本。

查询: "${enhancedQuery}"

文本摘要:
${chunk.summary}
`

					let scoreResponse = ""

					// 创建消息流
					const stream = cline.api.createMessage("", [{ role: "user" as const, content: prompt }])

					// 处理流中的内容
					for await (const content of stream) {
						if (content && typeof content === "string") {
							scoreResponse += content
						}
					}

					// 提取分数
					const scoreMatch = scoreResponse.match(/(\d+(\.\d+)?)/)
					if (scoreMatch) {
						const score = parseFloat(scoreMatch[0]) / 10 // 转换为0-1的范围

						if (score >= MIN_SCORE) {
							relevantChunks.push({
								...chunk,
								score,
							})
						}
					}
				}

				// 按相关性排序
				relevantChunks.sort((a, b) => b.score - a.score)

				// 限制结果数量
				const topChunks = relevantChunks.slice(0, MAX_RESULTS)

				if (topChunks.length === 0) {
					pushToolResult(`未找到与查询"${query}"相关的内容。`)
					return
				}

				// 读取相关块的内容
				const results = []

				for (const chunk of topChunks) {
					const chunkFilePath = path.join(indexDirPath, `${indexData.fileName}.chunk${chunk.id}`)
					const chunkContent = await fsPromises.readFile(chunkFilePath, "utf-8")

					results.push({
						text: chunkContent,
						startPos: chunk.startPos,
						endPos: chunk.endPos,
						score: chunk.score,
					})
				}

				// 格式化结果
				const jsonResult = {
					query,
					searchType,
					results,
				}

				// 发送结果到UI
				const payload = { tool: "novelContentSearch", content: jsonResult }
				await cline.say("text", JSON.stringify(payload))

				// 格式化输出结果
				const output = formatSearchResults(query, searchType, results)
				pushToolResult(output)
			} catch (error) {
				console.error("使用索引搜索时出错:", error)
				await cline.say(
					"error",
					`使用索引搜索时出错: ${error instanceof Error ? error.message : String(error)}`,
				)

				// 索引搜索失败，尝试直接读取文件
				const content = await fsPromises.readFile(
					path.join(path.dirname(indexDirPath), path.basename(indexFilePath, ".index")),
					"utf-8",
				)
				await processSmallFile(content, query, searchType)
			}
		}
	} catch (error: any) {
		await handleError(toolName, error instanceof Error ? error : new Error(String(error)))
	}
}

/**
 * 将内容分块
 */
function chunkContent(content: string): Array<{ text: string; startPos: number; endPos: number }> {
	const chunks: Array<{ text: string; startPos: number; endPos: number }> = []

	// 按段落分割内容
	const paragraphs = content.split(/\n\s*\n/)

	let currentChunk = ""
	let startPos = 0
	let currentStartPos = 0

	for (const paragraph of paragraphs) {
		// 如果当前块加上这个段落超过了最大块大小，保存当前块并开始新块
		if (currentChunk.length + paragraph.length > MAX_CHUNK_SIZE && currentChunk.length > 0) {
			chunks.push({
				text: currentChunk,
				startPos: currentStartPos,
				endPos: startPos - 1,
			})

			// 新块的起始位置回退一些，确保有重叠
			const overlapStart = Math.max(startPos - CHUNK_OVERLAP, 0)
			currentStartPos = overlapStart
			currentChunk = content.substring(overlapStart, startPos) + paragraph
		} else {
			// 否则，将段落添加到当前块
			currentChunk += (currentChunk ? "\n\n" : "") + paragraph
		}

		// 更新位置
		startPos += paragraph.length + 2 // +2 for the "\n\n"
	}

	// 添加最后一个块
	if (currentChunk.length > 0) {
		chunks.push({
			text: currentChunk,
			startPos: currentStartPos,
			endPos: content.length,
		})
	}

	return chunks
}

/**
 * 增强查询以提高搜索质量
 */
function enhanceQuery(query: string, type: SearchType): string {
	switch (type) {
		case SearchType.CHARACTER:
			return `关于角色的信息: ${query}`
		case SearchType.PLOT:
			return `关于情节的信息: ${query}`
		case SearchType.SETTING:
			return `关于世界设定的信息: ${query}`
		case SearchType.THEME:
			return `关于主题的信息: ${query}`
		case SearchType.DIALOGUE:
			return `相关的对话内容: ${query}`
		case SearchType.GENERAL:
		default:
			return query
	}
}

/**
 * 执行语义搜索
 */
async function semanticSearch(
	cline: Task,
	chunks: Array<{ text: string; startPos: number; endPos: number }>,
	query: string,
): Promise<Array<{ text: string; startPos: number; endPos: number; score: number }>> {
	// 构建提示
	const prompt = `
你是一个专门进行文本相关性评估的助手。你的任务是评估以下文本片段与查询的相关性。
请为每个文本片段分配一个从0到10的相关性分数，其中0表示完全不相关，10表示非常相关。
只返回一个数字作为分数，不要有任何其他文本。

查询: "${query}"

文本片段:
`

	const results: Array<{ text: string; startPos: number; endPos: number; score: number }> = []

	// 对每个块进行评分
	for (const chunk of chunks) {
		try {
			const tempMessages = [{ role: "user" as const, content: `${prompt}\n\n${chunk.text}` }]
			let scoreResponse = ""

			// 创建消息流
			const stream = cline.api.createMessage("", tempMessages)

			// 处理流中的内容
			for await (const content of stream) {
				if (content && typeof content === "string") {
					scoreResponse += content
				}
			}

			// 提取分数
			const scoreMatch = scoreResponse.match(/(\d+(\.\d+)?)/)
			if (scoreMatch) {
				const score = parseFloat(scoreMatch[0]) / 10 // 转换为0-1的范围

				if (score >= MIN_SCORE) {
					results.push({
						text: chunk.text,
						startPos: chunk.startPos,
						endPos: chunk.endPos,
						score,
					})
				}
			}
		} catch (error) {
			console.error("评分过程中出错:", error)
		}
	}

	// 按相关性排序并限制结果数量
	return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS)
}

/**
 * 格式化搜索结果
 */
function formatSearchResults(
	query: string,
	type: SearchType,
	results: Array<{ text: string; startPos: number; endPos: number; score: number }>,
): string {
	const typeDisplay = getSearchTypeDisplayName(type)

	let output = `查询: ${query}\n搜索类型: ${typeDisplay}\n\n结果:\n\n`

	results.forEach((result, index) => {
		// 计算大致的位置百分比
		const positionText = `位置: 字符 ${result.startPos}-${result.endPos}`
		const relevanceText = `相关性: ${(result.score * 100).toFixed(0)}%`

		// 截断过长的文本
		let displayText = result.text
		if (displayText.length > 500) {
			displayText = displayText.substring(0, 250) + "..." + displayText.substring(displayText.length - 250)
		}

		output += `--- 结果 ${index + 1} ---\n${positionText}\n${relevanceText}\n\n${displayText}\n\n`
	})

	return output
}

/**
 * 获取搜索类型的显示名称
 */
function getSearchTypeDisplayName(type: SearchType): string {
	const displayNames: Record<SearchType, string> = {
		[SearchType.CHARACTER]: "角色搜索",
		[SearchType.PLOT]: "情节搜索",
		[SearchType.SETTING]: "世界设定搜索",
		[SearchType.THEME]: "主题搜索",
		[SearchType.DIALOGUE]: "对话搜索",
		[SearchType.GENERAL]: "通用搜索",
	}

	return displayNames[type] || "通用搜索"
}
