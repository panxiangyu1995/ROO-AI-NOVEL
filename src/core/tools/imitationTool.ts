import * as vscode from "vscode"
import * as path from "path"
import * as fsPromises from "fs/promises"

import { Task } from "../task/Task"
import { ImitationToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { novelContentSearchTool } from "./novelContentSearchTool"

/**
 * 文学风格模仿工具 - 分析参考文本并生成指定风格的内容
 */
export async function imitationTool(
	cline: Task,
	block: ImitationToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	try {
		// 检查当前模式是否为模仿模式
		const { mode } = (await cline.providerRef.deref()?.getState()) || {}
		if (mode !== "imitation") {
			await cline.say("text", "此工具只能在模仿模式下使用。请先使用 switch_mode 工具切换到模仿模式。")
			pushToolResult("工具调用失败：此工具只能在模仿模式下使用。请使用 switch_mode 工具切换到模仿模式。")
			return
		}

		// 获取参数
		let relPath = block.params.path as string | undefined
		let text = block.params.text as string | undefined
		const outputPath = (block.params.output_path as string) || "imitation_result.md"

		// 如果没有提供文本或路径参数，提示用户提供
		if (!relPath && !text) {
			await cline.say(
				"text",
				"请提供要模仿的参考文本。可以通过path参数指定文件，或直接通过text参数提供文本内容。",
			)
			pushToolResult("未提供参考文本，请在对话中提供文件路径或文本内容。")
			return
		}

		// 处理部分工具使用
		if (block.partial) {
			const partialMessageProps = {
				tool: "imitation" as const,
				path: relPath,
				text: text,
				output_path: outputPath,
			}
			await cline.ask("tool", JSON.stringify(partialMessageProps), block.partial).catch(() => {})
			return
		}

		// 重置连续错误计数
		cline.consecutiveMistakeCount = 0

		// 获取参考文本内容
		let referenceContent = ""

		if (relPath) {
			try {
				// 获取当前工作目录
				const cwd = cline.cwd
				// 解析文件路径
				const fullPath = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath)

				// 检查文件是否存在
				try {
					await fsPromises.access(fullPath)
				} catch (error) {
					cline.consecutiveMistakeCount++
					cline.recordToolError("imitation")
					const errorMessage = `文件不存在：${fullPath}\n找不到指定文件。请检查文件路径并重试。`
					await cline.say("error", errorMessage)
					pushToolResult(errorMessage)
					return
				}

				// 读取源文件内容
				try {
					// 获取文件状态以检查文件大小
					const stats = await fsPromises.stat(fullPath)
					const fileSize = stats.size

					// 如果文件大小超过15KB，使用novelContentSearchTool进行处理
					if (fileSize > 15 * 1024) {
						await cline.say(
							"text",
							`文件较大（${(fileSize / 1024 / 1024).toFixed(2)} MB），将使用优化的处理技术进行风格分析。`,
						)

						// 创建一个novelContentSearch工具的参数对象
						const novelSearchBlock = {
							name: "novel_content_search" as const,
							params: {
								query: `分析这篇文章的写作风格特点，包括语言特点、叙事特点和独特元素`,
								path: relPath,
								type: "style",
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
					referenceContent = await fsPromises.readFile(fullPath, "utf8")
				} catch (error) {
					const errorMessage = `无法读取源文件：${relPath}，错误：${error instanceof Error ? error.message : String(error)}`
					await cline.say("error", errorMessage)
					pushToolResult(errorMessage)
					return
				}
			} catch (error) {
				const errorMessage = `无法读取源文件：${relPath}，错误：${error instanceof Error ? error.message : String(error)}`
				await cline.say("error", errorMessage)
				pushToolResult(errorMessage)
				return
			}
		} else if (text) {
			// 直接使用提供的文本
			referenceContent = text
		}

		// 告知用户分析进度
		await cline.say("text", "正在分析参考文本的风格特点...")

		// 生成风格分析和模仿内容
		const imitationResult = await generateImitationContent(referenceContent)

		// 创建结果文档，包含风格分析和模仿示例
		const resultContent = `# 文学风格模仿分析与示例

## 参考文本风格分析

${imitationResult.styleAnalysis}

## 风格模仿示例

${imitationResult.imitationSample}

## 风格模仿技巧

${imitationResult.imitationTips}
`

		try {
			// 获取当前工作目录
			const cwd = cline.cwd
			// 解析输出路径
			const fullOutputPath = path.isAbsolute(outputPath) ? outputPath : path.join(cwd, outputPath)
			// 确保目录存在
			await fsPromises.mkdir(path.dirname(fullOutputPath), { recursive: true })
			// 写入文件
			await fsPromises.writeFile(fullOutputPath, resultContent, "utf8")

			// 跟踪文件编辑操作
			await cline.fileContextTracker.trackFileContext(fullOutputPath, "roo_edited" as RecordSource)

			// 返回成功消息
			const successMessage = `文学风格模仿完成！结果已保存到：${fullOutputPath}`
			await cline.say("text", successMessage)
			pushToolResult(successMessage)
		} catch (error) {
			const errorMessage = `写入模仿结果失败：${error instanceof Error ? error.message : String(error)}`
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
		}

		// 提示用户后续操作选择
		await cline.ask("followup", "您对模仿结果有什么反馈？或者您希望在特定文本上应用这种风格吗？").catch(() => {})
	} catch (error) {
		await handleError("文学风格模仿", error instanceof Error ? error : new Error(String(error)))
	}
}

/**
 * 生成风格模仿内容
 */
async function generateImitationContent(referenceText: string): Promise<{
	styleAnalysis: string
	imitationSample: string
	imitationTips: string
}> {
	// 分析文本长度并截取适当长度的样本
	const textSample = referenceText.length > 1000 ? referenceText.substring(0, 1000) + "..." : referenceText

	// 提取风格关键词
	const styleWords = extractStyleKeywords(textSample)

	// 风格分析
	const styleAnalysis = `### 语言特点

* 句式: ${styleWords.sentencePatterns}
* 用词: ${styleWords.vocabulary}
* 修辞: ${styleWords.rhetoric}

### 叙事特点

* 视角: ${styleWords.perspective}
* 节奏: ${styleWords.rhythm}
* 情感基调: ${styleWords.tone}

### 独特元素

* 标志性表达: ${styleWords.signatures}
* 主题倾向: ${styleWords.themes}`

	// 模仿示例
	const imitationSample = `以下是模仿参考文本风格的写作示例：

---

${generateSampleText(styleWords)}

---`

	// 模仿技巧
	const imitationTips = `### 模仿这种风格的技巧

1. **句式结构**: ${styleWords.tipSentence}
2. **词汇选择**: ${styleWords.tipVocabulary}
3. **修辞手法**: ${styleWords.tipRhetoric}
4. **叙事方式**: ${styleWords.tipNarration}
5. **情感表达**: ${styleWords.tipEmotion}`

	return {
		styleAnalysis,
		imitationSample,
		imitationTips,
	}
}

/**
 * 提取文本的风格关键词
 */
function extractStyleKeywords(text: string): any {
	// 简化的分析逻辑
	const words = text.split(/\s+/)
	const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length
	const longSentences = text.split(/[.!?]/).filter((s) => s.length > 30).length
	const shortSentences = text.split(/[.!?]/).filter((s) => s.length <= 30).length

	// 根据简单分析确定一些风格特征
	return {
		sentencePatterns: longSentences > shortSentences ? "偏好长句" : "偏好短句",
		vocabulary: avgWordLength > 5 ? "丰富多样的词汇" : "简洁直白的词汇",
		rhetoric: text.includes("如") || text.includes("像") ? "常用比喻" : "少用修辞",
		perspective: text.includes("我") ? "第一人称" : "第三人称",
		rhythm: longSentences > shortSentences ? "舒缓" : "紧凑",
		tone: text.includes("高兴") || text.includes("快乐") ? "积极" : "沉稳",
		signatures: "特定的句式和表达方式",
		themes: "常见主题和关注点",

		// 模仿技巧
		tipSentence: "注意句式长短的变化和结构特点",
		tipVocabulary: "选择符合风格的词汇层次和类型",
		tipRhetoric: "适当运用原文常见的修辞手法",
		tipNarration: "保持与原文一致的叙事视角和方式",
		tipEmotion: "把握原文的情感基调和表达方式",
	}
}

/**
 * 生成模仿示例文本
 */
function generateSampleText(styleWords: any): string {
	// 简化的示例生成
	return `这是一段${styleWords.tone}基调的文字，采用${styleWords.perspective}视角进行叙述。句式${styleWords.sentencePatterns}，使用${styleWords.vocabulary}，整体节奏${styleWords.rhythm}。

这种风格的写作往往关注${styleWords.themes}，通过${styleWords.rhetoric}等修辞手法增强表现力。当你细读这段文字，能感受到作者独特的表达方式，尤其是那些${styleWords.signatures}，它们共同构成了这种风格的标志性特征。

模仿这种风格时，关键是把握其中的精髓，而非简单地复制表面特征。真正的模仿是对原作精神的致敬，同时融入自己的创造力，形成既有借鉴又有创新的作品。`
}
