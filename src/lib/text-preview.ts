/** Upstream's `bi`: a preview shows at most this many characters. */
export const TEXT_PREVIEW_LIMIT = 102_400;

/** The size line's numbers: UTF-8 KB to two places, and the line count. */
export function textPreviewStats(text: string): {kb: string; lines: number} {
	return {kb: (new TextEncoder().encode(text).length / 1024).toFixed(2), lines: text.split("\n").length};
}
