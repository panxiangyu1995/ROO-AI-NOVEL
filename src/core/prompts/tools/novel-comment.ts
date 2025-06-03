import { t } from "../../../i18n"

/**
 * Returns the description for the novel_comment tool
 * @returns The description of the novel_comment tool
 */
export function getNovelCommentDescription(): string {
	return t("tools:novelComment.description", {
		defaultValue: `Add creative comments to Markdown files for novel writing.

Parameters:
- path (required): The path to the Markdown file
- line (required for single comment): The line number where to add the comment
- content (required): The comment text to add. For batch comments, use format "line1:comment1;line2:comment2;..."
- explain (optional): The type of comment (e.g., character_motivation, plot_explanation, foreshadowing, world_building, etc.)

This tool allows you to add HTML comments to your novel's Markdown files to explain creative decisions, character motivations, plot connections, and other writing insights. These comments won't appear in the final output but help track your creative process.

For batch processing multiple comments at once, omit the line parameter and use the content parameter with the format "line1:comment1;line2:comment2;..." where each entry specifies a line number and comment text separated by a colon, and entries are separated by semicolons.`,
	})
}
