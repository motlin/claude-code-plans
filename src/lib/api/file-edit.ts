import {z} from "zod";

import type {SaveError} from "../source-save";
import {ApiResponseError, resolveUrl} from "./client";
import {encodeFilePath} from "./file";
import {MemoryDetailResponse} from "./memories";
import {PlanDetailResponse} from "./plans";
import {type EditableMarkdownTarget, mtimeEtag} from "../file-edit";

export interface EditableMarkdown
{
	markdown: string;
	/** The version being edited, sent back as `If-Match`; null when the file has no mtime. */
	etag: string | null;
}

/** Reads the file through its save API, so the edit starts from the version the save compares. */
export async function loadEditableMarkdown(target: EditableMarkdownTarget): Promise<EditableMarkdown>
{
	const response = await fetch(
		resolveUrl(target.url),
		{
			credentials: "same-origin",
			cache: "no-store",
		},
	);
	if (!response.ok) throw new ApiResponseError(target.url, response);
	const json: unknown = await response.json();
	const detail = target.kind === "plan" ? PlanDetailResponse.parse(json) : MemoryDetailResponse.parse(json);
	if (detail === null)
		throw new ApiResponseError(
			target.url,
			new Response(
				null,
				{
					status: 404,
				},
			),
		);
	return {
		markdown: detail.markdown,
		etag: detail.mtime === null ? null : mtimeEtag(new Date(detail.mtime)),
	};
}

/** A save the server refused or could not reach, as upstream's banner reason. */
export class FileSaveError extends Error
{
	constructor(readonly error: SaveError)
	{
		super(`Couldn’t save the file (${error.kind})`);
		this.name = "FileSaveError";
	}
}

const SaveRefusal = z.object(
	{
		reason: z.enum(["conflict", "missing", "denied", "writeFailed"]),
		etag: z.string().optional(),
	},
);

/**
 * PUTs `body` with `etag` as `If-Match` (null overrides whatever is on disk) and resolves to
 * the saved version's ETag. Rejects with {@link FileSaveError}: 409 `missing`, 409 `conflict`
 * with disk's current ETag, 403 `denied`, and anything else (a network failure included) as
 * `writeFailed` carrying the ETag it sent, as upstream's `hS` does.
 */
async function putFile(url: string, contentType: string, body: string, etag: string | null): Promise<string | null>
{
	const writeFailed = new FileSaveError(
		{
			kind: "writeFailed",
			etag,
		},
	);
	let response: Response;
	try
	{
		response = await fetch(
			resolveUrl(url),
			{
				method: "PUT",
				credentials: "same-origin",
				headers:
				{
					"Content-Type": contentType,
					...(etag === null
						? {}
						:
							{
								"If-Match": etag,
							}),
				},
				body,
			},
		);
	}
	catch
	{
		throw writeFailed;
	}
	if (response.ok) return response.headers.get("ETag");
	const refusal = SaveRefusal.safeParse(await response.json().catch(() => null));
	if (response.status === 403)
		throw new FileSaveError(
			{
				kind: "denied",
			},
		);
	if (response.status === 409 && refusal.success && refusal.data.reason === "missing")
		throw new FileSaveError(
			{
				kind: "missing",
			},
		);
	if (response.status === 409)
		throw new FileSaveError(
			{
				kind: "conflict",
				etag: (refusal.success ? refusal.data.etag : undefined) ?? response.headers.get("ETag"),
			},
		);
	throw writeFailed;
}

/** Writes a plan or memory through its save API; see {@link putFile}. */
export async function saveEditableMarkdown(
	target: EditableMarkdownTarget,
	markdown: string,
	etag: string | null,
): Promise<string | null>
{
	return putFile(target.url, "text/plain", markdown, etag);
}

/** Writes the Files source editor's text through `PUT /api/file/$` (upstream's desktop `writeSessionFile`). */
export async function saveFileText(path: string, text: string, etag: string | null): Promise<string | null>
{
	return putFile(`/api/file/${encodeFilePath(path)}`, "text/plain; charset=utf-8", text, etag);
}

/** Writes one of a session's memory files through `PUT /api/sessions/$id/memory-file`; see {@link putFile}. */
export async function saveMemoryFileText(
	sessionId: string,
	path: string,
	text: string,
	etag: string | null,
): Promise<string | null>
{
	return putFile(
		`/api/sessions/${encodeURIComponent(sessionId)}/memory-file?path=${encodeURIComponent(path)}`,
		"text/plain; charset=utf-8",
		text,
		etag,
	);
}
