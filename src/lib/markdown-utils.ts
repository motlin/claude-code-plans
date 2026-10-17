export function humanizeFilename(filename: string): string {
	return filename
		.replace(/\.md$/, "")
		.replace(/[-_]/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function extractTitleFromContent(content: string, filename: string): string {
	const firstLine = content.split("\n")[0]?.trim();
	if (firstLine?.startsWith("# ")) {
		return firstLine.slice(2);
	}
	return humanizeFilename(filename);
}
