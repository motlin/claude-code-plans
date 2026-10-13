import {encodeFilePath} from "../lib/api/file";

export function fileSearchViewerTarget(
	absolutePath: string,
	lineNumber: number,
): {
	absolutePath: string;
	lineNumber: number;
} {
	if (!absolutePath.startsWith("/") || !Number.isSafeInteger(lineNumber) || lineNumber < 1) {
		throw new Error("File search results require an absolute path and positive line number");
	}
	return {absolutePath, lineNumber};
}

export function fileSearchViewerNavigation(
	absolutePath: string,
	lineNumber: number,
): {
	pathToken: string;
	hash: string;
} {
	const target = fileSearchViewerTarget(absolutePath, lineNumber);
	return {
		pathToken: encodeFilePath(target.absolutePath),
		hash: `L${target.lineNumber}`,
	};
}
