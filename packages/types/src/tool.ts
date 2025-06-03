import { z } from "zod"

/**
 * ToolGroup
 */

export const toolGroups = [
	"read",
	"edit",
	"browser",
	"command",
	"mcp",
	"modes",
	"formatter",
	"inspiration",
	"imitation",
	"script_adaptation",
	"analysis",
	"comic",
] as const

export const toolGroupsSchema = z.enum(toolGroups)

export type ToolGroup = z.infer<typeof toolGroupsSchema>

/**
 * ToolName
 */

export const toolNames = [
	"execute_command",
	"read_file",
	"write_to_file",
	"apply_diff",
	"insert_content",
	"search_and_replace",
	"search_files",
	"list_files",
	"list_code_definition_names",
	"browser_action",
	"use_mcp_tool",
	"access_mcp_resource",
	"ask_followup_question",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"fetch_instructions",
	"codebase_search",
	"novel_comment",
	"format_converter",
	"novel_framework_refine",
	"content_expansion",
	"inspiration",
	"imitation",
	"novel_to_script",
	"novel_analysis",
	"novel_content_search",
	"comic_generator",
] as const

export const toolNamesSchema = z.enum(toolNames)

export type ToolName = z.infer<typeof toolNamesSchema>

/**
 * ToolUsage
 */

export const toolUsageSchema = z.record(
	toolNamesSchema,
	z.object({
		attempts: z.number(),
		failures: z.number(),
	}),
)

export type ToolUsage = z.infer<typeof toolUsageSchema>

/**
 * ToolUse
 */

export const toolUseSchema = z.object({
	type: z.literal("tool_use"),
	name: toolNamesSchema,
	params: z.record(z.string()).optional(),
	partial: z.boolean().optional(),
})

export type ToolUse = z.infer<typeof toolUseSchema>

/**
 * ToolParamName
 */

export const toolParamNames = [
	"command",
	"path",
	"content",
	"line_count",
	"regex",
	"file_pattern",
	"recursive",
	"action",
	"url",
	"coordinate",
	"text",
	"server_name",
	"tool_name",
	"arguments",
	"resource_id",
	"question",
	"mode_slug",
	"reason",
	"message",
	"mode",
	"task_id",
	"diff",
	"replace",
	"search",
	"line",
	"query",
	"comment",
	"type",
	"explain",
	"output_dir",
	"merge",
	"preserve_paragraphs",
	"area",
	"ratio",
	"output_path",
	"use_comments",
	"topic",
	"aspect",
	"count",
	"title",
	"uri",
	"follow_up",
	"task",
	"size",
	"use_regex",
	"ignore_case",
	"args",
	"start_line",
	"end_line",
	"cwd",
	"result",
	"style",
	"layout",
	"panels",
] as const

export const toolParamNamesSchema = z.enum(toolParamNames)

export type ToolParamName = z.infer<typeof toolParamNamesSchema>

/**
 * TextContent
 */

export const textContentSchema = z.object({
	type: z.literal("text"),
	content: z.string(),
	partial: z.boolean().optional(),
})

export type TextContent = z.infer<typeof textContentSchema>

/**
 * ToolResponse
 */

export type ToolResponse = string | TextContent[]
