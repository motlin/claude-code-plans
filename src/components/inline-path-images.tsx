import {extractInlineImagePaths, isPathInsideAllowedImageRoot} from "./inline-image-paths";
import type {AttachedImage} from "./user-attachments";

/** The images a prompt references by absolute path inside an allowed root, served by the byte endpoint. */
export function inlinePathImages(text: string, allowedRoots: readonly string[]): AttachedImage[] {
	return extractInlineImagePaths(text)
		.filter((path) => isPathInsideAllowedImageRoot(path, allowedRoots))
		.map((path) => ({
			key: `path:${path}`,
			src: `/api/image?path=${encodeURIComponent(path)}`,
			label: `Referenced file ${path}`,
		}));
}
