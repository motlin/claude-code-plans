import {KeepReportSchema, type KeepReport} from "./auto-archive";
import {AutoArchiveSettingSchema} from "./auto-archive-options";
import {getConfigPath, readAutoArchiveInactiveDays, updateAutoArchiveInactiveDays} from "./config";
import {rejectCrossSite} from "./same-origin-guard";

const RESPONSE_HEADERS = {"Cache-Control": "private, max-age=0, must-revalidate"};

async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return undefined;
	}
}

export function handleGetAutoArchive(configPath: string = getConfigPath()): Response {
	return Response.json({days: readAutoArchiveInactiveDays(configPath)}, {headers: RESPONSE_HEADERS});
}

/** Save the Archive inactive sessions setting, then `onSaved` (the server starts a sweep). */
export async function handlePutAutoArchive(
	request: Request,
	configPath: string = getConfigPath(),
	onSaved: () => void = () => {},
): Promise<Response> {
	const rejection = rejectCrossSite(request);
	if (rejection) return rejection;
	const parsed = AutoArchiveSettingSchema.safeParse(await readJson(request));
	if (!parsed.success) return Response.json({error: "Invalid auto-archive setting"}, {status: 400});

	const days = await updateAutoArchiveInactiveDays(parsed.data.days, configPath);
	onSaved();
	return Response.json({days}, {headers: RESPONSE_HEADERS});
}

/** A browser reporting the sessions it pins or has open, which the sweeper must never archive. */
export async function handlePutKeptSessions(request: Request, record: (report: KeepReport) => void): Promise<Response> {
	const rejection = rejectCrossSite(request);
	if (rejection) return rejection;
	const parsed = KeepReportSchema.safeParse(await readJson(request));
	if (!parsed.success) return Response.json({error: "Invalid keep report"}, {status: 400});

	record(parsed.data);
	return new Response(null, {status: 204});
}
