/**
 * Conditional-GET validators for routes that serve files from disk. HTTP
 * dates only carry whole seconds, so `If-Modified-Since` misses a second save
 * landing in the same second; an ETag built from the millisecond mtime and
 * byte size (the same form `/api/file` uses) changes on every save.
 */

/** The parts of a `Stats` that identify one version of a file. */
export interface FileVersion
{
	mtimeMs: number;
	size: number;
}

/**
 * A strong ETag over one or more files, where `null` is a file that does not
 * exist, so creating or deleting any of them changes the validator too.
 */
export function filesEtag(versions: ReadonlyArray<FileVersion | null>): string
{
	const parts = versions.map((version) => (version === null ? "absent" : `${version.mtimeMs}-${version.size}`));
	return `"${parts.join("_")}"`;
}

const CACHE_CONTROL = "private, max-age=0, must-revalidate";

/** Headers every validated response carries. */
export function validatorHeaders(etag: string): Record<string, string>
{
	return {
		"Cache-Control": CACHE_CONTROL,
		ETag: etag,
	};
}

/** A 304 when the request's `If-None-Match` lists `etag` (or `*`), else null. */
export function notModifiedResponse(request: Request, etag: string): Response | null
{
	const ifNoneMatch = request.headers.get("If-None-Match");
	if (ifNoneMatch === null) return null;
	const tags = new Set(ifNoneMatch.split(",").map((tag) => tag.trim().replace(/^W\//, "")));
	if (!tags.has(etag) && !tags.has("*")) return null;
	return new Response(
		null,
		{
			status: 304,
			headers: validatorHeaders(etag),
		},
	);
}
