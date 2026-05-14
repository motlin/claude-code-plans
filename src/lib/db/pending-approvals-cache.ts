import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {eq} from 'drizzle-orm';
import * as schema from './schema';
import {scanAllPendingApprovals, scanPendingApproval, type PendingApproval} from '../pending-approvals';
import {getPlanFilenameForSession} from './queries';
import {DOMAIN_EVENTS} from '../hook-events';
import {broadcastTyped} from '../sse-broadcast';

type IndexDb = BetterSQLite3Database<typeof schema>;

const cache = new Map<string, PendingApproval>();

function approvalsEqual(a: PendingApproval, b: PendingApproval): boolean {
	return (
		a.sessionId === b.sessionId &&
		a.projectId === b.projectId &&
		a.projectName === b.projectName &&
		a.toolName === b.toolName &&
		a.toolUseId === b.toolUseId &&
		a.blockedSince === b.blockedSince &&
		a.planFilename === b.planFilename &&
		a.questionPreview === b.questionPreview
	);
}

function lookupProjectName(db: IndexDb, projectId: string): string {
	const row = db
		.select({name: schema.projects.name})
		.from(schema.projects)
		.where(eq(schema.projects.id, projectId))
		.get();
	return row?.name ?? projectId;
}

export async function initPendingApprovalsCache(db: IndexDb): Promise<void> {
	cache.clear();
	const approvals = await scanAllPendingApprovals(db);
	for (const approval of approvals) {
		cache.set(approval.sessionId, approval);
	}
}

export function getPendingApprovals(): PendingApproval[] {
	return Array.from(cache.values()).sort((a, b) => a.blockedSince.localeCompare(b.blockedSince));
}

export function getPendingApprovalsForProject(projectId: string): PendingApproval[] {
	return getPendingApprovals().filter((a) => a.projectId === projectId);
}

export async function updatePendingApprovalForSession(
	db: IndexDb,
	sessionId: string,
	filePath: string,
	projectId: string,
	projectName?: string,
): Promise<void> {
	const scanned = await scanPendingApproval(filePath);
	const prior = cache.get(sessionId);

	if (!scanned) {
		if (prior) {
			cache.delete(sessionId);
			broadcastTyped(DOMAIN_EVENTS.APPROVAL_RESOLVED, {sessionId});
		}
		return;
	}

	const resolvedProjectName = projectName ?? lookupProjectName(db, projectId);
	const planFilename = scanned.planFilename ?? getPlanFilenameForSession(db, sessionId);

	const approval: PendingApproval = {
		sessionId,
		projectId,
		projectName: resolvedProjectName,
		toolName: scanned.toolName,
		toolUseId: scanned.toolUseId,
		blockedSince: scanned.blockedSince,
		planFilename,
		questionPreview: scanned.questionPreview,
	};

	if (prior && approvalsEqual(prior, approval)) return;

	cache.set(sessionId, approval);
	broadcastTyped(DOMAIN_EVENTS.APPROVAL_CHANGED, {approval});
}

export function removePendingApprovalForSession(sessionId: string): void {
	if (!cache.has(sessionId)) return;
	cache.delete(sessionId);
	broadcastTyped(DOMAIN_EVENTS.APPROVAL_RESOLVED, {sessionId});
}
