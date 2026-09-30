import {z} from "zod";

import {FileRefsResponseSchema, MAX_FILE_REF_PATHS} from "./api/file-refs";
import {areAllowedFiles} from "./file-serving";
import {rejectCrossSite} from "./same-origin-guard";

const FileRefsRequestSchema = z.strictObject({
	paths: z.array(z.string().min(1).max(4096)).max(MAX_FILE_REF_PATHS),
});

/**
 * Which of the requested paths are regular files inside the allowed file
 * roots, so the transcript only links refs that open. Paths come back as
 * requested (not symlink-resolved) so the client can match them.
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

	const checks = await areAllowedFiles(parsed.data.paths, configPath, defaultRoots);
	const existing = parsed.data.paths.filter((_path, index) => checks[index]);
	return Response.json(FileRefsResponseSchema.parse({existing}), {
		headers: {"Cache-Control": "private, no-store"},
	});
}
