import {z} from "zod";

import type {SaveError} from "../source-save";
import {ApiResponseError, resolveUrl} from "./client";
import {encodeFilePath} from "./file";
import {MemoryDetailResponse} from "./memories";
import {PlanDetailResponse} from "./plans";
import {type EditableMarkdownTarget, mtimeEtag} from "../file-edit";

/** The save API refused a write because the file changed on disk (409). */
export class FileConflictError extends Error
{
	constructor()
	{
		super("The file changed on disk");
		this.name = "FileConflictError";
	}
}

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

/**
 * Writes the markdown; `etag` null overrides whatever is on disk. Resolves to
 * the saved version's ETag, and rejects with {@link FileConflictError} on 409.
 */
export async function saveEditableMarkdown(
	target: EditableMarkdownTarget,
	markdown: string,
	etag: string | null,
): Promise<string | null>
{
	const response = await fetch(
		resolveUrl(target.url),
		{
			method: "PUT",
			credentials: "same-origin",
			headers:
			{
				"Content-Type": "text/plain",
				...(etag === null
					? {}
					:
						{
							"If-Match": etag,
						}),
			},
			body: markdown,
		},
	);
	if (response.status === 409) throw new FileConflictError();
	if (!response.ok) throw new ApiResponseError(target.url, response);
	return response.headers.get("ETag");
}

/** A Files source editor save the server refused, with upstream's banner reason. */
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
	},
);

/**
 * Writes the Files source editor's text through `PUT /api/file/$` (upstream's desktop
 * `writeSessionFile`); `etag` null overrides whatever is on disk. Resolves to the saved
 * version's ETag, and rejects with {@link FileSaveError}.
 */
export async function saveFileText(path: string, text: string, etag: string | null): Promise<string | null>
{
	let response: Response;
	try
	{
		response = await fetch(
			resolveUrl(`/api/file/${encodeFilePath(path)}`),
			{
				method: "PUT",
				credentials: "same-origin",
				headers:
				{
					"Content-Type": "text/plain; charset=utf-8",
					...(etag === null
						? {}
						:
							{
								"If-Match": etag,
							}),
				},
				body: text,
			},
		);
	}
	catch
	{
		throw new FileSaveError(
			{
				kind: "writeFailed",
			},
		);
	}
	if (response.ok) return response.headers.get("ETag");
	const refusal = SaveRefusal.safeParse(await response.json().catch(() => null));
	throw new FileSaveError(
		{
			kind: refusal.success ? refusal.data.reason : "writeFailed",
		},
	);
}
