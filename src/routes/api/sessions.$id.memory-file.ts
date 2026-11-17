import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SESSION_ID_PATTERN} from "../../lib/api/statusline";
import type {ListedMemoryFile} from "../../lib/memory-file-write";

export interface MemoryFileDependencies
{
	/** The session's memory files that list `path`, from its context breakdown. */
	memoryFiles(sessionId: string, path: string): Promise<readonly ListedMemoryFile[]>;
}

const NO_STORE =
{
	"Cache-Control": "private, max-age=0, must-revalidate",
};

function requestedPath(request: Request): string | null
{
	return new URL(request.url).searchParams.get("path");
}

function notFound(): Response
{
	return Response.json(
		{
			error: "Not a memory file of this session",
		},
		{
			status: 404,
			headers: NO_STORE,
		},
	);
}

/**
 * `GET /api/sessions/$id/memory-file?path=<abs>`: a memory file the session's breakdown lists, as
 * `{content, writable, etag}` (the Files viewer's field names) with the version as `ETag`; 404 when it isn't listed or can't be read.
 */
export async function handleMemoryFileGet(
	request: Request,
	sessionId: string,
	dependencies: MemoryFileDependencies,
): Promise<Response>
{
	const path = requestedPath(request);
	if (path === null || !SESSION_ID_PATTERN.test(sessionId)) return notFound();
	const {listedMemoryFile, writableMemoryFile} = await import("../../lib/memory-file-write");
	const memoryFiles = await dependencies.memoryFiles(sessionId, path);
	if (listedMemoryFile(path, memoryFiles) === undefined) return notFound();
	const {readFile, stat} = await import("node:fs/promises");
	const {mtimeEtag} = await import("../../lib/file-edit");
	let content: string;
	let etag: string;
	try
	{
		content = await readFile(path, "utf-8");
		etag = mtimeEtag((await stat(path)).mtime);
	}
	catch
	{
		return notFound();
	}
	return Response.json(
		{
			content,
			writable: writableMemoryFile(path, memoryFiles),
			etag,
		},
		{
			headers:
			{
				...NO_STORE,
				ETag: etag,
			},
		},
	);
}

/**
 * `PUT /api/sessions/$id/memory-file?path=<abs>`: the raw body replaces a writable memory file atomically.
 * 403 `{reason:"denied"}` unless it is a listed User/Project/Local `.md`, 409 `{reason:"missing"|"conflict"}`
 * for a stale `If-Match`, else 204 with the new `ETag`.
 */
export async function handleMemoryFilePut(
	request: Request,
	sessionId: string,
	dependencies: MemoryFileDependencies,
): Promise<Response>
{
	const {rejectCrossSite} = await import("../../lib/same-origin-guard");
	const crossSite = rejectCrossSite(request);
	if (crossSite !== null) return crossSite;
	const {deniedResponse, rejectStaleWrite, savedFileHeaders} = await import("../../lib/file-edit-server");
	const path = requestedPath(request);
	if (path === null || !SESSION_ID_PATTERN.test(sessionId)) return deniedResponse();
	const {writableMemoryFile} = await import("../../lib/memory-file-write");
	if (!writableMemoryFile(path, await dependencies.memoryFiles(sessionId, path))) return deniedResponse();
	const stale = await rejectStaleWrite(request, path);
	if (stale !== null) return stale;
	const {writeFileAtomically} = await import("../../lib/session-file-write");
	try
	{
		await writeFileAtomically(path, await request.text());
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
			headers: await savedFileHeaders(path),
		},
	);
}

async function liveDependencies(): Promise<MemoryFileDependencies>
{
	const {homedir} = await import("node:os");
	const {join} = await import("node:path");
	const {sessionMemoryFiles} = await import("../../lib/memory-file-write");
	const projectsDir = join(homedir(), ".claude", "projects");
	return {
		memoryFiles: async (sessionId, path) => sessionMemoryFiles(sessionId, projectsDir, path),
	};
}

export const Route = createFileRoute("/api/sessions/$id/memory-file")(
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
							id: string;
						};
						request: Request;
					}) => handleMemoryFileGet(request, params.id, await liveDependencies()),
					PUT: async ({
						params,
						request,
					}: {
						params:
						{
							id: string;
						};
						request: Request;
					}) => handleMemoryFilePut(request, params.id, await liveDependencies()),
				},
			),
		},
	},
);
