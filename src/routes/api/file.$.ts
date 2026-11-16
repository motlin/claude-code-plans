import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import
{
	decodeFilePath,
	type FilePreviewUnavailable,
	FileViewerErrorResponse,
	FileViewerResponse,
} from "../../lib/api/file";
import {imageContentType} from "../../lib/file-preview";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

function errorResponse(error: string, status: number, preview?: FilePreviewUnavailable): Response
{
	return Response.json(
		FileViewerErrorResponse.parse(
			{
				error,
				...preview,
			},
		),
		{
			status,
			headers:
			{
				"Cache-Control": PRIVATE_NO_CACHE,
			},
		},
	);
}

/**
 * Raw bytes for images and downloads. Neither is size-capped, and both are
 * sandboxed so an SVG opened directly can't run script on this origin.
 */
async function streamFile(
	path: string,
	sizeBytes: number,
	contentType: string,
	download: boolean,
	headers: Record<string, string>,
): Promise<Response>
{
	const {fileBodyStream} = await import("../../lib/file-stream");
	const name = path.slice(path.lastIndexOf("/") + 1);
	return new Response(
		fileBodyStream(path),
		{
			headers:
			{
				...headers,
				"Content-Length": String(sizeBytes),
				"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
				"Content-Type": contentType,
				"X-Content-Type-Options": "nosniff",
				...(download
					?
						{
							"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
						}
					: {}),
			},
		},
	);
}

export async function handleFileRequest(
	request: Request,
	pathToken: string,
	configPath?: string,
	defaultRoots: readonly string[] = [],
): Promise<Response>
{
	const requestedPath = decodeFilePath(pathToken);
	if (requestedPath === null) return errorResponse("A valid encoded file path is required", 400);

	const {FileServingError, readAllowedFile, statAllowedFile} = await import("../../lib/file-serving");
	const searchParams = new URL(request.url).searchParams;
	const download = searchParams.get("download") === "1";
	const imageType = imageContentType(requestedPath);
	try
	{
		if (download || imageType !== null)
		{
			const file = await statAllowedFile(requestedPath, configPath, defaultRoots);
			const headers =
			{
				"Cache-Control": PRIVATE_NO_CACHE,
				ETag: `"${file.modifiedAtMilliseconds}-${file.sizeBytes}"`,
			};
			if (request.headers.get("If-None-Match") === headers.ETag)
			{
				return new Response(
					null,
					{
						status: 304,
						headers,
					},
				);
			}
			const contentType = download ? "application/octet-stream" : (imageType ?? "");
			return await streamFile(file.path, file.sizeBytes, contentType, download, headers);
		}

		const {resolveConfiguredFileRoots} = await import("../../lib/config");
		const {writableWorkspacePath} = await import("../../lib/session-file-write");
		const {mtimeEtag} = await import("../../lib/file-edit");
		const file = await readAllowedFile(
			requestedPath,
			configPath,
			defaultRoots,
			{
				forceText: searchParams.get("force") === "text",
			},
		);
		const etag = `"${file.modifiedAtMilliseconds}-${file.sizeBytes}"`;
		const headers =
		{
			"Cache-Control": PRIVATE_NO_CACHE,
			ETag: etag,
		};
		if (request.headers.get("If-None-Match") === etag)
		{
			return new Response(
				null,
				{
					status: 304,
					headers,
				},
			);
		}

		return Response.json(
			FileViewerResponse.parse(
				{
					content: file.content,
					path: file.path,
					etag: mtimeEtag(file.modifiedAt),
					writable: await writableWorkspacePath(
						file.path,
						await resolveConfiguredFileRoots(configPath, defaultRoots),
					),
					lossy: file.lossy,
				},
			),
			{
				headers,
			},
		);
	}
	catch (error)
	{
		if (error instanceof FileServingError)
		{
			return errorResponse(error.message, error.status, error.preview);
		}
		throw error;
	}
}

/**
 * Save from the Files source editor (upstream's desktop `writeSessionFile`): the raw body
 * replaces the file atomically. 403 `{reason:"denied"}` outside the roots or under `.git`,
 * 409 `{reason:"conflict"|"missing"}` for a stale `If-Match`, else 204 with the new ETag.
 */
export async function handleFileWrite(
	request: Request,
	pathToken: string,
	configPath?: string,
	defaultRoots: readonly string[] = [],
): Promise<Response>
{
	const {rejectCrossSite} = await import("../../lib/same-origin-guard");
	const crossSite = rejectCrossSite(request);
	if (crossSite !== null) return crossSite;
	const requestedPath = decodeFilePath(pathToken);
	if (requestedPath === null) return errorResponse("A valid encoded file path is required", 400);

	const {resolveConfiguredFileRoots} = await import("../../lib/config");
	const {realpathOfExistingPrefix, writableWorkspacePath, writeFileAtomically} =
		await import("../../lib/session-file-write");
	const {deniedResponse, rejectStaleWrite, savedFileHeaders} = await import("../../lib/file-edit-server");
	const roots = await resolveConfiguredFileRoots(configPath, defaultRoots);
	if (!(await writableWorkspacePath(requestedPath, roots))) return deniedResponse();
	// Write through a symlink inside the roots rather than replacing the link.
	const target = await realpathOfExistingPrefix(requestedPath);
	const stale = await rejectStaleWrite(request, target);
	if (stale !== null) return stale;
	try
	{
		await writeFileAtomically(target, await request.text());
	}
	catch
	{
		return Response.json(
			{
				reason: "writeFailed",
			},
			{
				status: 500,
			},
		);
	}
	return new Response(
		null,
		{
			status: 204,
			headers: await savedFileHeaders(target),
		},
	);
}

async function fileRoots(): Promise<string[]>
{
	const {resolveFileSearchRoots} = await import("../../lib/config");
	const {getDb} = await import("../../lib/db");
	return resolveFileSearchRoots(getDb().index);
}

export const Route = createFileRoute("/api/file/$")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async ({
						params,
						request,
					}: {
						params:
						{
							_splat?: string;
						};
						request: Request;
					}) =>
					{
						return handleFileRequest(request, params._splat ?? "", undefined, await fileRoots());
					},
					PUT: async ({
						params,
						request,
					}: {
						params:
						{
							_splat?: string;
						};
						request: Request;
					}) =>
					{
						return handleFileWrite(request, params._splat ?? "", undefined, await fileRoots());
					},
				},
			),
		},
	},
);
