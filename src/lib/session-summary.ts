import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {secondaryAiTitle} from "./ai-title";
import {eq, getTableColumns} from "drizzle-orm";
import * as schema from "./db/schema";
import {getActiveSessionEntry, type ActiveSessionEntry} from "./active-session-store";
import {getPendingApprovalsForProject} from "./db/pending-approvals-cache";
import {sessionRemoteControlColumn} from "./db/bridge-session-index";
import {getSessionTerminalHosts} from "./session-terminal-hosts";
import {getSessionPrLink, isSessionArchived} from "./db/queries";
import {isSessionUnseen} from "./db/viewed-state";
import type {ActiveSessionPayload, SessionSummaryPayload} from "./hook-events";
import {getLiveSubagentNodes} from "./live-subagent-store";
import type {PrStatus} from "./pr-status";
import {lookupSessionPrStatus} from "./pr-status-service";
import {registryRemoteControl} from "./session-environment";
import {getRegistrySessionState, type RegistrySessionState} from "./session-registry-store";
import {sessionAwaitingPermission} from "./session-permission-wait";
import {resolveMainState, resolveSessionBucket} from "./session-state";
import {requestTurnVerdict, turnVerdictNeedsInput} from "./turn-verdict";
import {displayedSessionTitle, requestSessionTitle} from "./session-title-generator";
import {sessionDisplayTitle} from "./session-stand-in-title";
import {ownRepositoryPr, readOriginRepoName} from "./session-own-pr";
import type {SessionEntry} from "./sessions";

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * Convert an in-memory ActiveSessionEntry into the wire-level payload shape
 * broadcast on `session:started`. Both shapes are already structurally
 * identical — this helper exists so callers don't depend on that detail.
 */
export function toActiveSessionPayload(entry: ActiveSessionEntry): ActiveSessionPayload
{
	return {
		sessionId: entry.sessionId,
		cwd: entry.cwd,
		model: entry.model,
		startedAt: entry.startedAt,
		lastActivity: entry.lastActivity,
	};
}

interface SessionSummaryOptions
{
	/** The durable viewed-state `unseen` flag (see `getUnseenSessionIds`). */
	unseen?: boolean;
	/** The app-side archive flag (see `getArchivedSessionIds`). */
	archived?: boolean;
	activeSession?: ActiveSessionEntry | null;
	/** The live `~/.claude/sessions/<pid>.json` entry for the session, if its process runs. */
	registrySession?: RegistrySessionState | null;
	/** PR state for the row; defaults to the in-memory PR status service. */
	prStatus?: PrStatus | null;
	/** The row's terminal host label, null for Local; defaults to the in-memory pane tables. List callers pass one lookup for every row. */
	terminalHost?: string | null;
	now?: number;
}

/**
 * Convert a raw DB SessionEntry into the serialized SessionSummaryPayload
 * shape used by `/api/sessions` and the session:added/updated/removed events.
 */
export function toSessionSummaryPayload(
	indexedEntry: SessionEntry,
	options: SessionSummaryOptions = {},
): SessionSummaryPayload
{
	const entry = withOwnRepositoryPr(indexedEntry);
	const
	{
		unseen = false,
		archived = false,
		activeSession = getActiveSessionEntry(entry.id),
		registrySession = getRegistrySessionState(entry.id),
		prStatus = lookupSessionPrStatus(entry),
		terminalHost = getSessionTerminalHosts().get(entry.id) ?? null,
		now = Date.now(),
	} = options;
	const pendingApproval = getPendingApprovalsForProject(entry.project).find(
		(approval) => approval.sessionId === entry.id,
	);
	const liveAgentCount = getLiveSubagentNodes().filter(
		(node) => node.sessionId === entry.id && node.endedAt === null,
	).length;
	const main = resolveMainState(
		{
			hook: activeSession,
			registry: registrySession,
			turnEndedAt: entry.turnEndedAt ?? null,
		},
	);
	// Only live sessions can wait on a transcript-derived approval; a missing
	// entry is an ended session, even if the approval survived a server restart.
	// The registry knows the live status outright, and the CLI only flushes a
	// question to the transcript once answered, so an unanswered one there is an
	// orphan.
	const pendingInput = activeSession !== null && registrySession === null && pendingApproval !== undefined;
	// A standing permission prompt outlives the active-session sweep: the CLI
	// writes nothing while it waits, so the session goes quiet but is not done.
	const awaitingPermission = sessionAwaitingPermission(entry.id, registrySession);
	// Upstream judges every finished turn; ours judges only the turns an unread row could show as waiting.
	if (unseen && entry.turnEndedAt !== undefined && main.state !== "working")
	{
		requestTurnVerdict(entry.id, entry.project, entry.turnEndedAt, now);
	}
	const {bucket, reason} = resolveSessionBucket(
		{
			mainState: main.state,
			bridged: entry.remoteControl === true,
			pendingInput,
			awaitingPermission,
			unseenError: unseen && entry.erroredAt !== undefined,
			liveAgentCount,
			backgroundTasks: activeSession?.backgroundTasks ?? [],
			lastSubagentActivityAt: activeSession?.lastSubagentActivityAt ?? null,
			herdrStatus: null,
			prState: prStatus?.state ?? null,
			unseen,
			verdictNeedsInput: turnVerdictNeedsInput(entry.id, entry.turnEndedAt),
			fileMtime: entry.mtime.getTime(),
			now,
		},
	);
	const title = bridgedSessionTitle(entry, now);
	const aiTitle = secondaryAiTitle(title, entry.aiTitle);
	const remoteControl = registryRemoteControl(registrySession);
	return {
		id: entry.id,
		title,
		...(entry.titleIsStandIn === true
			?
				{
					titleIsStandIn: true,
				}
			: {}),
		summary: entry.summary,
		...(aiTitle === null
			? {}
			:
				{
					aiTitle,
				}),
		...(entry.lastUserMessage === undefined
			? {}
			:
				{
					lastUserMessage: entry.lastUserMessage,
				}),
		mtime: entry.mtime.toISOString(),
		created: entry.created.toISOString(),
		project: entry.project,
		projectName: entry.projectName,
		messageCount: entry.messageCount,
		gitBranch: entry.gitBranch,
		...(entry.pr === undefined
			? {}
			:
				{
					pr: entry.pr,
				}),
		...(prStatus === null
			? {}
			:
				{
					prStatus,
				}),
		...(entry.forkedFromSessionId === undefined
			? {}
			:
				{
					forkedFromSessionId: entry.forkedFromSessionId,
				}),
		archived,
		...(entry.remoteControl === true
			?
				{
					remoteControl: true,
				}
			: {}),
		...(remoteControl === null
			? {}
			:
				{
					remoteControlState: remoteControl.state,
				}),
		...(terminalHost === null
			? {}
			:
				{
					terminalHost,
				}),
		state: pendingInput || awaitingPermission ? "waiting" : main.state,
		...(awaitingPermission
			?
				{
					awaitingPermission: true,
				}
			: {}),
		...(registrySession === null
			? {}
			:
				{
					processStartedAt: registrySession.startedAt,
				}),
		bucket,
		...(reason === "error" && entry.erroredAt !== undefined
			?
				{
					unseenError: true,
					erroredAt: new Date(entry.erroredAt).toISOString(),
				}
			: {}),
		liveAgentCount,
		unseen,
		blockedSince: blockedSince(main, registrySession, pendingInput ? pendingApproval : undefined),
	};
}

/**
 * The indexed title, or for a bridged session named only by its pane name the title generated from its conversation,
 * as claude.ai/code retitles it. Queues a (re)generation when one is due.
 */
function bridgedSessionTitle(entry: SessionEntry, now: number): string
{
	if (entry.remoteControl !== true || entry.customTitle === undefined) return entry.title;
	requestSessionTitle(
		{
			sessionId: entry.id,
			project: entry.project,
			customTitle: entry.customTitle,
			cwd: entry.cwd,
			messageCount: entry.messageCount,
			mtimeMs: entry.mtime.getTime(),
		},
		now,
	);
	return displayedSessionTitle(
		{
			...entry,
			bridged: true,
		},
	);
}

/** The entry without a PR it only touched in another repository, as session detail shows it. */
function withOwnRepositoryPr(entry: SessionEntry): SessionEntry
{
	if (entry.pr === undefined || entry.cwd === undefined) return entry;
	const pr = ownRepositoryPr(entry.pr, readOriginRepoName(entry.cwd));
	if (pr !== null) return entry;
	const {pr: _foreign, ...rest} = entry;
	return rest;
}

function blockedSince(
	main: ReturnType<typeof resolveMainState>,
	registrySession: RegistrySessionState | null,
	pendingApproval:
		|
		  {
				blockedSince: string;
		  }
		| undefined,
): string | null
{
	if (pendingApproval !== undefined) return pendingApproval.blockedSince;
	if (main.source === "registry" && main.state === "waiting" && registrySession !== null)
	{
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
): SessionSummaryPayload | null
{
	const row = db
		.select(
			{
				...getTableColumns(schema.sessions),
				remoteControl: sessionRemoteControlColumn,
			},
		)
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.get();
	if (!row) return null;

	const projectRow = db.select().from(schema.projects).where(eq(schema.projects.id, row.projectId)).get();
	const projectName = projectRow?.name ?? row.projectId;

	return toSessionSummaryPayload(
		{
			id: row.id,
			...sessionDisplayTitle(row.title, row.id, row.cwd),
			firstPrompt: row.firstPrompt ?? undefined,
			lastUserMessage: row.lastUserMessage ?? undefined,
			summary: row.summary ?? undefined,
			customTitle: row.customTitle ?? undefined,
			aiTitle: row.aiTitle ?? undefined,
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
			turnEndedAt: row.turnEndedAt ?? undefined,
			...(row.erroredAt === null
				? {}
				:
					{
						erroredAt: row.erroredAt,
					}),
			...(row.remoteControl === 1
				?
					{
						remoteControl: true,
					}
				: {}),
		},
		{
			unseen: isSessionUnseen(db, sessionId),
			archived: isSessionArchived(db, sessionId),
			activeSession: activeSessionLookup(sessionId),
		},
	);
}
