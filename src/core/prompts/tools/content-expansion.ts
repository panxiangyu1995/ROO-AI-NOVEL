import { t } from "../../../i18n"

/**
 * Returns the description for the content_expansion tool
 * @returns The description of the content_expansion tool
 */
export function getContentExpansionDescription(): string {
	return t("tools:contentExpansion.description", {
		defaultValue: `Analyze text content and provide expansion options.

Parameters:
- path: The path to the text file that needs to be expanded.
- ratio (optional): The expansion ratio, indicating how much the text should be expanded. Default is 2 (doubled).
- output_path (optional): The path where the expanded content will be saved. If not provided, a default path will be generated.
- use_comments (optional): Whether to use HTML comments to explain expansion decisions. Default is false.

This tool analyzes the content of a text file and provides options for expanding it in different ways, such as adding more details to paragraphs, expanding dialogues, adding inner thoughts, etc. It calculates the current word count and estimates the expanded word count based on the ratio.

For large expansion tasks, the tool can split the work into subtasks. It can also add HTML comments to explain expansion decisions if requested.

Note: This tool is only available in Expansion Mode.`,
	})
}
