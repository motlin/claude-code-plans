import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {
	decodeFilePath,
	type FilePreviewUnavailable,
	FileViewerErrorResponse,
	FileViewerResponse,
} from "../../lib/api/file";
import {imageContentType} from "../../lib/file-preview";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

function errorResponse(error: string, status: number, preview?: FilePreviewUnavailable): Response {
	return Response.json(FileViewerErrorResponse.parse({error, ...preview}), {
		status,
		headers: {"Cache-Control": PRIVATE_NO_CACHE},
	});
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
): Promise<Response> {
	const {createReadStream} = await import("node:fs");
	const {Readable} = await import("node:stream");
	const name = path.slice(path.lastIndexOf("/") + 1);
	return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, {
		headers: {
			...headers,
			"Content-Length": String(sizeBytes),
			"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
			"Content-Type": contentType,
			"X-Content-Type-Options": "nosniff",
			...(download ? {"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`} : {}),
		},
	});
}

export async function handleFileRequest(
	request: Request,
	pathToken: string,
	configPath?: string,
	defaultRoots: readonly string[] = [],
): Promise<Response> {
	const requestedPath = decodeFilePath(pathToken);
	if (requestedPath === null) return errorResponse("A valid encoded file path is required", 400);

	const {FileServingError, readAllowedFile, statAllowedFile} = await import("../../lib/file-serving");
	const searchParams = new URL(request.url).searchParams;
	const download = searchParams.get("download") === "1";
	const imageType = imageContentType(requestedPath);
	try {
		if (download || imageType !== null) {
			const file = await statAllowedFile(requestedPath, configPath, defaultRoots);
			const headers = {
				"Cache-Control": PRIVATE_NO_CACHE,
				ETag: `"${file.modifiedAtMilliseconds}-${file.sizeBytes}"`,
			};
			if (request.headers.get("If-None-Match") === headers.ETag) {
				return new Response(null, {status: 304, headers});
			}
			const contentType = download ? "application/octet-stream" : (imageType ?? "");
			return streamFile(file.path, file.sizeBytes, contentType, download, headers);
		}

		const file = await readAllowedFile(requestedPath, configPath, defaultRoots, {
			forceText: searchParams.get("force") === "text",
		});
		const etag = `"${file.modifiedAtMilliseconds}-${file.sizeBytes}"`;
		const headers = {
			"Cache-Control": PRIVATE_NO_CACHE,
			ETag: etag,
		};
		if (request.headers.get("If-None-Match") === etag) {
			return new Response(null, {status: 304, headers});
		}

		return Response.json(FileViewerResponse.parse({content: file.content, path: file.path}), {
			headers,
		});
	} catch (error) {
		if (error instanceof FileServingError) {
			return errorResponse(error.message, error.status, error.preview);
		}
		throw error;
	}
}

export const Route = createFileRoute("/api/file/$")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params, request}: {params: {_splat?: string}; request: Request}) => {
				const {resolveFileSearchRoots} = await import("../../lib/config");
				const {getDb} = await import("../../lib/db");
				const roots = await resolveFileSearchRoots(getDb().index);
				return handleFileRequest(request, params._splat ?? "", undefined, roots);
			},
		}),
	},
});
