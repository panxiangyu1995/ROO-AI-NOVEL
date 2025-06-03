import { t } from "../../../i18n"

/**
 * Returns the description for the novel_framework_refine tool
 * @returns The description of the novel_framework_refine tool
 */
export function getNovelFrameworkRefineDescription(): string {
	return t("tools:novelFrameworkRefine.description", {
		defaultValue: `Analyze and provide improvement options for novel framework.

Parameters:
- path: The path to the novel framework Markdown file that needs to be refined.
- area (optional): The specific area to focus on for refinement. Can be "character", "plot", "world", or "all". Default is "all".

This tool analyzes the content of a novel framework file and provides options for improving or completing different aspects of the framework. It identifies areas that could be enhanced, such as character details, plot structure, worldbuilding elements, etc., and presents these as options for the user to choose from.

The tool uses the ask_followup_question tool to present improvement options to the user and capture their selection.

Note: This tool is only available in Novel Framework Mode (planner).`,
	})
}
