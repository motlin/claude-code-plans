import {mkdir, open, rm, writeFile} from "node:fs/promises";
import {basename, dirname, join} from "node:path";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import type * as schema from "./db/schema";
import {isSessionBridged} from "./db/bridge-session-index";
import {indexFile} from "./db/indexer";
import {bridgePushedTitle, setBridgePushedTitle} from "./bridge-pushed-title-store";
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

/** Where a rename goes: a bridged session's live CLI pushes it to claude.ai/code; any other session saves it locally. */
export type SessionRenamePath = "bridge" | "local";

export function sessionRenamePath(bridged: boolean): SessionRenamePath {
	return bridged ? "bridge" : "local";
}

/** The one-line `/rename` the live CLI runs, or null for a blank title (which /rename would replace with a generated one). */
export function bridgeRenameCommand(title: string): {title: string; command: string} | null {
	const line = title.replace(/\s+/g, " ").trim();
	return line === "" ? null : {title: line, command: `/rename ${line}`};
}

const RENAME_RESPONSE_HEADERS = {"Cache-Control": "private, max-age=0, must-revalidate"};

interface RenameSessionTitleArgs extends RenameSessionArgs {
	/** Type a prompt into the session's live CLI pane, answering as the terminal host's prompt endpoint does. */
	promptLiveSession: (sessionId: string, prompt: string) => Promise<Response>;
}

/**
 * Rename a session the way its title is shown. claude.ai/code titles a bridged
 * (Remote Control) session itself and never sees a local custom title, so the
 * session's live CLI runs `/rename`, which pushes the name to claude.ai/code
 * and records it in the transcript; the pushed name is remembered so it, not
 * the ai-title, titles the session here too. Any other session gets a local
 * custom title.
 */
export async function renameSessionTitle(args: RenameSessionTitleArgs): Promise<Response> {
	const {db, claudeDir, sessionId, title, broadcast, promptLiveSession} = args;
	if (sessionRenamePath(isSessionBridged(db, sessionId)) === "local") {
		const renamed = await renameSession(args);
		if (!renamed) return Response.json({error: "Session not found"}, {status: 404});
		return Response.json(renamed, {headers: RENAME_RESPONSE_HEADERS});
	}

	const rename = bridgeRenameCommand(title);
	if (!rename) return Response.json({error: "A bridged session needs a name"}, {status: 400});

	// Remembered before the CLI can record the rename, so the reindex it triggers already titles by it.
	const previous = bridgePushedTitle(sessionId);
	setBridgePushedTitle(sessionId, rename.title);
	const pushed = await promptLiveSession(sessionId, rename.command);
	if (!pushed.ok) {
		setBridgePushedTitle(sessionId, previous);
		return pushed;
	}

	const projectsDir = join(claudeDir, "projects");
	const resolved = await resolveSessionFilePath(projectsDir, sessionId);
	if (resolved) await indexFile(db, resolved.filePath, projectsDir, join(claudeDir, "plans"));
	const summary = buildSessionSummaryPayloadFromDb(db, sessionId);
	if (summary) broadcast(DOMAIN_EVENTS.SESSION_UPDATED, {session: summary});

	// The CLI records the rename moments later; until then the client keeps showing the new name.
	return Response.json({customTitle: rename.title, title: rename.title}, {headers: RENAME_RESPONSE_HEADERS});
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
