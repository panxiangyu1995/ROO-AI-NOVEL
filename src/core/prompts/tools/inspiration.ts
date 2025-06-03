export function getInspirationDescription(): string {
	return `## inspiration

Generate creative inspiration based on a given topic. This tool analyzes the topic and provides multiple creative ideas tailored to different aspects of novel creation. Only available in Inspiration Mode.

### Parameters

- \`topic\` (required): The main topic or theme to generate inspiration for.
- \`aspect\` (optional): The specific aspect to focus on, such as "story", "character", "setting", "plot", or "theme". Default is "story".
- \`count\` (optional): Number of inspiration points to generate, between 1 and 10. Default is 3.
- \`output_path\` (optional): Path to save the inspiration results. Default is a generated filename based on the topic.

### Examples

\`\`\`
<tool_use>
<name>inspiration</name>
<topic>urban fantasy</topic>
</tool_use>
\`\`\`

\`\`\`
<tool_use>
<name>inspiration</name>
<topic>revenge story</topic>
<aspect>character</aspect>
<count>5</count>
<output_path>inspiration/revenge_characters.md</output_path>
</tool_use>
\`\`\`

The tool will generate creative inspiration based on the topic and save the results to the specified file path. Each inspiration point includes explanations of its creative potential and suggestions for further development.`
}
