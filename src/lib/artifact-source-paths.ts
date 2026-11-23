import type {ThumbnailKey} from "./artifact-thumbnail";

/** Extensions the sandboxed local preview will serve; anything else stays on claude.ai. */
const PREVIEWABLE_SOURCE_PATTERN = /\.(?:html?|md)$/i;

/** Whether a recorded artifact source is an absolute .html, .htm or .md path. */
export function isPreviewableSourcePath(path: string): boolean
{
	return path.startsWith("/") && PREVIEWABLE_SOURCE_PATTERN.test(path);
}

/** The API route that serves an artifact's recorded local source into a sandboxed iframe. */
export function artifactSourceUrl(id: string): string
{
	return `/api/artifacts/${encodeURIComponent(id)}/source`;
}

/** The in-app page that previews an artifact's local source. */
export function artifactPreviewPath(id: string): string
{
	return `/artifact/${encodeURIComponent(id)}`;
}

const THUMBNAIL_SOURCE_PATTERN = /\.html?$/i;

/** Whether the local server screenshots this source for a card cover: HTML only, since a Docs page's light rendering is undecided. */
export function isThumbnailSourcePath(path: string): boolean
{
	return path.startsWith("/") && THUMBNAIL_SOURCE_PATTERN.test(path);
}

/**
 * The cover thumbnail of an artifact's source at one version (its truncated mtime) taken by one capture, so the URL
 * can be cached forever.
 */
export function artifactThumbnailUrl(id: string, {version, capture}: ThumbnailKey): string
{
	return `/api/artifacts/${encodeURIComponent(id)}/thumbnail?v=${version}&c=${capture}`;
}
