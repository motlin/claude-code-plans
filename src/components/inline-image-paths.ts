export function extractInlineImagePaths(text: string): string[] {
	IMAGE_PATH_PATTERN.lastIndex = 0;
	const paths = new Set<string>();
	let match = IMAGE_PATH_PATTERN.exec(text);
	while (match !== null) {
		const path = match[1];
		if (path !== undefined) paths.add(path);
		match = IMAGE_PATH_PATTERN.exec(text);
	}
	return [...paths];
}

export function isPathInsideAllowedImageRoot(path: string, allowedRoots: readonly string[]): boolean {
	const normalizedPath = normalizeAbsolutePath(path);
	if (normalizedPath === undefined) return false;

	return allowedRoots.some((root) => {
		const normalizedRoot = normalizeAbsolutePath(root);
		if (normalizedRoot === undefined) return false;
		return (
			normalizedRoot === "/" ||
			normalizedPath === normalizedRoot ||
			normalizedPath.startsWith(`${normalizedRoot}/`)
		);
	});
}

const IMAGE_PATH_PATTERN = /(?<![\w/])@?(\/[^\s'"`<>]+\.(?:png|jpe?g|webp|gif))/gi;

function normalizeAbsolutePath(path: string): string | undefined {
	if (!path.startsWith("/")) return undefined;

	const segments: string[] = [];
	for (const segment of path.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return `/${segments.join("/")}`;
}
