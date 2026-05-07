export function humanizeFilename(filename: string): string {
	return filename
		.replace(/\.md$/, '')
		.replace(/[-_]/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function extractTitleFromContent(content: string, filename: string): string {
	const firstLine = content.split('\n')[0]?.trim();
	if (firstLine?.startsWith('# ')) {
		return firstLine.slice(2);
	}
	return humanizeFilename(filename);
}

export function stripLeadingTitleHeading(content: string): string {
	const lines = content.split('\n');
	const firstLine = lines[0];
	if (firstLine === undefined || !firstLine.startsWith('# ')) {
		return content;
	}
	if (lines.length > 1 && lines[1] === '') {
		return lines.slice(2).join('\n');
	}
	return lines.slice(1).join('\n');
}

export async function extractTitle(filePath: string, filename: string): Promise<string> {
	try {
		const {readFile} = await import('node:fs/promises');
		const content = await readFile(filePath, 'utf-8');
		return extractTitleFromContent(content, filename);
	} catch {
		return humanizeFilename(filename);
	}
}
