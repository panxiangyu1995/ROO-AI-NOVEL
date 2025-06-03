export function getImitationDescription(): string {
	return `## imitation

Analyze reference text and generate content that imitates its writing style. This tool helps authors understand and mimic specific literary styles. Only available in Imitation Mode.

### Parameters

- \`path\` (optional): Path to the reference text file to analyze and imitate.
- \`text\` (optional): Direct text input for style analysis and imitation. Either path or text must be provided.
- \`output_path\` (optional): Path to save the imitation results. Default is "imitation_result.md".

### Examples

\`\`\`
<tool_use>
<name>imitation</name>
<path>samples/hemingway.txt</path>
</tool_use>
\`\`\`

\`\`\`
<tool_use>
<name>imitation</name>
<text>It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness...</text>
<output_path>imitation/dickens_style.md</output_path>
</tool_use>
\`\`\`

The tool will analyze the writing style of the reference text and generate a document containing style analysis, imitation examples, and imitation techniques. The analysis includes sentence patterns, vocabulary choice, rhetorical devices, narrative perspective, rhythm, and emotional tone.`
}
