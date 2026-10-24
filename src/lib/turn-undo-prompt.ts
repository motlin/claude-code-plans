/** Upstream `ec`'s strip: backticks would close the code span, line breaks would end the list line. */
const UNSAFE_PATH_CHARS = /[`\r\n\u2028\u2029]/g;

/** Upstream `ec`: a path in inline code, its backticks and line breaks stripped so the span can't break. */
function codePath(path: string): string {
	return `\`${path.replaceAll(UNSAFE_PATH_CHARS, "")}\``;
}

/**
 * Upstream `Bge`: the message the turn card's Undo sends, asking Claude to
 * restore the turn's files by full path.
 */
export function turnUndoPrompt(paths: readonly string[]): string {
	const files = paths.map(codePath);
	const [sole] = files;
	if (files.length === 1 && sole !== undefined) {
		return `Undo the changes you made to ${sole} in your last turn and restore it to its previous state.`;
	}
	return [
		`Undo the changes you made to these ${files.length} files in your last turn and restore them to their previous state:`,
		...files.map((file) => `- ${file}`),
	].join("\n");
}
