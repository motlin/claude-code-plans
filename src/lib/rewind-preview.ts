import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";

import {getDb} from "./db";
import type * as schema from "./db/schema";
import {isRestoringFiles} from "./rewind-files";
import type {JsonlRecord} from "./schemas";
import {errorResponse, findSession, jsonResponse, readRecords} from "./session-diff-handler";
import {aggregateSessionEdits} from "./session-edits-diff";

/**
 * The dry run behind upstream's rewind confirm (`Lue`): whether the code can
 * be restored to a user message, and the file edits since it that a restore
 * would undo.
 */
export interface RewindFilesPreview {
	/** The message has a file checkpoint, so `claude --rewind-files` can restore to it. */
	canRewind: boolean;
	filesChanged: string[];
	insertions: number;
	deletions: number;
}

const NOTHING: RewindFilesPreview = {canRewind: false, filesChanged: [], insertions: 0, deletions: 0};

function isCheckpointFor(record: JsonlRecord, uuid: string): boolean {
	if (record.type === "file-history-snapshot") {
		return record.messageId === uuid || record.snapshot.messageId === uuid;
	}
	return record.type === "file-history-delta" && record.messageId === uuid;
}

/** The net file edits from the message to the end, when the message has a file checkpoint. */
export function previewRewindFiles(records: readonly JsonlRecord[], uuid: string): RewindFilesPreview {
	const start = records.findIndex((record) => record.type === "user" && record.uuid === uuid);
	if (start === -1 || !records.some((record) => isCheckpointFor(record, uuid))) return NOTHING;
	const edits = aggregateSessionEdits(records.slice(start));
	return {
		canRewind: true,
		filesChanged: edits.map((edit) => edit.path),
		insertions: edits.reduce((sum, edit) => sum + edit.additions, 0),
		deletions: edits.reduce((sum, edit) => sum + edit.deletions, 0),
	};
}

export interface RewindFilesPreviewDependencies {
	index: BetterSQLite3Database<typeof schema>;
	readRecords(filePath: string): Promise<JsonlRecord[]>;
	/** A code restore for the session is still running. */
	restoring(sessionId: string): boolean;
}

/** `GET /api/sessions/$id/rewind-files?message=<uuid>`: the code restore's dry run, or `{inFlight: true}`. */
export async function handleRewindFilesPreview(
	sessionId: string,
	request: Request,
	dependencies?: RewindFilesPreviewDependencies,
): Promise<Response> {
	const resolved = dependencies ?? {index: getDb().index, readRecords, restoring: isRestoringFiles};
	const message = new URL(request.url).searchParams.get("message");
	if (!message) return errorResponse("A message is required", 400);
	const session = findSession(resolved.index, sessionId);
	if ("error" in session) return session.error;
	if (resolved.restoring(sessionId)) return jsonResponse({inFlight: true});
	return jsonResponse(previewRewindFiles(await resolved.readRecords(session.location.filePath), message));
}
