import {stat} from "node:fs/promises";

import {FILE_CONFLICT_MESSAGE, mtimeEtag} from "./file-edit";

async function currentEtag(filePath: string): Promise<string | null> {
	try {
		return mtimeEtag((await stat(filePath)).mtime);
	} catch {
		return null;
	}
}

/**
 * A 409 when the request's `If-Match` names a version of the file other than
 * the one on disk (including a file deleted since). No `If-Match` means the
 * caller chose to override, so nothing is checked.
 */
export async function rejectStaleWrite(request: Request, filePath: string): Promise<Response | null> {
	const ifMatch = request.headers.get("If-Match");
	if (ifMatch === null || ifMatch === (await currentEtag(filePath))) return null;
	return new Response(FILE_CONFLICT_MESSAGE, {
		status: 409,
		headers: {"Content-Type": "text/plain; charset=utf-8"},
	});
}

/** Response headers carrying the saved file's new ETag, for the next save's `If-Match`. */
export async function savedFileHeaders(filePath: string): Promise<Record<string, string>> {
	const etag = await currentEtag(filePath);
	return {
		"Cache-Control": "private, max-age=0, must-revalidate",
		...(etag === null ? {} : {ETag: etag}),
	};
}
