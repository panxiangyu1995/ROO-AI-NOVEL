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
	NovelFrameworkRefineToolUse,
} from "../../shared/tools"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { askFollowupQuestionTool } from "./askFollowupQuestionTool"

/**
 * 小说框架完善工具
 * 提供框架完善方向和内容选项，帮助用户选择需要完善的框架部分
 */
export async function novelFrameworkRefineTool(
	cline: Task,
	block: NovelFrameworkRefineToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	try {
		// 检查当前模式是否为小说框架模式
		const provider = cline.providerRef.deref()
		const state = provider ? await provider.getState() : null
		const currentMode = state?.mode ?? ""

		if (currentMode !== "planner") {
			await cline.say("text", "请先切换到小说框架模式(planner)再使用此工具。")
			pushToolResult(formatResponse.toolError("此工具只能在小说框架模式下使用。"))
			return
		}

		// 提取参数
		const frameworkPath = block.params.path || ""
		const targetArea = block.params.area || "all" // 完善的目标区域：character, plot, world, all

		// 如果是部分工具使用，直接返回
		if (block.partial) {
			return
		}

		// 验证框架文件路径
		if (!frameworkPath) {
			pushToolResult(formatResponse.toolError("请提供小说框架文件路径。"))
			return
		}

		// 获取工作区根路径
		const rootPath = cline.cwd

		// 构建完整文件路径
		const fullPath = path.isAbsolute(frameworkPath) ? frameworkPath : path.join(rootPath, frameworkPath)

		// 检查文件是否存在
		if (!(await fileExistsAtPath(fullPath))) {
			pushToolResult(formatResponse.toolError(`文件不存在: ${frameworkPath}`))
			return
		}

		// 检查是否为Markdown文件
		if (!fullPath.toLowerCase().endsWith(".md")) {
			pushToolResult(formatResponse.toolError("只支持Markdown格式的框架文件。"))
			return
		}

		// 读取框架文件内容
		const frameworkContent = await fs.readFile(fullPath, "utf8")

		// 分析框架内容，确定可完善的方向
		const refinementOptions = analyzeFramework(frameworkContent)

		// 根据目标区域过滤选项
		const filteredOptions =
			targetArea === "all" ? refinementOptions : refinementOptions.filter((option) => option.area === targetArea)

		if (filteredOptions.length === 0) {
			pushToolResult(formatResponse.toolError(`未找到可完善的${targetArea}相关内容。`))
			return
		}

		// 记录文件访问
		await cline.fileContextTracker.trackFileContext(fullPath, "roo_read" as RecordSource)

		// 使用ask_followup_question工具提供选项给用户
		const optionsMessage = formatOptionsMessage(filteredOptions)

		// 创建一个用于ask_followup_question的工具使用块
		const followupBlock = {
			type: "tool_use" as const,
			name: "ask_followup_question" as const,
			params: {
				question: optionsMessage,
			},
			partial: false,
		}

		// 调用askFollowupQuestionTool
		await askFollowupQuestionTool(
			cline,
			followupBlock,
			askApproval,
			handleError,
			(result) => {
				// 处理用户选择的结果
				pushToolResult(`已提供框架完善选项，等待用户选择。用户可以选择一个或多个选项进行完善。`)
			},
			removeClosingTag,
		)
	} catch (error) {
		await handleError("analyzing novel framework", error as Error)
	}
}

/**
 * 分析框架内容，确定可完善的方向
 */
function analyzeFramework(content: string): RefinementOption[] {
	const options: RefinementOption[] = []

	// 检查角色部分
	if (content.includes("## 主要角色") || content.includes("## 角色设计")) {
		if (!content.includes("性格特点") || !content.includes("背景故事")) {
			options.push({
				id: "character_detail",
				area: "character",
				title: "完善角色详情",
				description: "为主要角色添加更详细的性格特点、背景故事和动机描述",
			})
		}

		if (!content.includes("角色关系图") || !content.includes("角色成长轨迹")) {
			options.push({
				id: "character_relations",
				area: "character",
				title: "完善角色关系",
				description: "添加或完善角色之间的关系网络和互动模式",
			})
		}

		if (!content.includes("角色对话风格") && !content.includes("语言特点")) {
			options.push({
				id: "character_voice",
				area: "character",
				title: "添加角色对话风格",
				description: "为每个主要角色定义独特的对话风格和语言特点",
			})
		}
	}

	// 检查情节部分
	if (content.includes("## 故事大纲") || content.includes("## 主要情节线")) {
		if (!content.includes("故事流程图") && !content.includes("故事时间线")) {
			options.push({
				id: "plot_timeline",
				area: "plot",
				title: "添加故事时间线",
				description: "创建详细的故事时间线或流程图，明确事件发生的顺序和因果关系",
			})
		}

		if (!content.includes("转折点") || !content.includes("高潮")) {
			options.push({
				id: "plot_structure",
				area: "plot",
				title: "完善故事结构",
				description: "明确故事的关键转折点、冲突升级和高潮部分",
			})
		}

		if (!content.includes("支线") || !content.includes("subplot")) {
			options.push({
				id: "subplots",
				area: "plot",
				title: "设计支线故事",
				description: "添加与主线相关的支线故事，丰富整体叙事",
			})
		}

		if (!content.includes("章节大纲")) {
			options.push({
				id: "chapter_outline",
				area: "plot",
				title: "创建章节大纲",
				description: "将故事划分为具体章节，并为每章设定内容概要",
			})
		}
	}

	// 检查世界观部分
	if (content.includes("## 世界观") || content.includes("## 世界观设定")) {
		if (!content.includes("社会结构") && !content.includes("政治体系")) {
			options.push({
				id: "world_society",
				area: "world",
				title: "完善社会结构",
				description: "详细描述故事世界的社会组织、政治体系和权力结构",
			})
		}

		if (!content.includes("地理环境") && !content.includes("世界地图")) {
			options.push({
				id: "world_geography",
				area: "world",
				title: "添加地理环境",
				description: "描述故事发生地的地理环境、气候特点和重要地标",
			})
		}

		if (!content.includes("历史背景") && !content.includes("历史事件")) {
			options.push({
				id: "world_history",
				area: "world",
				title: "补充历史背景",
				description: "添加影响当前故事的重要历史事件和背景",
			})
		}

		if (!content.includes("文化习俗") && !content.includes("宗教信仰")) {
			options.push({
				id: "world_culture",
				area: "world",
				title: "丰富文化元素",
				description: "添加故事世界的文化习俗、宗教信仰和价值观念",
			})
		}
	}

	// 如果没有找到特定区域的内容，添加通用选项
	if (options.length === 0) {
		options.push(
			{
				id: "add_characters",
				area: "character",
				title: "添加角色设计",
				description: "创建主要角色、反派角色和次要角色的详细设计",
			},
			{
				id: "add_plot",
				area: "plot",
				title: "添加故事大纲",
				description: "设计故事的整体架构、主要情节线和转折点",
			},
			{
				id: "add_world",
				area: "world",
				title: "添加世界观设定",
				description: "创建故事发生的世界背景、规则和历史",
			},
			{
				id: "add_themes",
				area: "theme",
				title: "添加主题探索",
				description: "定义故事要探索的核心主题和思想",
			},
		)
	}

	// 始终添加一个整体完善选项
	options.push({
		id: "comprehensive_review",
		area: "all",
		title: "全面审查与完善",
		description: "对整个框架进行全面审查，找出不一致之处并提供完善建议",
	})

	return options
}

/**
 * 格式化选项消息
 */
function formatOptionsMessage(options: RefinementOption[]): string {
	let message = "请选择您想要完善的小说框架部分：\n\n"

	options.forEach((option, index) => {
		message += `${index + 1}. **${option.title}**：${option.description}\n`
	})

	message += '\n请回复选项编号（如"1"或"1,3,5"）或直接描述您想要完善的具体方向。'

	return message
}

/**
 * 完善选项接口
 */
interface RefinementOption {
	id: string
	area: string
	title: string
	description: string
}
