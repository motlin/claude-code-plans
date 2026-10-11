/**
 * Markdown as upstream prepares it for Read aloud: code blocks become
 * "(code block)", markers are dropped, links and images keep their text, table
 * pipes become spaces, and bare URLs and paths are left as written.
 */
export function speechText(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, " (code block) ")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/^#{1,6}[ \t]+/gm, "")
		.replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1")
		.replace(/(^|\W)_{1,3}([^_\n]+)_{1,3}(?=\W|$)/g, "$1$2")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^(?=[^\n]*\|)(?=[^\n]*-)[ \t|:-]+$/gm, "")
		.replace(/\|/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
