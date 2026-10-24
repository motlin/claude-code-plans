import {z} from "zod";

import {type FileRefStatus, FileRefsResponseSchema, MAX_FILE_REF_PATHS} from "./api/file-refs";
import {fileRefStatuses} from "./file-serving";
import {rejectCrossSite} from "./same-origin-guard";

const FileRefsRequestSchema = z.strictObject({
	paths: z.array(z.string().min(1).max(4096)).max(MAX_FILE_REF_PATHS),
});

/**
 * Each requested path's {@link FileRefStatus}, so the transcript links refs
 * that open and blocks those outside the roots. Paths come back as requested
 * (not symlink-resolved) so the client can match them.
 */
export async function handleFileRefsRequest(
	request: Request,
	configPath?: string,
	defaultRoots: readonly string[] = [],
): Promise<Response> {
	const rejection = rejectCrossSite(request);
	if (rejection) return rejection;

	const parsed = FileRefsRequestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return Response.json({error: z.prettifyError(parsed.error)}, {status: 400});
	}

	const {paths} = parsed.data;
	const checks = await fileRefStatuses(paths, configPath, defaultRoots);
	const statuses = Object.fromEntries(paths.map((path, index) => [path, checks[index]]));
	return Response.json(FileRefsResponseSchema.parse({statuses}), {
		headers: {"Cache-Control": "private, no-store"},
	});
}
