/** Upstream `FD` (shared-28): binary, office, archive and media files no editor should open. */
const NON_EDITOR_EXTENSION =
	/\.(doc[xm]?|xls[xm]?|ppt[xm]?|od[tsp]|rtf|epub|mobi|pages|numbers|zip|t?gz|tar|bz2|xz|zst|7z|rar|jar|war|dmg|iso|deb|rpm|apk|msi|pkg|img|wasm|exe|dll|so(?:\.\d+)*|dylib|bin|class|pyc|o|a|db|sqlite3?|parquet|woff2?|ttf|otf|eot|pdf|mp4|webm|m4v|mov|ogv|avi|mkv|wmv|flv|mpe?g|m2ts|3gp|mp3|m4a|aac|flac|wav|ogg|oga|opus|aiff?|wma|midi?|ico|tiff?|heic|heif|jfif|psd|tga|dng|svgz)$/i;

/** Upstream `$3` (shared-m-0): the image extensions `mw` excludes. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "avif"]);

/** Upstream `fT` (shared-28): files the Files pane can preview. */
export const FILES_PANE_EXTENSION = /\.(html?|svg|pdf|mp4|webm|m4v|mov|ogv)$/i;

function extension(path: string): string {
	const dot = path.lastIndexOf(".");
	return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

/** Upstream `p3`: a file an editor can open (not binary/office/archive/media, not an image). */
export function isEditableText(path: string): boolean {
	return !NON_EDITOR_EXTENSION.test(path) && !IMAGE_EXTENSIONS.has(extension(path));
}
