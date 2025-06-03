import { t } from "../../../i18n"

/**
 * Returns the description for the format_converter tool
 * @returns The description of the format_converter tool
 */
export function getFormatConverterDescription(): string {
	return t("tools:formatConverter.description", {
		defaultValue: `Convert Markdown files to plain text format.

Parameters:
- path (optional): The path to a Markdown file or directory containing Markdown files. If not provided, the tool will search for Markdown files in the current workspace.
- output_dir (optional): The directory where converted files will be saved. If not provided, files will be saved in the same directory as the source files.
- merge (optional): Whether to merge multiple files into a single output file. Default is false.
- preserve_paragraphs (optional): Whether to preserve paragraph formatting with double line breaks. Default is true.

This tool converts Markdown files to plain text format, removing all Markdown syntax, HTML comments, and other non-content elements. It can process a single file, all files in a directory, or automatically find Markdown files in the workspace. The tool can also merge multiple files into a single output file.

Note: This tool is only available in Format Conversion Mode (formatter).`,
	})
}
