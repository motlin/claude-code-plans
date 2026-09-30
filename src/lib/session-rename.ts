import {mkdir, open, rm, writeFile} from "node:fs/promises";
import {basename, dirname, join} from "node:path";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import type * as schema from "./db/schema";
import {indexFile} from "./db/indexer";
import {DOMAIN_EVENTS} from "./hook-events";
import {buildSessionSummaryPayloadFromDb} from "./session-summary";
import {resolveSessionFilePath} from "./sessions";

type IndexDb = BetterSQLite3Database<typeof schema>;

interface RenameSessionArgs {
	db: IndexDb;
	claudeDir: string;
	sessionId: string;
	title: string;
	broadcast: (type: string, data: Record<string, unknown>) => void;
}

/**
 * Save a CLI-compatible custom title, reindex the transcript so the new title
 * lands in the DB, and broadcast the updated session summary. Returns null
 * when no top-level transcript exists for the id.
 */
export async function renameSession({
	db,
	claudeDir,
	sessionId,
	title,
	broadcast,
}: RenameSessionArgs): Promise<{customTitle: string | null; title: string} | null> {
	const projectsDir = join(claudeDir, "projects");
	const saved = await saveCustomTitle(projectsDir, sessionId, title);
	if (!saved) return null;

	await indexFile(db, saved.filePath, projectsDir, join(claudeDir, "plans"));
	const summary = buildSessionSummaryPayloadFromDb(db, sessionId);
	if (summary) broadcast(DOMAIN_EVENTS.SESSION_UPDATED, {session: summary});

	return {
		customTitle: saved.customTitle || null,
		title: summary?.title ?? saved.customTitle,
	};
}

/**
 * Mirrors the claude CLI's `saveCustomTitle` so a rename made here shows up
 * in `claude --resume`: append a `custom-title` record to the transcript
 * (last-wins) and keep the `<projectDir>/<id>/custom-title.json` sidecar in
 * step. An empty title reverts to the auto title and removes the sidecar.
 *
 * The transcript belongs to the CLI and may be live, so this only ever
 * appends one line in a single O_APPEND write — existing lines are never
 * rewritten.
 */
async function saveCustomTitle(
	projectsDir: string,
	sessionId: string,
	rawTitle: string,
): Promise<{filePath: string; customTitle: string} | null> {
	if (sessionId.startsWith("agent-")) return null;
	const resolved = await resolveSessionFilePath(projectsDir, sessionId);
	if (!resolved) return null;
	const {filePath} = resolved;
	const customTitle = rawTitle.trim();

	await appendRecord(filePath, JSON.stringify({type: "custom-title", customTitle, sessionId}) + "\n");

	const sidecarDir = join(dirname(filePath), basename(filePath, ".jsonl"));
	const sidecarPath = join(sidecarDir, "custom-title.json");
	if (customTitle) {
		await mkdir(sidecarDir, {recursive: true});
		await writeFile(sidecarPath, JSON.stringify({customTitle}));
	} else {
		await rm(sidecarPath, {force: true});
	}

	return {filePath, customTitle};
}

async function appendRecord(filePath: string, line: string): Promise<void> {
	const handle = await open(filePath, "a+");
	try {
		const {size} = await handle.stat();
		let prefix = "";
		if (size > 0) {
			const last = Buffer.alloc(1);
			await handle.read(last, 0, 1, size - 1);
			// A transcript that does not end in a newline would glue our record onto
			// its last line. Worst case under a racing writer is one blank line,
			// which every reader skips.
			if (last[0] !== 0x0a) prefix = "\n";
		}
		await handle.write(prefix + line);
	} finally {
		await handle.close();
	}
}
