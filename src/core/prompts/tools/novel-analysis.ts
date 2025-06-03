export function getNovelAnalysisDescription(): string {
	return `## novel_analysis

Analyze novel content and generate comprehensive analysis reports. This tool examines various aspects of a novel including genre, worldview, characters, plot structure, writing style, and themes. Only available in Novel Analysis Mode.

### Parameters

- \`path\` (required): Path to the novel file to analyze.
- \`type\` (optional): Analysis type to perform. Options: "genre", "worldview", "character", "plot", "style", "theme", "full". Default is "full".
- \`title\` (optional): Custom title for the analysis report. If not provided, will extract from the novel content.
- \`output_path\` (optional): Path to save the analysis report. Default is "[novel_filename]_[type]分析.md".
- \`text\` (optional): Can be used to reference a file using @filename syntax.

### Examples

\`\`\`
<tool_use>
<n>novel_analysis</n>
<path>my_novel.md</path>
<type>character</type>
</tool_use>
\`\`\`

\`\`\`
<tool_use>
<n>novel_analysis</n>
<path>stories/my_novel.md</path>
<type>full</type>
<title>My Amazing Story</title>
<output_path>analysis/full_analysis.md</output_path>
</tool_use>
\`\`\`

The tool will analyze the novel content according to the specified type and generate a detailed analysis report. For character analysis, it will identify main characters, their traits, motivations, and relationships. For plot analysis, it will examine structure, pacing, and key turning points. The full analysis includes all aspects and provides a comprehensive evaluation of the novel's literary elements.`
}
