import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {eq} from "drizzle-orm";
import * as schema from "./db/schema";
import {getActiveSessionEntry, type ActiveSessionEntry} from "./active-session-store";
import {getPendingApprovalsForProject} from "./db/pending-approvals-cache";
import {getSessionPrLink, isSessionArchived} from "./db/queries";
import {isSessionUnseen} from "./db/viewed-state";
import type {ActiveSessionPayload, SessionSummaryPayload} from "./hook-events";
import {getLiveSubagentNodes} from "./live-subagent-store";
import {hasPermissionPromptForSession} from "./notifications-store";
import type {PrStatus} from "./pr-status";
import {lookupSessionPrStatus} from "./pr-status-service";
import {getRegistrySessionState, type RegistrySessionState} from "./session-registry-store";
import {resolveMainState, resolveSessionBucket} from "./session-state";
import type {SessionEntry} from "./sessions";

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * Convert an in-memory ActiveSessionEntry into the wire-level payload shape
 * broadcast on `session:started`. Both shapes are already structurally
 * identical — this helper exists so callers don't depend on that detail.
 */
export function toActiveSessionPayload(entry: ActiveSessionEntry): ActiveSessionPayload {
	return {
		sessionId: entry.sessionId,
		cwd: entry.cwd,
		model: entry.model,
		startedAt: entry.startedAt,
		lastActivity: entry.lastActivity,
	};
}

interface SessionSummaryOptions {
	/** The durable viewed-state `unseen` flag (see `getUnseenSessionIds`). */
	unseen?: boolean;
	/** The app-side archive flag (see `getArchivedSessionIds`). */
	archived?: boolean;
	activeSession?: ActiveSessionEntry | null;
	/** The live `~/.claude/sessions/<pid>.json` entry for the session, if its process runs. */
	registrySession?: RegistrySessionState | null;
	/** PR state for the row; defaults to the in-memory PR status service. */
	prStatus?: PrStatus | null;
	now?: number;
}

/**
 * Convert a raw DB SessionEntry into the serialized SessionSummaryPayload
 * shape used by `/api/sessions` and the session:added/updated/removed events.
 */
export function toSessionSummaryPayload(
	entry: SessionEntry,
	{
		unseen = false,
		archived = false,
		activeSession = getActiveSessionEntry(entry.id),
		registrySession = getRegistrySessionState(entry.id),
		prStatus = lookupSessionPrStatus(entry),
		now = Date.now(),
	}: SessionSummaryOptions = {},
): SessionSummaryPayload {
	const pendingApproval = getPendingApprovalsForProject(entry.project).find(
		(approval) => approval.sessionId === entry.id,
	);
	const liveAgentCount = getLiveSubagentNodes().filter(
		(node) => node.sessionId === entry.id && node.endedAt === null,
	).length;
	const main = resolveMainState({hook: activeSession, registry: registrySession});
	// Only live sessions can wait on a transcript-derived approval; a missing
	// entry is an ended session, even if the approval survived a server restart.
	// The registry knows the live status outright, and the CLI only flushes a
	// question to the transcript once answered, so an unanswered one there is an
	// orphan.
	const pendingInput = activeSession !== null && registrySession === null && pendingApproval !== undefined;
	// A standing permission prompt outlives the active-session sweep: the CLI
	// writes nothing while it waits, so the session goes quiet but is not done.
	const awaitingPermission = hasPermissionPromptForSession(entry.id);
	const {bucket} = resolveSessionBucket({
		mainState: main.state,
		pendingInput,
		awaitingPermission,
		unseenError: false,
		liveAgentCount,
		backgroundTasks: activeSession?.backgroundTasks ?? [],
		lastSubagentActivityAt: activeSession?.lastSubagentActivityAt ?? null,
		herdrStatus: null,
		prState: prStatus?.state ?? null,
		unseen,
		fileMtime: entry.mtime.getTime(),
		now,
	});
	return {
		id: entry.id,
		title: entry.title,
		summary: entry.summary,
		mtime: entry.mtime.toISOString(),
		created: entry.created.toISOString(),
		project: entry.project,
		projectName: entry.projectName,
		messageCount: entry.messageCount,
		gitBranch: entry.gitBranch,
		...(entry.pr === undefined ? {} : {pr: entry.pr}),
		...(prStatus === null ? {} : {prStatus}),
		...(entry.forkedFromSessionId === undefined ? {} : {forkedFromSessionId: entry.forkedFromSessionId}),
		archived,
		state: pendingInput || awaitingPermission ? "waiting" : main.state,
		bucket,
		liveAgentCount,
		unseen,
		blockedSince: blockedSince(main, registrySession, pendingInput ? pendingApproval : undefined),
	};
}

function blockedSince(
	main: ReturnType<typeof resolveMainState>,
	registrySession: RegistrySessionState | null,
	pendingApproval: {blockedSince: string} | undefined,
): string | null {
	if (pendingApproval !== undefined) return pendingApproval.blockedSince;
	if (main.source === "registry" && main.state === "waiting" && registrySession !== null) {
		return new Date(registrySession.statusUpdatedAt).toISOString();
	}
	return null;
}

/**
 * Look up a session by id in the index DB and return the
 * SessionSummaryPayload shape that hook broadcasts use. Returns null when the
 * session has not yet been indexed (e.g., brand new session whose sessions-index.json
 * update has not hit disk yet).
 */
export function buildSessionSummaryPayloadFromDb(
	db: IndexDb,
	sessionId: string,
	activeSessionLookup: (sessionId: string) => ActiveSessionEntry | null = getActiveSessionEntry,
): SessionSummaryPayload | null {
	const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
	if (!row) return null;

	const projectRow = db.select().from(schema.projects).where(eq(schema.projects.id, row.projectId)).get();
	const projectName = projectRow?.name ?? row.projectId;

	return toSessionSummaryPayload(
		{
			id: row.id,
			title: row.title,
			firstPrompt: row.firstPrompt ?? undefined,
			summary: row.summary ?? undefined,
			customTitle: row.customTitle ?? undefined,
			mtime: new Date(row.mtimeMs),
			created: new Date(row.createdAt),
			project: row.projectId,
			projectName,
			messageCount: row.messageCount,
			gitBranch: row.gitBranch ?? undefined,
			cwd: row.cwd ?? undefined,
			isSidechain: row.isSidechain === 1,
			forkedFromSessionId: row.forkedFromSessionId ?? undefined,
			pr: getSessionPrLink(db, sessionId) ?? undefined,
		},
		{
			unseen: isSessionUnseen(db, sessionId),
			archived: isSessionArchived(db, sessionId),
			activeSession: activeSessionLookup(sessionId),
		},
	);
}
