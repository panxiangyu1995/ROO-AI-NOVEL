import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"

import { Task } from "../task/Task"
import { CodeIndexManager } from "../../services/code-index/manager"
import { getWorkspacePath } from "../../utils/path"
import { formatResponse } from "../prompts/responses"
import { VectorStoreSearchResult } from "../../services/code-index/interfaces"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag, ToolUse } from "../../shared/tools"
import { fileExistsAtPath } from "../../utils/fs"
import { novelContentSearchTool } from "./novelContentSearchTool"

// 文件大小阈值（字节）
const SMALL_FILE_THRESHOLD = 15 * 1024 // 15KB，小于此值直接读取
const MODEL_CONTEXT_LIMIT = 64 * 1024 // 64KB，假设模型上下文窗口大小

export async function codebaseSearchTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const toolName = "codebase_search"
	const workspacePath = getWorkspacePath()

	if (!workspacePath) {
		// This case should ideally not happen if Cline is initialized correctly
		await handleError(toolName, new Error("Could not determine workspace path."))
		return
	}

	// --- Parameter Extraction and Validation ---
	let query: string | undefined = block.params.query
	let directoryPrefix: string | undefined = block.params.path

	query = removeClosingTag("query", query)

	if (directoryPrefix) {
		directoryPrefix = removeClosingTag("path", directoryPrefix)
		directoryPrefix = path.normalize(directoryPrefix)
	}

	const sharedMessageProps = {
		tool: "codebaseSearch",
		query: query,
		path: directoryPrefix,
		isOutsideWorkspace: false,
	}

	if (block.partial) {
		await cline.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
		return
	}

	if (!query) {
		cline.consecutiveMistakeCount++
		pushToolResult(await cline.sayAndCreateMissingParamError(toolName, "query"))
		return
	}

	// 移除用户批准步骤，直接继续执行
	cline.consecutiveMistakeCount = 0

	// --- Core Logic ---
	try {
		const context = cline.providerRef.deref()?.context
		if (!context) {
			throw new Error("Extension context is not available.")
		}

		const manager = CodeIndexManager.getInstance(context)

		// 检查是否启用了代码库索引功能
		const isCodebaseIndexEnabled = manager?.isFeatureEnabled || false

		// 如果启用了代码库索引功能，使用向量搜索
		if (isCodebaseIndexEnabled) {
			// 验证配置是否完整
			if (!manager) {
				throw new Error("CodeIndexManager is not available.")
			}

			if (!manager.isFeatureConfigured) {
				throw new Error("Codebase Indexing is not configured (Missing OpenAI Key or Qdrant URL).")
			}

			// 执行向量搜索
			const searchResults: VectorStoreSearchResult[] = await manager.searchIndex(query, directoryPrefix)

			// 格式化并推送结果
			if (!searchResults || searchResults.length === 0) {
				pushToolResult(`未找到与查询"${query}"相关的内容。`)
				return
			}

			const jsonResult = {
				query,
				results: [],
			} as {
				query: string
				results: Array<{
					filePath: string
					score: number
					startLine: number
					endLine: number
					codeChunk: string
				}>
			}

			searchResults.forEach((result) => {
				if (!result.payload) return
				if (!("filePath" in result.payload)) return

				const relativePath = vscode.workspace.asRelativePath(result.payload.filePath, false)

				jsonResult.results.push({
					filePath: relativePath,
					score: result.score,
					startLine: result.payload.startLine,
					endLine: result.payload.endLine,
					codeChunk: result.payload.codeChunk.trim(),
				})
			})

			// 发送结果到UI
			const payload = { tool: "codebaseSearch", content: jsonResult }
			await cline.say("codebase_search_result", JSON.stringify(payload))

			// 推送结果到AI
			const output = `查询: ${query}
结果:

${jsonResult.results
	.map(
		(result) => `文件路径: ${result.filePath}
相关性分数: ${result.score}
行范围: ${result.startLine}-${result.endLine}
内容片段: ${result.codeChunk}
`,
	)
	.join("\n")}`

			pushToolResult(output)
			return
		}

		// 如果未启用代码库索引功能，使用novelContentSearchTool

		// 检查是否是单文件搜索
		let totalFileSize = 0
		let filePaths: string[] = []

		if (directoryPrefix) {
			try {
				const fullPath = path.resolve(workspacePath, directoryPrefix)
				const stats = await fs.stat(fullPath)

				if (stats.isFile()) {
					// 单文件
					totalFileSize = stats.size
					filePaths = [fullPath]
				} else if (stats.isDirectory()) {
					// 目录，获取所有文件
					const files = await fs.readdir(fullPath)
					for (const file of files) {
						const filePath = path.join(fullPath, file)
						try {
							const fileStats = await fs.stat(filePath)
							if (fileStats.isFile()) {
								totalFileSize += fileStats.size
								filePaths.push(filePath)
							}
						} catch (error) {
							console.error(`获取文件信息失败: ${filePath}`, error)
						}
					}
				}
			} catch (error) {
				console.error(`路径检查错误: ${error}`)
			}
		}

		// 根据文件大小决定处理方式
		if (totalFileSize <= SMALL_FILE_THRESHOLD) {
			// 小文件，直接读取
			if (filePaths.length === 1) {
				try {
					const fileContent = await fs.readFile(filePaths[0], "utf-8")
					pushToolResult(`文件内容:\n\n${fileContent}`)
					return
				} catch (error) {
					console.error(`读取文件失败: ${error}`)
					// 如果读取失败，继续尝试使用novelContentSearchTool
				}
			} else if (filePaths.length > 1) {
				// 多个小文件，合并内容
				let combinedContent = ""
				for (const filePath of filePaths) {
					try {
						const content = await fs.readFile(filePath, "utf-8")
						combinedContent += `\n\n--- ${path.basename(filePath)} ---\n\n${content}`
					} catch (error) {
						console.error(`读取文件失败: ${filePath}`, error)
					}
				}

				if (combinedContent) {
					pushToolResult(`合并文件内容:\n\n${combinedContent}`)
					return
				}
			}
		} else if (totalFileSize > MODEL_CONTEXT_LIMIT) {
			// 文件过大，超出模型上下文限制
			pushToolResult(
				`文件过大（${(totalFileSize / 1024 / 1024).toFixed(2)} MB），超过模型上下文窗口限制。如果想要支持大文件的读取和更好的支持体验，请在计算机交互设置选项中开启并正确配置embedding模型。`,
			)
			return
		}

		// 使用novelContentSearchTool处理
		if (directoryPrefix) {
			const novelSearchBlock = {
				...block,
				name: "novel_content_search" as const,
				params: {
					query: query,
					path: directoryPrefix,
					type: "general",
				},
				partial: false,
			}

			await novelContentSearchTool(
				cline,
				novelSearchBlock,
				askApproval,
				handleError,
				pushToolResult,
				removeClosingTag,
			)
		} else {
			pushToolResult(`请提供文件路径或目录路径。`)
		}
	} catch (error: any) {
		await handleError(toolName, error) // Use the standard error handler
	}
}
