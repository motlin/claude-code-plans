import {detectLanguage} from "../lib/diff-utils";

export function parseFileLineHash(hash: string): number | null {
	return parseFileLineRangeHash(hash)?.line ?? null;
}

export function fileViewerLanguage(path: string): string | null {
	return detectLanguage(path);
}

/** `#L12` or `#L12-L20`; null for anything else, including reversed ranges. */
export function parseFileLineRangeHash(hash: string): {line: number; endLine: number} | null {
	const match = /^#L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(hash);
	if (!match) return null;
	const line = Number(match[1]);
	const endLine = match[2] === undefined ? line : Number(match[2]);
	if (!Number.isSafeInteger(line) || !Number.isSafeInteger(endLine) || endLine < line) return null;
	return {line, endLine};
}
