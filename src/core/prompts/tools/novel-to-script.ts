export function getNovelToScriptDescription(): string {
	return `## novel_to_script

Convert a novel into script format. This tool analyzes novel content and transforms it into different script formats (movie, TV, stage, radio, or short script). Only available in Script Adaptation Mode.

### Parameters

- \`path\`: Path to the novel file to convert.
- \`type\` (optional): Script type to generate. Options: "movie", "tv", "stage", "radio", "short". Default is "movie".
- \`title\` (optional): Custom title for the script. If not provided, will extract from the novel content.
- \`output_path\` (optional): Path to save the script result. Default is "[novel_filename]_[type]剧本.md".
- \`text\` (optional): Can be used to reference a file using @filename syntax.

### Examples

\`\`\`
<tool_use>
<name>novel_to_script</name>
<path>my_novel.md</path>
<type>movie</type>
</tool_use>
\`\`\`

\`\`\`
<tool_use>
<name>novel_to_script</name>
<path>stories/my_novel.md</path>
<type>tv</type>
<title>My Amazing Story</title>
<output_path>scripts/my_tv_script.md</output_path>
</tool_use>
\`\`\`

The tool will analyze the novel content, identify characters, scenes, and dialogue, and generate a properly formatted script according to the specified type. The generated script includes appropriate sections such as scene descriptions, character dialogue, and formatting specific to the chosen script type.`
}
