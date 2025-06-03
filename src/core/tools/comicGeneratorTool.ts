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
	ToolDescription,
	AskFinishSubTaskApproval,
} from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { askFollowupQuestionTool } from "./askFollowupQuestionTool"
import { newTaskTool } from "./newTaskTool"

// 文件大小阈值（字节）
const LARGE_FILE_THRESHOLD = 20 * 1024 // 20KB
const SUBTASK_CHUNK_SIZE = 10 * 1024 // 10KB，每个子任务处理的大小

// 定义工具参数接口
interface ComicGeneratorParams {
	content?: string
	style?: string
	layout?: string
	panels?: string
	output_path?: string
}

/**
 * 漫画生成工具 - 创建漫画风格的图文内容
 */
export async function comicGeneratorTool(
	cline: Task,
	block: ToolUse & { params: ComicGeneratorParams },
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
	toolDescription?: ToolDescription,
	askFinishSubTaskApproval?: AskFinishSubTaskApproval,
) {
	try {
		// 获取参数
		const content = block.params.content
		const style = block.params.style || "manga"
		const layout = block.params.layout || "vertical"
		const panels = parseInt(block.params.panels || "6", 10)
		const outputPath = block.params.output_path || `comic_${new Date().getTime()}.html`

		// 检查参数有效性
		if (!content) {
			await cline.say("text", "请提供要创建漫画的文本内容。")
			pushToolResult("未提供文本内容，请在对话中提供文本。")
			return
		}

		// 验证样式
		const validStyles = ["manga", "american", "european", "chibi", "minimalist"]
		if (!validStyles.includes(style)) {
			const errorMessage = `无效的样式。有效的样式选项包括: ${validStyles.join(", ")}`
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		// 验证布局
		const validLayouts = ["vertical", "horizontal", "grid", "freeform"]
		if (!validLayouts.includes(layout)) {
			const errorMessage = `无效的布局。有效的布局选项包括: ${validLayouts.join(", ")}`
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		// 验证面板数量
		if (typeof panels === "number" && (panels < 1 || panels > 20)) {
			const errorMessage = "面板数量必须在1到20之间。"
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
			return
		}

		// 处理部分工具使用
		if (block.partial) {
			const partialMessageProps = {
				tool: "comic_generator" as const,
				content: content,
				output_path: outputPath,
				style: style,
				layout: layout,
				panels: panels,
			}
			await cline.ask("tool", JSON.stringify(partialMessageProps), block.partial).catch(() => {})
			return
		}

		// 重置连续错误计数
		cline.consecutiveMistakeCount = 0

		// 告知用户生成进度
		await cline.say(
			"text",
			`正在使用${getStyleDisplayName(style)}风格和${getLayoutDisplayName(layout)}布局创建漫画内容...`,
		)

		// 检查内容大小，决定是否需要创建子任务
		if (content.length > LARGE_FILE_THRESHOLD) {
			await cline.say("text", `内容较长，将分拆为多个子任务处理。`)

			// 计算需要的子任务数量
			const numSubtasks = Math.ceil(content.length / SUBTASK_CHUNK_SIZE)

			// 创建子任务
			const taskMessage = `为漫画内容创建图文，将分为${numSubtasks}个子任务处理。`
			const taskBlock = {
				type: "tool_use" as const,
				name: "new_task" as const,
				params: {
					mode: "visual-text",
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
					await cline.say("text", `已创建漫画生成子任务。将内容分为${numSubtasks}个块进行处理。`)

					// 分块处理内容
					await processContentInChunks(content, style, layout, panels, outputPath)
				},
				removeClosingTag,
			)

			return
		}

		// 生成漫画内容
		const comicContent = await generateComicContent(content, style, layout, panels)

		// 确保输出路径已定义
		const finalOutputPath = outputPath || `comic_${style}_${layout}.html`

		// 写入漫画内容到文件
		try {
			const dirPath = path.dirname(path.resolve(cline.cwd, finalOutputPath))
			await fsPromises.mkdir(dirPath, { recursive: true })
			await fsPromises.writeFile(path.resolve(cline.cwd, finalOutputPath), comicContent, "utf-8")

			// 返回成功消息
			const successMessage = `漫画内容已生成并保存到：${finalOutputPath}`
			await cline.say("text", successMessage)

			// 询问用户是否满意生成的结果
			const followupBlock = {
				type: "tool_use" as const,
				name: "ask_followup_question" as const,
				params: {
					question: "您对生成的漫画内容满意吗？如果需要调整，请告诉我需要修改的地方。",
				},
				partial: false,
			}

			await askFollowupQuestionTool(
				cline,
				followupBlock,
				askApproval,
				handleError,
				async (result) => {
					if (result && typeof result === "string") {
						if (
							result.toLowerCase().includes("满意") ||
							result.toLowerCase().includes("好") ||
							result.toLowerCase().includes("yes")
						) {
							await cline.say("text", "很高兴您满意这个结果！如果需要创建更多漫画内容，请随时告诉我。")
						} else {
							await cline.say(
								"text",
								"我会根据您的反馈进行调整。请提供更具体的修改建议，我会重新生成漫画内容。",
							)
						}
					}
				},
				removeClosingTag,
			)

			pushToolResult(`漫画内容已成功生成并保存到文件：${finalOutputPath}`)
		} catch (error) {
			const errorMessage = `写入漫画内容失败：${error instanceof Error ? error.message : String(error)}`
			await cline.say("error", errorMessage)
			pushToolResult(errorMessage)
		}
	} catch (error) {
		await handleError("漫画内容创建", error)
	}
}

/**
 * 分块处理内容
 */
async function processContentInChunks(
	content: string,
	style: string,
	layout: string,
	panels: number,
	outputPath: string,
): Promise<void> {
	// 这里实现分块处理逻辑
	// 由于这是一个复杂过程，实际实现时需要考虑如何合并多个子任务的结果
	// 简化版本：将内容分成多个部分，每个部分生成一个漫画页面，最后合并

	const chunks = []
	const chunkSize = SUBTASK_CHUNK_SIZE

	// 分块
	for (let i = 0; i < content.length; i += chunkSize) {
		const chunk = content.substring(i, i + chunkSize)
		chunks.push(chunk)
	}

	// 为每个块生成漫画内容
	const comicPages = []
	for (let i = 0; i < chunks.length; i++) {
		const pageContent = await generateComicContent(chunks[i], style, layout, panels)
		comicPages.push(pageContent)
	}

	// 合并所有页面
	const combinedContent = combineComicPages(comicPages)

	// 写入合并后的内容
	try {
		await fsPromises.writeFile(outputPath, combinedContent, "utf-8")
	} catch (error) {
		console.error("写入合并漫画内容失败:", error)
	}
}

/**
 * 合并多个漫画页面
 */
function combineComicPages(pages: string[]): string {
	// 提取每个页面的主体内容，然后合并
	const bodyContents = pages.map((page) => {
		const bodyMatch = page.match(/<body>([\s\S]*?)<\/body>/i)
		return bodyMatch ? bodyMatch[1] : page
	})

	// 使用第一个页面作为模板
	let combinedPage = pages[0]

	// 替换模板的主体内容
	combinedPage = combinedPage.replace(/<body>([\s\S]*?)<\/body>/i, `<body>\n${bodyContents.join("\n")}\n</body>`)

	return combinedPage
}

/**
 * 获取样式的显示名称
 */
function getStyleDisplayName(style: string): string {
	const styleNames: Record<string, string> = {
		manga: "日式漫画",
		american: "美式漫画",
		european: "欧式漫画",
		chibi: "Q版漫画",
		minimalist: "极简漫画",
	}

	return styleNames[style] || style
}

/**
 * 获取布局的显示名称
 */
function getLayoutDisplayName(layout: string): string {
	const layoutNames: Record<string, string> = {
		vertical: "垂直布局",
		horizontal: "水平布局",
		grid: "网格布局",
		freeform: "自由布局",
	}

	return layoutNames[layout] || layout
}

/**
 * 生成漫画内容
 */
async function generateComicContent(content: string, style: string, layout: string, panels: number): Promise<string> {
	// 分析内容，提取场景、对话和动作
	const scenes = analyzeContent(content)

	// 根据场景数量和指定的面板数调整面板布局
	const finalPanelCount = Math.min(scenes.length, panels)

	// 获取CSS样式
	const cssStyle = getComicCSS(style, layout)

	// 生成漫画HTML
	const comicHtml = generateComicHtml(scenes, finalPanelCount, style, layout)

	// 组合完整的HTML文档
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>漫画内容</title>
  <style>
${cssStyle}
  </style>
</head>
<body>
  <div class="comic-container ${style}-style ${layout}-layout">
${comicHtml}
    <div class="download-section">
      <p>要将此漫画保存为Word文档，请在浏览器中全选内容(Ctrl+A)并复制(Ctrl+C)，然后粘贴到Word文档中。</p>
    </div>
  </div>
</body>
</html>`
}

/**
 * 分析内容，提取场景、对话和动作
 */
function analyzeContent(content: string): Array<{
	description: string
	dialogue?: string
	action?: string
}> {
	// 简单的分析：按段落拆分，尝试识别对话（引号内容）和动作描述
	const paragraphs = content.split(/\n+/).filter((p) => p.trim())
	const scenes = []

	for (const paragraph of paragraphs) {
		const scene: {
			description: string
			dialogue?: string
			action?: string
		} = {
			description: paragraph,
		}

		// 尝试提取对话（引号中的内容）
		const dialogueMatch = paragraph.match(/"([^"]+)"/)
		if (dialogueMatch) {
			scene.dialogue = dialogueMatch[1]
			// 移除对话部分，剩下的可能是动作描述
			const withoutDialogue = paragraph.replace(dialogueMatch[0], "").trim()
			if (withoutDialogue) {
				scene.action = withoutDialogue
			}
		} else {
			// 没有对话，整段可能是动作描述
			scene.action = paragraph
		}

		scenes.push(scene)
	}

	return scenes
}

/**
 * 获取漫画样式的CSS
 */
function getComicCSS(style: string, layout: string): string {
	// 基础CSS
	const baseCSS = `
    body {
      font-family: 'Comic Sans MS', 'Lato', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
      margin: 0;
      padding: 0;
    }
    
    .comic-container {
      max-width: 1000px;
      margin: 20px auto;
      background-color: white;
      box-shadow: 0 0 15px rgba(0,0,0,0.1);
      padding: 20px;
      position: relative;
    }
    
    .comic-panel {
      position: relative;
      margin-bottom: 20px;
      background-color: #fff;
      border: 2px solid #000;
      box-shadow: 5px 5px 0 rgba(0,0,0,0.2);
      overflow: hidden;
    }
    
    .panel-content {
      padding: 15px;
      position: relative;
    }
    
    .panel-description {
      font-size: 14px;
      color: #555;
      margin-bottom: 10px;
      font-style: italic;
    }
    
    .panel-image {
      width: 100%;
      height: 200px;
      background-color: #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 10px;
    }
    
    .panel-image svg {
      max-width: 100%;
      max-height: 100%;
    }
    
    .speech-bubble {
      position: relative;
      background: #fff;
      border-radius: 20px;
      padding: 10px 15px;
      margin: 10px;
      display: inline-block;
      border: 2px solid #000;
      max-width: 80%;
      font-weight: bold;
    }
    
    .speech-bubble:after {
      content: '';
      position: absolute;
      bottom: -15px;
      left: 20px;
      border-width: 15px 15px 0;
      border-style: solid;
      border-color: #fff transparent;
      display: block;
      width: 0;
    }
    
    .speech-bubble:before {
      content: '';
      position: absolute;
      bottom: -18px;
      left: 18px;
      border-width: 17px 17px 0;
      border-style: solid;
      border-color: #000 transparent;
      display: block;
      width: 0;
    }
    
    .action-text {
      font-style: italic;
      font-size: 16px;
      color: #444;
      margin: 10px 0;
    }
    
    .download-section {
      margin-top: 30px;
      padding: 15px;
      background-color: #f8f9fa;
      border-radius: 5px;
      font-size: 0.9em;
      color: #666;
      text-align: center;
    }
  `

	// 样式特定CSS
	const styleCSS: Record<string, string> = {
		manga: `
    .manga-style .comic-panel {
      border-radius: 0;
      border-width: 3px;
    }
    
    .manga-style .speech-bubble {
      border-radius: 30px;
      font-family: 'Comic Sans MS', cursive;
    }
    
    .manga-style .action-text {
      font-weight: bold;
      text-transform: uppercase;
    }
    `,

		american: `
    .american-style .comic-panel {
      border-radius: 5px;
      box-shadow: 8px 8px 0 rgba(0,0,0,0.3);
    }
    
    .american-style .speech-bubble {
      background-color: #ffffa0;
      border-color: #e0e000;
    }
    
    .american-style .speech-bubble:after {
      border-color: #ffffa0 transparent;
    }
    
    .american-style .speech-bubble:before {
      border-color: #e0e000 transparent;
    }
    
    .american-style .action-text {
      color: #d04000;
      font-weight: bold;
    }
    `,

		european: `
    .european-style .comic-panel {
      border-width: 1px;
      box-shadow: 3px 3px 10px rgba(0,0,0,0.1);
    }
    
    .european-style .speech-bubble {
      border-radius: 5px;
      background-color: #fff;
      font-family: Georgia, serif;
    }
    
    .european-style .action-text {
      font-family: Georgia, serif;
      font-size: 14px;
    }
    `,

		chibi: `
    .chibi-style .comic-panel {
      border-radius: 20px;
      border-width: 4px;
      border-color: #ff6b6b;
    }
    
    .chibi-style .speech-bubble {
      border-radius: 50px;
      background-color: #ffe8f0;
      border-color: #ff6b6b;
      font-family: 'Comic Sans MS', cursive;
    }
    
    .chibi-style .speech-bubble:after {
      border-color: #ffe8f0 transparent;
    }
    
    .chibi-style .speech-bubble:before {
      border-color: #ff6b6b transparent;
    }
    
    .chibi-style .action-text {
      color: #ff6b6b;
      font-weight: bold;
    }
    `,

		minimalist: `
    .minimalist-style .comic-panel {
      border: 1px solid #ddd;
      box-shadow: none;
    }
    
    .minimalist-style .speech-bubble {
      border-radius: 0;
      border-width: 1px;
      background-color: #f9f9f9;
      font-family: Arial, sans-serif;
    }
    
    .minimalist-style .speech-bubble:after,
    .minimalist-style .speech-bubble:before {
      display: none;
    }
    
    .minimalist-style .action-text {
      font-style: normal;
      font-size: 14px;
    }
    `,
	}

	// 布局特定CSS
	const layoutCSS: Record<string, string> = {
		vertical: `
    .vertical-layout .comic-panel {
      width: 100%;
      margin-bottom: 30px;
    }
    `,

		horizontal: `
    .horizontal-layout {
      display: flex;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding-bottom: 20px;
    }
    
    .horizontal-layout .comic-panel {
      flex: 0 0 300px;
      margin-right: 20px;
      height: 400px;
    }
    `,

		grid: `
    .grid-layout {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      grid-gap: 20px;
    }
    
    .grid-layout .comic-panel {
      margin-bottom: 0;
    }
    `,

		freeform: `
    .freeform-layout .comic-panel {
      margin: 20px;
      transform: rotate(var(--rotation, 0deg));
    }
    
    .freeform-layout .comic-panel:nth-child(odd) {
      --rotation: -1deg;
    }
    
    .freeform-layout .comic-panel:nth-child(even) {
      --rotation: 1deg;
    }
    `,
	}

	return `${baseCSS}\n${styleCSS[style] || ""}\n${layoutCSS[layout] || ""}`
}

/**
 * 生成漫画HTML
 */
function generateComicHtml(
	scenes: Array<{ description: string; dialogue?: string; action?: string }>,
	panelCount: number,
	style: string,
	layout: string,
): string {
	let html = ""

	// 限制场景数量
	const limitedScenes = scenes.slice(0, panelCount)

	// 为每个场景生成面板
	limitedScenes.forEach((scene, index) => {
		html += `    <div class="comic-panel panel-${index + 1}">
      <div class="panel-content">
        <div class="panel-image">
          ${generateSceneSVG(scene, style, index)}
        </div>
        <div class="panel-description">${scene.description}</div>
        ${scene.dialogue ? `<div class="speech-bubble">${scene.dialogue}</div>` : ""}
        ${scene.action ? `<div class="action-text">${scene.action}</div>` : ""}
      </div>
    </div>\n`
	})

	return html
}

/**
 * 为场景生成SVG图像
 */
function generateSceneSVG(
	scene: { description: string; dialogue?: string; action?: string },
	style: string,
	index: number,
): string {
	// 根据不同的漫画风格和场景内容生成不同的SVG
	// 这里使用简单的SVG图形来模拟漫画场景

	const svgStyles: Record<string, { background: string; character: string; accent: string }> = {
		manga: {
			background: "#f0f0f0",
			character: "#333",
			accent: "#4a90e2",
		},
		american: {
			background: "#ffffc0",
			character: "#d04000",
			accent: "#0060a0",
		},
		european: {
			background: "#fff",
			character: "#555",
			accent: "#789",
		},
		chibi: {
			background: "#ffe8f0",
			character: "#ff6b6b",
			accent: "#ffb8c0",
		},
		minimalist: {
			background: "#f9f9f9",
			character: "#555",
			accent: "#ddd",
		},
	}

	const colors = svgStyles[style] || svgStyles.manga

	// 根据场景内容选择不同的图形
	let svgContent = ""

	// 判断场景类型（对话、动作等）
	if (scene.dialogue && scene.action) {
		// 对话和动作场景：显示人物和对话气泡
		svgContent = `
      <rect width="100%" height="100%" fill="${colors.background}" />
      <circle cx="30%" cy="50%" r="40" fill="${colors.character}" />
      <circle cx="70%" cy="50%" r="40" fill="${colors.accent}" />
      <path d="M 40% 50% Q 50% 30% 60% 50%" stroke="#333" stroke-width="3" fill="none" />
    `
	} else if (scene.dialogue) {
		// 纯对话场景：显示对话气泡
		svgContent = `
      <rect width="100%" height="100%" fill="${colors.background}" />
      <circle cx="50%" cy="50%" r="60" fill="${colors.character}" />
      <path d="M 60% 30% L 80% 20% L 70% 40%" fill="${colors.background}" />
    `
	} else if (scene.action) {
		// 动作场景：显示动态线条
		svgContent = `
      <rect width="100%" height="100%" fill="${colors.background}" />
      <path d="M 20% 20% L 80% 80%" stroke="${colors.accent}" stroke-width="10" />
      <path d="M 80% 20% L 20% 80%" stroke="${colors.accent}" stroke-width="10" />
      <circle cx="50%" cy="50%" r="30" fill="${colors.character}" />
    `
	} else {
		// 一般描述场景：显示简单背景
		svgContent = `
      <rect width="100%" height="100%" fill="${colors.background}" />
      <rect x="10%" y="60%" width="80%" height="30%" fill="${colors.accent}" />
      <circle cx="30%" cy="40%" r="20" fill="${colors.character}" />
      <circle cx="70%" cy="30%" r="15" fill="${colors.character}" />
    `
	}

	return `<svg width="100%" height="100%" viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg">
    ${svgContent}
    <text x="50%" y="90%" text-anchor="middle" fill="#333" font-size="12">场景 ${index + 1}</text>
  </svg>`
}
