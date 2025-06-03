import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import { ToolUse } from "../../shared/tools"
import { getWorkspacePath } from "../../utils/path"
import { fileExistsAtPath } from "../../utils/fs"
import { Task } from "../task/Task"

/**
 * 添加小说注释工具
 * 在小说文本中添加HTML格式的注释，不会在最终输出中显示，但可以帮助跟踪创作过程
 */
export async function novelCommentTool(
	cline: Task,
	block: ToolUse,
	askApproval: (message: string) => Promise<boolean>,
	handleError: (error: Error) => void,
	pushToolResult: (result: string) => void,
	removeClosingTag: () => void,
) {
	try {
		// 提取参数
		const filePath = block.params?.path
		const lineNumber = block.params?.line ? parseInt(block.params.line) : NaN
		const comment = block.params?.content // 使用content参数存储注释内容
		const commentType = block.params?.explain || "note" // 使用explain参数存储注释类型

		// 支持批量注释处理（格式：行号1:注释内容1;行号2:注释内容2...）
		const batchMode = comment && comment.includes(";") && !lineNumber

		// 参数验证
		if (!filePath) {
			throw new Error("Path parameter is required")
		}

		if (!batchMode && (isNaN(lineNumber) || lineNumber < 1)) {
			throw new Error("Line parameter must be a positive number")
		}

		if (!comment) {
			throw new Error("Content parameter is required")
		}

		// 获取工作区根路径
		const rootPath = getWorkspacePath()
		if (!rootPath) {
			throw new Error("No workspace root found")
		}

		// 构建完整文件路径
		const fullPath = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath)

		// 检查文件是否存在
		if (!(await fileExistsAtPath(fullPath))) {
			throw new Error(`File does not exist: ${filePath}`)
		}

		// 检查文件是否为Markdown文件
		if (!fullPath.toLowerCase().endsWith(".md")) {
			throw new Error("Only Markdown files are supported for novel comments")
		}

		// 读取文件内容
		const fileContent = await fs.promises.readFile(fullPath, "utf8")
		const lines = fileContent.split("\n")

		// 处理批量注释
		if (batchMode) {
			const commentEntries = comment.split(";").filter((entry) => entry.trim())
			const commentActions = []

			// 解析所有注释条目
			for (const entry of commentEntries) {
				const [entryLine, entryComment] = entry.split(":").map((part) => part.trim())
				const lineNum = parseInt(entryLine)

				if (isNaN(lineNum) || lineNum < 1 || lineNum > lines.length) {
					continue // 跳过无效的行号
				}

				if (!entryComment) {
					continue // 跳过没有注释内容的条目
				}

				commentActions.push({
					line: lineNum,
					comment: entryComment,
				})
			}

			if (commentActions.length === 0) {
				throw new Error(
					"No valid comment entries found in batch format (should be 'line:comment;line:comment')",
				)
			}

			// 请求用户批准
			const approvalMessage = `Add ${commentActions.length} comments of type "${commentType}" to ${filePath}?`
			const approved = await askApproval(approvalMessage)

			if (!approved) {
				pushToolResult("User rejected the batch comment addition.")
				return
			}

			// 应用所有注释（从后向前，避免行号变化）
			commentActions.sort((a, b) => b.line - a.line)

			for (const action of commentActions) {
				const htmlComment = `<!-- ${commentType}: ${action.comment} -->`
				lines.splice(action.line - 1, 0, htmlComment)
			}

			// 写入文件
			await fs.promises.writeFile(fullPath, lines.join("\n"), "utf8")

			// 返回成功结果
			pushToolResult(`Successfully added ${commentActions.length} comments to ${filePath}.`)
			return
		}

		// 单条注释处理
		// 确保行号在有效范围内
		if (lineNumber > lines.length) {
			throw new Error(`Line number ${lineNumber} exceeds file length ${lines.length}`)
		}

		// 构建HTML注释
		const htmlComment = `<!-- ${commentType}: ${comment} -->`

		// 在指定行添加注释
		lines.splice(lineNumber - 1, 0, htmlComment)
		const newContent = lines.join("\n")

		// 请求用户批准
		const approvalMessage = `Add comment "${comment}" of type "${commentType}" at line ${lineNumber} in ${filePath}?`
		const approved = await askApproval(approvalMessage)

		if (!approved) {
			pushToolResult("User rejected the comment addition.")
			return
		}

		// 写入文件
		await fs.promises.writeFile(fullPath, newContent, "utf8")

		// 返回成功结果
		pushToolResult(`Successfully added comment at line ${lineNumber} in ${filePath}.`)
	} catch (error) {
		handleError(error instanceof Error ? error : new Error(String(error)))
	}
}
