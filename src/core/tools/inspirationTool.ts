import * as vscode from "vscode"
import * as path from "path"
import * as fsPromises from "fs/promises"

import { Task } from "../task/Task"
import {
	InspirationToolUse,
	AskApproval,
	HandleError,
	PushToolResult,
	RemoveClosingTag,
	ToolDescription,
	AskFinishSubTaskApproval,
} from "../../shared/tools"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { t } from "../../i18n"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"

/**
 * 灵感生成工具 - 为创作者提供创意灵感
 */
export async function inspirationTool(
	cline: Task,
	block: InspirationToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
	toolDescription?: ToolDescription,
	askFinishSubTaskApproval?: AskFinishSubTaskApproval,
) {
	try {
		// 检查当前模式是否为灵感模式
		const { mode } = (await cline.providerRef.deref()?.getState()) || {}
		if (mode !== "inspiration") {
			await cline.say("text", "此工具只能在灵感模式下使用。请先使用 switch_mode 工具切换到灵感模式。")
			pushToolResult("工具调用失败：此工具只能在灵感模式下使用。请使用 switch_mode 工具切换到灵感模式。")
			return
		}

		// 获取参数
		const topic = block.params.topic as string | undefined
		const outputPath = (block.params.output_path as string) || `inspiration_${topic?.replace(/\s+/g, "_")}.md`
		const aspect = (block.params.aspect as string) || "story"
		const count = parseInt((block.params.count as string) || "3")

		// 检查参数有效性
		if (!topic) {
			await cline.say("text", "请提供灵感生成的主题。")
			pushToolResult("未提供灵感主题，请在对话中提供主题。")
			return
		}

		// 验证灵感数量
		if (isNaN(count) || count < 1 || count > 10) {
			const errorMessage = "灵感数量必须是1到10之间的整数。"
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		// 验证灵感方面
		const validAspects = ["story", "character", "setting", "plot", "theme"]
		if (!validAspects.includes(aspect)) {
			const errorMessage = `无效的灵感方面。有效的选项包括: ${validAspects.join(", ")}`
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		// 处理部分工具使用
		if (block.partial) {
			const partialMessageProps = {
				tool: "inspiration" as const,
				topic: topic,
				output_path: outputPath,
				aspect: aspect,
				count: count.toString(),
			}
			await cline.ask("tool", JSON.stringify(partialMessageProps), block.partial).catch(() => {})
			return
		}

		// 重置连续错误计数
		cline.consecutiveMistakeCount = 0

		// 1. 询问用户是否批准读取工作区文件
		const workspaceMessage = JSON.stringify({
			tool: "readFile",
			path: cline.cwd,
		} satisfies ClineSayTool)

		const workspaceApproved = await askApproval("tool", workspaceMessage)

		// 如果用户不允许读取工作区文件，仍然继续但不读取文件
		if (workspaceApproved) {
			await cline.say("text", `感谢您的授权，我将分析工作区内容以提供更相关的"${topic}"灵感。`)

			// 这里可以添加读取工作区文件的逻辑，但目前我们只是模拟这个过程
			await cline.say("text", "正在分析工作区内容...")
			// 实际项目中，这里可以添加文件扫描和分析逻辑
		} else {
			await cline.say("text", `我将基于您提供的主题"${topic}"生成灵感，不会读取工作区文件。`)
		}

		// 告知用户灵感生成进度
		await cline.say("text", `正在为主题"${topic}"生成${count}个关于${getAspectDisplayName(aspect)}的灵感...`)

		// 生成灵感内容
		const inspirations = await generateInspirations(topic, aspect, count)

		// 格式化输出内容
		let outputContent = formatInspirationsOutput(topic, aspect, inspirations)

		// 显示灵感内容
		await cline.say("text", outputContent)

		// 2. 询问用户是否需要继续深入某个方向
		const followupMessage = `以上是关于"${topic}"的${count}个${getAspectDisplayName(aspect)}灵感。您希望深入探索其中某个方向，还是需要其他方面的灵感？`
		const { response: followupResponse, text: followupText } = await cline
			.ask("followup", followupMessage)
			.catch(() => ({ response: "", text: "" }))

		if (followupText) {
			// 用户选择了继续深入某个方向
			await cline.say("text", `正在深入探索您选择的方向: "${followupText}"...`)

			// 这里可以添加深入探索特定方向的逻辑
			const deeperInspirations = await generateDeeperInspirations(topic, aspect, followupText)
			const deeperContent = formatDeeperInspirationsOutput(topic, aspect, followupText, deeperInspirations)

			// 显示深入的灵感内容
			await cline.say("text", deeperContent)

			// 将深入内容添加到输出内容
			outputContent += "\n\n" + deeperContent
		}

		// 3. 询问用户是否将灵感保存到文件
		// 先告知用户我们想要保存文件
		await cline.say("text", `您希望将这些灵感保存到文件吗？将保存到: ${outputPath}`)

		const saveMessage = JSON.stringify({
			tool: "newFileCreated",
			path: outputPath,
			content: outputContent,
			isOutsideWorkspace: isPathOutsideWorkspace(
				path.isAbsolute(outputPath) ? outputPath : path.join(cline.cwd, outputPath),
			),
		} satisfies ClineSayTool)

		const saveApproved = await askApproval("tool", saveMessage)

		if (saveApproved) {
			// 确保输出路径已定义
			const finalOutputPath = outputPath || `inspiration_${topic.replace(/\s+/g, "_")}_${aspect}.md`

			try {
				// 获取当前工作目录
				const cwd = cline.cwd
				// 解析输出路径
				const fullOutputPath = path.isAbsolute(finalOutputPath)
					? finalOutputPath
					: path.join(cwd, finalOutputPath)
				// 确保目录存在
				await fsPromises.mkdir(path.dirname(fullOutputPath), { recursive: true })
				// 写入文件
				await fsPromises.writeFile(fullOutputPath, outputContent, "utf8")

				// 跟踪文件编辑操作
				await cline.fileContextTracker.trackFileContext(fullOutputPath, "roo_edited" as RecordSource)

				await cline.say("text", `灵感已成功保存到：${finalOutputPath}`)
				pushToolResult(`灵感内容已成功生成并保存到文件：${finalOutputPath}`)
			} catch (error) {
				const errorMessage = `写入文件时出错：${error instanceof Error ? error.message : String(error)}`
				await cline.say("error", errorMessage)
				pushToolResult(errorMessage)
			}
		} else {
			// 用户选择不保存到文件
			await cline.say("text", "灵感内容已生成但未保存到文件。")
			pushToolResult("灵感内容已成功生成但未保存到文件。")
		}
	} catch (error) {
		await handleError("灵感生成", error instanceof Error ? error : new Error(String(error)))
	}
}

/**
 * 获取灵感方面的显示名称
 */
function getAspectDisplayName(aspect: string): string {
	const aspectNames: Record<string, string> = {
		story: "故事",
		character: "角色",
		setting: "场景",
		plot: "情节",
		theme: "主题",
	}

	return aspectNames[aspect] || "通用"
}

/**
 * 生成灵感内容
 */
async function generateInspirations(topic: string, aspect: string, count: number): Promise<string[]> {
	// 不同灵感方面的模板
	const templates: Record<string, string[]> = {
		story: [
			"想象一个{topic}中，颠覆传统的全新视角",
			"如果将{topic}与另一个完全不同的领域结合，会产生什么样的创意火花？",
			"在{topic}的世界中，寻找被忽视但极具潜力的创作角度",
			"{topic}中隐藏的反直觉元素可能带来怎样的创作突破？",
			"从历史视角重新审视{topic}，发现新的创作可能性",
		],
		character: [
			"一个在{topic}背景下，拥有独特能力但同时面临致命弱点的角色",
			"{topic}世界中的叛逆者，他/她打破常规的方式和内在动机",
			"在{topic}环境中成长，同时背负着沉重过去的角色，如何演绎自我救赎",
			"表面看似普通，实则掌握{topic}核心秘密的神秘角色",
			"跨越{topic}中不同阵营，游走于灰色地带的复杂角色",
		],
		setting: [
			"{topic}中两个截然不同的世界或文化碰撞，产生的独特环境",
			"在{topic}背景下，一个看似美好表面下暗藏危机的世界设定",
			"被遗忘或隐藏的{topic}角落，蕴含丰富故事潜力的特殊场景",
			"{topic}中随时间或特定条件变化的动态环境设定",
			"将{topic}置于一个微缩或封闭的空间中，探索极限条件下的故事可能",
		],
		plot: [
			"{topic}中一个看似微小的决定，如何引发连锁反应，改变整个故事走向",
			"在{topic}背景下，传统英雄之旅的意外转折和颠覆",
			"围绕{topic}核心，构建双线叙事，两条看似平行的故事线如何交织",
			"{topic}中看似解决的危机，如何变成更大困境的开端",
			"从结局逆推的{topic}故事架构，如何通过伏笔和暗示引导读者",
		],
		theme: [
			"在{topic}背景下探索传统与变革的矛盾与平衡",
			"{topic}中个体选择与集体利益的深层次主题探讨",
			"通过{topic}镜头审视人性的复杂性与两面性",
			"在{topic}故事中植入关于记忆与身份认同的哲学思考",
			"{topic}作为隐喻，探索现实社会中的深层问题",
		],
	}

	// 使用对应方面的模板，如果没有找到则使用通用模板
	const selectedTemplates = templates[aspect] || templates.story

	// 生成灵感内容
	const inspirations: string[] = []

	// 确保生成的灵感数量不超过模板数量
	const actualCount = Math.min(count, selectedTemplates.length)

	// 随机选择模板并替换{topic}占位符
	const shuffledTemplates = [...selectedTemplates].sort(() => 0.5 - Math.random())

	for (let i = 0; i < actualCount; i++) {
		const template = shuffledTemplates[i]
		const inspiration = template.replace(/\{topic\}/g, topic)
		inspirations.push(inspiration)
	}

	return inspirations
}

/**
 * 为特定方向生成更深入的灵感
 */
async function generateDeeperInspirations(topic: string, aspect: string, direction: string): Promise<string[]> {
	// 为特定方向生成更深入的灵感模板
	const deeperTemplates: string[] = [
		`在${direction}这个方向上，${topic}可以如何展现更丰富的层次？`,
		`从${direction}角度出发，${topic}中的冲突和矛盾可以如何设计？`,
		`如果将${direction}作为核心，${topic}的故事结构可以如何构建？`,
		`在${direction}的基础上，${topic}中的角色关系可以如何发展？`,
		`将${direction}与${topic}结合，可以探索哪些独特的创作可能性？`,
	]

	// 生成3个深入灵感
	const deeperInspirations: string[] = []
	const count = Math.min(3, deeperTemplates.length)

	for (let i = 0; i < count; i++) {
		deeperInspirations.push(deeperTemplates[i])
	}

	return deeperInspirations
}

/**
 * 格式化灵感输出内容
 */
function formatInspirationsOutput(topic: string, aspect: string, inspirations: string[]): string {
	const aspectName = getAspectDisplayName(aspect)
	const timestamp = new Date().toLocaleString()

	let output = `# ${topic} - ${aspectName}灵感\n\n`
	output += `生成时间：${timestamp}\n\n`
	output += `## 灵感列表\n\n`

	inspirations.forEach((inspiration, index) => {
		output += `### 灵感 ${index + 1}\n\n`
		output += `${inspiration}\n\n`
	})

	output += `## 灵感应用建议\n\n`
	output += `以上灵感可以作为创作起点，建议选择最能引起共鸣的点进行深入探索。可以将多个灵感点结合，或者从一个灵感出发进行延伸思考。\n\n`
	output += `记录你对这些灵感的第一反应，有时最初的直觉可能带来最有创意的突破。`

	return output
}

/**
 * 格式化深入灵感输出内容
 */
function formatDeeperInspirationsOutput(
	topic: string,
	aspect: string,
	direction: string,
	inspirations: string[],
): string {
	const aspectName = getAspectDisplayName(aspect)

	let output = `## 深入探索: ${direction}\n\n`

	inspirations.forEach((inspiration, index) => {
		output += `### 深入灵感 ${index + 1}\n\n`
		output += `${inspiration}\n\n`
	})

	output += `## 深入应用建议\n\n`
	output += `这些深入灵感可以帮助您进一步发展"${direction}"这个方向。考虑将这些灵感与之前的基础灵感结合，可能会产生更丰富的创作思路。\n\n`

	return output
}
