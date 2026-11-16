import {stat} from "node:fs/promises";

import {mtimeEtag} from "./file-edit";

async function currentEtag(filePath: string): Promise<string | null>
{
	try
	{
		return mtimeEtag((await stat(filePath)).mtime);
	}
	catch
	{
		return null;
	}
}

/**
 * A 409 when the request's `If-Match` names a version of the file other than
 * the one on disk. No `If-Match` means the caller chose to override, so nothing
 * is checked. The JSON body gives upstream's save-banner reason: `missing` when
 * the file is gone, else `conflict` with the disk's current ETag (also the
 * `ETag` header), which the banner's Override sends back as `If-Match`.
 */
export async function rejectStaleWrite(request: Request, filePath: string): Promise<Response | null>
{
	const ifMatch = request.headers.get("If-Match");
	if (ifMatch === null) return null;
	const etag = await currentEtag(filePath);
	if (ifMatch === etag) return null;
	if (etag === null)
	{
		return Response.json(
			{
				reason: "missing",
			},
			{
				status: 409,
				headers:
				{
					"Cache-Control": "no-store",
				},
			},
		);
	}
	return Response.json(
		{
			reason: "conflict",
			etag,
		},
		{
			status: 409,
			headers:
			{
				"Cache-Control": "no-store",
				ETag: etag,
			},
		},
	);
}

/** A 403 for a save the server will not make (upstream's `Denied` write status). */
export function deniedResponse(): Response
{
	return Response.json(
		{
			reason: "denied",
		},
		{
			status: 403,
		},
	);
}

/** Response headers carrying the saved file's new ETag, for the next save's `If-Match`. */
export async function savedFileHeaders(filePath: string): Promise<Record<string, string>>
{
	const etag = await currentEtag(filePath);
	return {
		"Cache-Control": "private, max-age=0, must-revalidate",
		...(etag === null
			? {}
			:
				{
					ETag: etag,
				}),
	};
}
