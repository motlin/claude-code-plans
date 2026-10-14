import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {buildApiRequestLog, mightBeApiRequestLogLine, type ApiRequestLog} from "./api-request-log";
import type * as schema from "./db/schema";
import {trackedReadFileSync} from "./perf/tracked-fs";
import {parseTranscriptLine, transcriptFilePath} from "./structured-transcript";

type IndexDb = BetterSQLite3Database<typeof schema>;

const EMPTY_LOG: ApiRequestLog = {requests: {}, shapes: {}};

/**
 * The whole session's API request log. The transcript window may start after
 * the shape a request was sent with, so a Request disclosure asks for this
 * one full pass instead of resolving against the records it holds.
 */
export function readSessionApiRequestLog(db: IndexDb, id: string): ApiRequestLog {
	const filePath = transcriptFilePath(db, id);
	if (!filePath) return EMPTY_LOG;
	try {
		const records = trackedReadFileSync(filePath)
			.split("\n")
			.flatMap((line) => {
				if (!mightBeApiRequestLogLine(line)) return [];
				const record = parseTranscriptLine(line);
				return record ? [record] : [];
			});
		return buildApiRequestLog(records);
	} catch {
		return EMPTY_LOG;
	}
}
