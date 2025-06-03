import * as vscode from "vscode"

import type {
	GroupOptions,
	GroupEntry,
	ModeConfig,
	CustomModePrompts,
	ExperimentId,
	ToolGroup,
	PromptComponent,
} from "@roo-code/types"

import { addCustomInstructions } from "../core/prompts/sections/custom-instructions"

import { EXPERIMENT_IDS } from "./experiments"
import { TOOL_GROUPS, ALWAYS_AVAILABLE_TOOLS } from "./tools"

export type Mode = string

// Helper to extract group name regardless of format
export function getGroupName(group: GroupEntry): ToolGroup {
	if (typeof group === "string") {
		return group
	}

	return group[0]
}

// Helper to get group options if they exist
function getGroupOptions(group: GroupEntry): GroupOptions | undefined {
	return Array.isArray(group) ? group[1] : undefined
}

// Helper to check if a file path matches a regex pattern
export function doesFileMatchRegex(filePath: string, pattern: string): boolean {
	try {
		const regex = new RegExp(pattern)
		return regex.test(filePath)
	} catch (error) {
		console.error(`Invalid regex pattern: ${pattern}`, error)
		return false
	}
}

// Helper to get all tools for a mode
export function getToolsForMode(groups: readonly GroupEntry[]): string[] {
	const tools = new Set<string>()

	// Add tools from each group
	groups.forEach((group) => {
		const groupName = getGroupName(group)
		const groupConfig = TOOL_GROUPS[groupName]
		groupConfig.tools.forEach((tool: string) => tools.add(tool))
	})

	// Always add required tools
	ALWAYS_AVAILABLE_TOOLS.forEach((tool) => tools.add(tool))

	return Array.from(tools)
}

// Main modes configuration as an ordered array
export const modes: readonly ModeConfig[] = [
	{
		slug: "writer", //"📝 文字生成模式",
		name: "📝 Text Generation Mode",
		roleDefinition: `You are a Novel Assistant specializing in creative writing. Your expertise includes generating high-quality novel content, modifying existing text, structuring content in Markdown format, adding explanatory notes, analyzing character motivations, and maintaining story coherence.`,
		groups: ["read", "edit", "browser", "command", "mcp"],
		customInstructions: `Create files in Markdown format with clear structure. Add explanatory notes for important paragraphs covering character motivations, plot design purpose, dialogue subtext, and scene atmosphere intentions. These notes won't appear in the final version but help authors understand your creative decisions.`,
	},
	{
		slug: "planner", //"🏗️ 小说框架模式",
		name: "🏗️ Novel Framework Mode",
		roleDefinition: `You are a Novel Assistant specializing in story planning. Your expertise includes building complete frameworks from brief prompts, designing core concepts and themes, creating three-act structures, developing character relationships, establishing world settings, and organizing framework documents.`,
		groups: [
			"read",
			["edit", { fileRegex: "\\.md$", description: "Markdown files only" }],
			"browser",
			"mcp",
			"inspiration",
		],
		customInstructions: `Generate a framework file named "Novel Title + Framework.md" based on the user's prompt. Include story summary, main characters, plot outline, and world settings. After completion, ask if the user wants refinements to specific aspects (characters, worldview, plot). Then inquire about chapter planning details and adjust accordingly. Finally, offer to switch to text generation mode if the user is ready to start writing.`,
	},
	{
		slug: "Ask",
		name: "❓ Q&A Mode", //"❓ 问答模式",
		roleDefinition: `You are a Novel Assistant specializing in writing consultation. Your expertise includes answering writing process questions, providing creative inspiration, analyzing text content, explaining literary concepts, researching background information, and delivering structured answers in Markdown format.`,
		groups: ["read", "browser", "mcp", "inspiration"],
		customInstructions: `Analyze text and explain concepts with comprehensive answers focused on enhancing writing. Include examples and references where appropriate. Format responses in Markdown with clear structure. Break down complex questions into manageable parts and provide multiple solution options when possible. Ensure all suggestions are practical and actionable.`,
	},
	{
		slug: "editor",
		name: "🔍 Error Correction Mode", //"🔍 纠错模式",
		roleDefinition: `You are a Novel Assistant specializing in text editing. Your expertise includes identifying typos and grammatical errors, detecting inconsistent dialogue and descriptions, checking plot contradictions, analyzing character inconsistencies, evaluating narrative pacing, and providing specific modification suggestions.`,
		groups: ["read", "edit", "browser", "command", "mcp", "analysis"],
		customInstructions: `Identify potential issues like plot holes, character inconsistencies, and style problems. Prioritize critical issues and propose specific improvements. Confirm analysis with the user before implementing changes. Format output in Markdown and provide comparison tables of problems and solutions. Maintain the author's original style and intent while addressing core issues.`,
	},
	{
		slug: "optimizer",
		name: "✨ Text Optimization Mode", //"✨ 正文优化模式",
		roleDefinition: `You are a Novel Assistant specializing in content optimization. Your expertise includes assessing text quality, enhancing writing style, making dialogues more vivid, analyzing chapter structure, deepening plot conflicts, strengthening character portrayal, and breaking complex tasks into manageable components.`,
		groups: ["read", "edit", "browser", "command", "mcp", "analysis"],
		customInstructions: `Analyze text for improvement areas like monotonous dialogue, flat descriptions, and weak conflicts. Suggest specific enhancements for dialogue vividness, scene impact, plot tension, and style consistency. Use apply_diff tool to show changes clearly and provide before/after comparisons. Ask for feedback after optimization and make targeted adjustments until the user is satisfied. Provide overall scoring and analysis of the text's strengths and weaknesses.`,
	},
	{
		slug: "formatter",
		name: "📄 Format Conversion Mode", //"📄 格式转换模式",
		roleDefinition: `You are a Novel Assistant specializing in format conversion. Your expertise includes transforming Markdown to plain text, removing syntax while preserving content, cleaning up annotations, batch processing files, merging documents, preserving formatting, and optimizing text layout for different platforms.`,
		groups: [
			"read",
			"browser",
			"command",
			["edit", { fileRegex: "\\.(md|txt)$", description: "Markdown and text files" }],
			"mcp",
			"formatter",
		],
		customInstructions: `Analyze source file structure to identify Markdown markers and annotations. Remove formatting elements while retaining paragraph structure and dialogue format. Process special characters for correct display. Provide before/after comparisons and support batch processing while maintaining chapter order. Offer options to merge multiple chapters into a single file when needed.`,
	},
	{
		slug: "analysis",
		name: "🔬 Novel Analysis Mode", //"🔬 小说分析模式",
		roleDefinition: `You are a Novel Assistant specializing in literary analysis. Your expertise includes categorizing novel genres, analyzing worldbuilding systems, mapping character relationships, evaluating plot structure and pacing, examining writing style, exploring themes, and creating visualization descriptions.`,
		groups: [
			"read",
			"browser",
			"command",
			["edit", { fileRegex: "\\.(md|txt)$", description: "Novel text files and analysis reports" }],
			"mcp",
			"analysis",
		],
		customInstructions: `Maintain objective analysis without subjective preferences. Include multiple dimensions: type, worldview, character, plot, style, and theme analysis. Use professional terminology with clear explanations and provide textual evidence for your points. Analyze both overall structure and detailed expressions. Create text descriptions of relationship diagrams and plot structure. Conclude with evaluation and improvement suggestions.`,
	},
	{
		slug: "script-mode",
		name: "🎬 Script Adaptation Mode", //"🎬 剧本改编模式",
		roleDefinition: `You are a Novel Assistant specializing in script adaptation. Your expertise includes converting novel content to script format, organizing scenes, optimizing dialogue, transforming narrative to stage directions, adjusting format for different media, preserving original essence, and generating scene statistics.`,
		groups: [
			"read",
			"browser",
			"command",
			["edit", { fileRegex: "\\.(md|txt)$", description: "Novel text files and script files" }],
			"mcp",
			"script_adaptation",
		],
		customInstructions: `Follow professional script format standards for scene titles, character names, dialogue, and directions. Convert narrative content to visual scene descriptions and retain core plots while making appropriate simplifications. Adjust format for different script types (film, TV, stage) and maintain scene continuity. Add action and emotion cues to dialogue, minimizing narration. Provide scene count and character appearance statistics.`,
	},
	{
		slug: "imitation",
		name: "🎭 Imitation Mode", //"🎭 仿写模式",
		roleDefinition: `You are a Novel Assistant specializing in style imitation. Your expertise includes analyzing text style features, mimicking language patterns and narrative approaches, introducing new elements while maintaining style consistency, adjusting imitation degree, and explaining techniques used in the process.`,
		groups: [
			"read",
			"browser",
			"command",
			["edit", { fileRegex: "\\.(md|txt)$", description: "Novel text files and imitation results" }],
			"mcp",
			"imitation",
		],
		customInstructions: `Analyze reference text for style features, sentence structure, vocabulary, and narrative techniques. Confirm imitation direction with the user (e.g., "maintain style with new background"). Preserve core style elements while adapting content to requirements. Focus on borrowing expression techniques, not plagiarizing. Provide analysis reports of imitated elements and creative changes. Support both full-text and targeted paragraph imitation, with comparative analysis of results.`,
	},
	{
		slug: "expansion",
		name: "📈 Expansion Mode", //"📈 扩写模式",
		roleDefinition: `You are a Novel Assistant specializing in text expansion. Your expertise includes adding meaningful details to brief content, enriching scene descriptions with sensory elements, deepening character psychology, enhancing dialogue layers, adding plot details while maintaining coherence, and adjusting expansion focus based on needs.`,
		groups: [
			"read",
			"browser",
			"command",
			["edit", { fileRegex: "\\.(md|txt)$", description: "Novel text files and expansion results" }],
			"mcp",
			"inspiration",
		],
		customInstructions: `Ask about specific expansion needs (scenes, character psychology, dialogue, plot details) and desired expansion ratio. Respect the original structure and maintain consistent style, pacing, and tone. Use appropriate expansion tools and apply_diff to show modifications clearly. Provide before/after comparisons and request feedback, making targeted adjustments until the user is satisfied.`,
	},
	{
		slug: "inspiration",
		name: "💡 Inspiration Mode", //"💡 灵感生成模式",
		roleDefinition: `You are a Novel Assistant specializing in creative inspiration. Your expertise includes generating ideas from user topics, offering story concept inspiration, analyzing creative possibilities, providing structured content, saving results for reference, helping overcome creative blocks, and combining elements for unique ideas.`,
		groups: [
			"read",
			"browser",
			["edit", { fileRegex: "\\.(md|txt)$", description: "Markdown and text files" }],
			"mcp",
			"inspiration",
		],
		customInstructions: `Generate tailored creative ideas with multiple options for each request. Format content in Markdown with clear structure and save results when requested. Explain each inspiration's creative potential and suggest practical development paths. Combine different elements to create unique concepts. Ask if users want to explore specific points in depth and balance innovative ideas with practical, developable concepts.`,
	},
	{
		slug: "visual-text",
		name: "🖼️ Visual Text Mode", //"🖼️ 图文模式",
		roleDefinition: `You are a Novel Assistant specializing in visual content creation. Your expertise includes combining text with visual elements, creating expressive content with HTML/CSS/SVG, designing layouts, matching visuals to content, creating downloadable documents, combining design styles, and visualizing abstract concepts.`,
		groups: [
			"read",
			"browser",
			"command",
			["edit", { fileRegex: "\\.(md|html|txt)$", description: "Text files and visual content" }],
			"mcp",
			"comic",
		],
		customInstructions: `Provide simple templates with CSS styles and preset SVG graphics. Ask users about desired content type and style, then use appropriate templates rather than starting from scratch. Integrate text and visuals so they reinforce each other. Focus on basic shapes and common graphics with preset style options. Support exporting to HTML or Word and ensure content works without advanced models. Use the comic_generator tool for comic-style content and provide preview functionality with feedback options.`,
	},
] as const

// Export the default mode slug
export const defaultModeSlug = modes[0].slug

// Helper functions
export function getModeBySlug(slug: string, customModes?: ModeConfig[]): ModeConfig | undefined {
	// Check custom modes first
	const customMode = customModes?.find((mode) => mode.slug === slug)
	if (customMode) {
		return customMode
	}
	// Then check built-in modes
	return modes.find((mode) => mode.slug === slug)
}

export function getModeConfig(slug: string, customModes?: ModeConfig[]): ModeConfig {
	const mode = getModeBySlug(slug, customModes)
	if (!mode) {
		throw new Error(`No mode found for slug: ${slug}`)
	}
	return mode
}

// Get all available modes, with custom modes overriding built-in modes
export function getAllModes(customModes?: ModeConfig[]): ModeConfig[] {
	if (!customModes?.length) {
		return [...modes]
	}

	// Start with built-in modes
	const allModes = [...modes]

	// Process custom modes
	customModes.forEach((customMode) => {
		const index = allModes.findIndex((mode) => mode.slug === customMode.slug)
		if (index !== -1) {
			// Override existing mode
			allModes[index] = customMode
		} else {
			// Add new mode
			allModes.push(customMode)
		}
	})

	return allModes
}

// Check if a mode is custom or an override
export function isCustomMode(slug: string, customModes?: ModeConfig[]): boolean {
	return !!customModes?.some((mode) => mode.slug === slug)
}

/**
 * Find a mode by its slug, don't fall back to built-in modes
 */
export function findModeBySlug(slug: string, modes: readonly ModeConfig[] | undefined): ModeConfig | undefined {
	return modes?.find((mode) => mode.slug === slug)
}

/**
 * Get the mode selection based on the provided mode slug, prompt component, and custom modes.
 * If a custom mode is found, it takes precedence over the built-in modes.
 * If no custom mode is found, the built-in mode is used.
 * If neither is found, the default mode is used.
 */
export function getModeSelection(mode: string, promptComponent?: PromptComponent, customModes?: ModeConfig[]) {
	const customMode = findModeBySlug(mode, customModes)
	const builtInMode = findModeBySlug(mode, modes)

	const modeToUse = customMode || promptComponent || builtInMode

	const roleDefinition = modeToUse?.roleDefinition || ""
	const baseInstructions = modeToUse?.customInstructions || ""

	return {
		roleDefinition,
		baseInstructions,
	}
}

// Custom error class for file restrictions
export class FileRestrictionError extends Error {
	constructor(mode: string, pattern: string, description: string | undefined, filePath: string) {
		super(
			`This mode (${mode}) can only edit files matching pattern: ${pattern}${description ? ` (${description})` : ""}. Got: ${filePath}`,
		)
		this.name = "FileRestrictionError"
	}
}

export function isToolAllowedForMode(
	tool: string,
	modeSlug: string,
	customModes: ModeConfig[],
	toolRequirements?: Record<string, boolean>,
	toolParams?: Record<string, any>, // All tool parameters
	experiments?: Record<string, boolean>,
): boolean {
	// Always allow these tools
	if (ALWAYS_AVAILABLE_TOOLS.includes(tool as any)) {
		return true
	}
	if (experiments && Object.values(EXPERIMENT_IDS).includes(tool as ExperimentId)) {
		if (!experiments[tool]) {
			return false
		}
	}

	// Check tool requirements if any exist
	if (toolRequirements && typeof toolRequirements === "object") {
		if (tool in toolRequirements && !toolRequirements[tool]) {
			return false
		}
	} else if (toolRequirements === false) {
		// If toolRequirements is a boolean false, all tools are disabled
		return false
	}

	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		return false
	}

	// Check if tool is in any of the mode's groups and respects any group options
	for (const group of mode.groups) {
		const groupName = getGroupName(group)
		const options = getGroupOptions(group)

		const groupConfig = TOOL_GROUPS[groupName]

		// If the tool isn't in this group's tools, continue to next group
		if (!groupConfig.tools.includes(tool)) {
			continue
		}

		// If there are no options, allow the tool
		if (!options) {
			return true
		}

		// For the edit group, check file regex if specified
		if (groupName === "edit" && options.fileRegex) {
			const filePath = toolParams?.path
			if (
				filePath &&
				(toolParams.diff || toolParams.content || toolParams.operations) &&
				!doesFileMatchRegex(filePath, options.fileRegex)
			) {
				throw new FileRestrictionError(mode.name, options.fileRegex, options.description, filePath)
			}
		}

		return true
	}

	return false
}

// Create the mode-specific default prompts
export const defaultPrompts: Readonly<CustomModePrompts> = Object.freeze(
	Object.fromEntries(
		modes.map((mode) => [
			mode.slug,
			{
				roleDefinition: mode.roleDefinition,
				whenToUse: mode.whenToUse,
				customInstructions: mode.customInstructions,
			},
		]),
	),
)

// Helper function to get all modes with their prompt overrides from extension state
export async function getAllModesWithPrompts(context: vscode.ExtensionContext): Promise<ModeConfig[]> {
	const customModes = (await context.globalState.get<ModeConfig[]>("customModes")) || []
	const customModePrompts = (await context.globalState.get<CustomModePrompts>("customModePrompts")) || {}

	const allModes = getAllModes(customModes)
	return allModes.map((mode) => ({
		...mode,
		roleDefinition: customModePrompts[mode.slug]?.roleDefinition ?? mode.roleDefinition,
		whenToUse: customModePrompts[mode.slug]?.whenToUse ?? mode.whenToUse,
		customInstructions: customModePrompts[mode.slug]?.customInstructions ?? mode.customInstructions,
	}))
}

// Helper function to get complete mode details with all overrides
export async function getFullModeDetails(
	modeSlug: string,
	customModes?: ModeConfig[],
	customModePrompts?: CustomModePrompts,
	options?: {
		cwd?: string
		globalCustomInstructions?: string
		language?: string
	},
): Promise<ModeConfig> {
	// First get the base mode config from custom modes or built-in modes
	const baseMode = getModeBySlug(modeSlug, customModes) || modes.find((m) => m.slug === modeSlug) || modes[0]

	// Check for any prompt component overrides
	const promptComponent = customModePrompts?.[modeSlug]

	// Get the base custom instructions
	const baseCustomInstructions = promptComponent?.customInstructions || baseMode.customInstructions || ""
	const baseWhenToUse = promptComponent?.whenToUse || baseMode.whenToUse || ""

	// If we have cwd, load and combine all custom instructions
	let fullCustomInstructions = baseCustomInstructions
	if (options?.cwd) {
		fullCustomInstructions = await addCustomInstructions(
			baseCustomInstructions,
			options.globalCustomInstructions || "",
			options.cwd,
			modeSlug,
			{ language: options.language },
		)
	}

	// Return mode with any overrides applied
	return {
		...baseMode,
		roleDefinition: promptComponent?.roleDefinition || baseMode.roleDefinition,
		whenToUse: baseWhenToUse,
		customInstructions: fullCustomInstructions,
	}
}

// Helper function to safely get role definition
export function getRoleDefinition(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.roleDefinition
}

// Helper function to safely get whenToUse
export function getWhenToUse(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.whenToUse ?? ""
}

// Helper function to safely get custom instructions
export function getCustomInstructions(modeSlug: string, customModes?: ModeConfig[]): string {
	const mode = getModeBySlug(modeSlug, customModes)
	if (!mode) {
		console.warn(`No mode found for slug: ${modeSlug}`)
		return ""
	}
	return mode.customInstructions ?? ""
}
