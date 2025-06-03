import delay from "delay"

import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { Task } from "../task/Task"
import { defaultModeSlug, getModeBySlug } from "../../shared/modes"
import { formatResponse } from "../prompts/responses"

/**
 * 子任务工具 - 创建新的子任务
 *
 * 此工具允许在所有模式下创建子任务，特别适合处理需要大量输出的小说创作任务。
 * 当任务预计会产生大量文本（如小说章节、长篇描述等）时，可以使用此工具将工作拆分为多个子任务。
 */
export async function newTaskTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const mode: string | undefined = block.params.mode
	const message: string | undefined = block.params.message

	try {
		if (block.partial) {
			const partialMessage = JSON.stringify({
				tool: "newTask",
				mode: removeClosingTag("mode", mode),
				message: removeClosingTag("message", message),
			})

			await cline.ask("tool", partialMessage, block.partial).catch(() => {})
			return
		} else {
			if (!mode) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("new_task")
				pushToolResult(await cline.sayAndCreateMissingParamError("new_task", "mode"))
				return
			}

			if (!message) {
				cline.consecutiveMistakeCount++
				cline.recordToolError("new_task")
				pushToolResult(await cline.sayAndCreateMissingParamError("new_task", "message"))
				return
			}

			cline.consecutiveMistakeCount = 0

			// Verify the mode exists
			const targetMode = getModeBySlug(mode, (await cline.providerRef.deref()?.getState())?.customModes)

			if (!targetMode) {
				pushToolResult(formatResponse.toolError(`无效的模式: ${mode}`))
				return
			}

			// 检查当前任务是否已经是子任务的一部分
			// 如果是多层嵌套的子任务，提供警告但允许继续
			const nestingLevel = getNestingLevel(cline)
			if (nestingLevel > 2) {
				await cline.say(
					"text",
					`警告：您正在创建嵌套层级较深的子任务（当前层级：${nestingLevel}）。过多的嵌套可能导致上下文丢失。`,
				)
			}

			// 检查是否是小说相关的任务
			const isNovelTask = isNovelRelatedMode(mode) || isNovelRelatedMessage(message)

			let toolMessage
			if (isNovelTask) {
				toolMessage = JSON.stringify({
					tool: "newTask",
					mode: targetMode.name,
					content: message,
					taskType: "novel",
				})
			} else {
				toolMessage = JSON.stringify({
					tool: "newTask",
					mode: targetMode.name,
					content: message,
				})
			}

			// 自动批准子任务创建，无需用户确认
			// 如果设置中启用了子任务自动批准，或者这是小说创作相关的任务
			const state = await cline.providerRef.deref()?.getState()
			const alwaysAllowSubtasks = state?.alwaysAllowSubtasks || isNovelTask

			let didApprove = true
			if (!alwaysAllowSubtasks) {
				didApprove = await askApproval("tool", toolMessage)
			}

			if (!didApprove) {
				return
			}

			const provider = cline.providerRef.deref()

			if (!provider) {
				return
			}

			if (cline.enableCheckpoints) {
				cline.checkpointSave(true)
			}

			// Preserve the current mode so we can resume with it later.
			cline.pausedModeSlug = (await provider.getState()).mode ?? defaultModeSlug

			// Switch mode first, then create new task instance.
			await provider.handleModeSwitch(mode)

			// Delay to allow mode change to take effect before next tool is executed.
			await delay(500)

			const newCline = await provider.initClineWithTask(message, undefined, cline)
			cline.emit("taskSpawned", newCline.taskId)

			if (isNovelTask) {
				pushToolResult(`成功在${targetMode.name}模式下创建新的小说创作子任务：${message}`)
			} else {
				pushToolResult(`成功在${targetMode.name}模式下创建新任务：${message}`)
			}

			// Set the isPaused flag to true so the parent
			// task can wait for the sub-task to finish.
			cline.isPaused = true
			cline.emit("taskPaused")

			return
		}
	} catch (error) {
		await handleError("creating new task", error)
		return
	}
}

/**
 * 获取当前任务的嵌套层级
 * @param task 当前任务
 * @returns 嵌套层级数（1表示顶层任务）
 */
function getNestingLevel(task: Task): number {
	let level = 1
	let current = task

	while (current.parentTask) {
		level++
		current = current.parentTask
	}

	return level
}

/**
 * 判断是否是小说相关的模式
 * @param mode 模式名称
 * @returns 是否是小说相关模式
 */
function isNovelRelatedMode(mode: string): boolean {
	const novelModes = [
		"novel",
		"expansion",
		"inspiration",
		"imitation",
		"novel_analysis",
		"novel_framework",
		"script_adaptation",
	]

	return novelModes.some((m) => mode.toLowerCase().includes(m))
}

/**
 * 判断消息是否与小说创作相关
 * @param message 消息内容
 * @returns 是否是小说相关消息
 */
function isNovelRelatedMessage(message: string): boolean {
	const novelKeywords = [
		"小说",
		"故事",
		"章节",
		"角色",
		"情节",
		"扩写",
		"创作",
		"novel",
		"story",
		"chapter",
		"character",
		"plot",
		"expansion",
		"writing",
	]

	return novelKeywords.some((keyword) => message.toLowerCase().includes(keyword.toLowerCase()))
}
