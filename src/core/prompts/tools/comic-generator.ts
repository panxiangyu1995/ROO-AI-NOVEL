import { t } from "../../../i18n"

/**
 * 获取漫画生成工具的描述
 * @returns 工具描述对象
 */
export function getComicGeneratorDescription(): string {
	return t("tools:comicGenerator.description", {
		defaultValue: `Generate comic-style visual content with panels and speech bubbles.

Parameters:
- content (required): The text content to convert into comic format
- style (optional): Comic style (manga, american, european, chibi, minimalist)
- layout (optional): Panel layout (vertical, horizontal, grid, freeform)
- panels (optional): Number of panels to create (1-20)
- output_path (optional): Path to save the generated comic HTML file

This tool converts text content into a visual comic format with customizable styles and layouts. It analyzes the text to identify scenes, dialogue, and actions, then creates appropriate comic panels with speech bubbles and visual elements. The output is an HTML file that can be viewed in a browser or saved for later use.

The tool supports various comic styles (manga, american, european, chibi, minimalist) and layout options (vertical, horizontal, grid, freeform). You can specify the number of panels to create (between 1 and 20) and provide a custom output path for the generated file.`,
	})
}
