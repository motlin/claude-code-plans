/** Upstream's `bi`: a preview shows at most this many characters. */
export const TEXT_PREVIEW_LIMIT = 102_400;

/** Upstream's `rh`: KB under a megabyte, else MB, to two places. */
function formatPreviewSize(bytes: number): string {
	return bytes < 1_048_576 ? `${(bytes / 1024).toFixed(2)} KB` : `${(bytes / 1_048_576).toFixed(2)} MB`;
}

/**
 * The size line's numbers, after upstream's `mc`: the file's size, which
 * defaults to the text's UTF-8 length, and the text's line count.
 */
export function textPreviewStats(
	text: string,
	bytes = new TextEncoder().encode(text).length,
): {size: string; lines: number} {
	return {size: formatPreviewSize(bytes), lines: text.split("\n").length};
}
