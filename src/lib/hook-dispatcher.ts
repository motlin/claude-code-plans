import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import * as schema from './db/schema';
import type {ActiveSessionEntry} from './active-session-store';
import {DOMAIN_EVENTS, SSE_EVENTS, type HookEvent} from './hook-events';
import {buildSessionSummaryPayloadFromDb, toActiveSessionPayload} from './session-summary';

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * Narrow surface of the active-session store the dispatcher needs. Exposed as
 * an interface so tests can substitute a fake without loading the real
 * globalThis-backed singleton.
 */
export interface ActiveSessionStore {
	markSessionActive(sessionId: string, meta: {cwd: string; model?: string}): void;
	markSessionEnded(sessionId: string): void;
	touchSession(sessionId: string): void;
	getActiveSessionEntry(sessionId: string): ActiveSessionEntry | null;
}

export interface DispatchHookEventArgs {
	event: HookEvent;
	db: IndexDb;
	store: ActiveSessionStore;
	broadcast: (type: string, data: Record<string, unknown>) => void;
}

/**
 * Route a single parsed hook event to the active-session store and SSE
 * broadcaster. During the migration each case emits both the legacy
 * file-level SSE event (consumed by the old reducer) and the enriched
 * domain-level delta (consumed by the new TanStack Query cache patcher).
 */
export function dispatchHookEvent({event, db, store, broadcast}: DispatchHookEventArgs): void {
	switch (event.hook_event_name) {
		case 'SessionStart': {
			const meta: {cwd: string; model?: string} = {cwd: event.cwd ?? ''};
			if (event.model !== undefined) {
				meta.model = event.model;
			}
			store.markSessionActive(event.session_id, meta);

			// Legacy file-level event — keep until old infra is deleted
			broadcast(SSE_EVENTS.SESSION_START, {
				sessionId: event.session_id,
				cwd: event.cwd ?? '',
				model: event.model ?? '',
			});

			// Enriched domain events
			const active = store.getActiveSessionEntry(event.session_id);
			if (active) {
				broadcast(DOMAIN_EVENTS.SESSION_STARTED, {session: toActiveSessionPayload(active)});
			}
			const summary = buildSessionSummaryPayloadFromDb(db, event.session_id);
			if (summary) {
				broadcast(DOMAIN_EVENTS.SESSION_ADDED, {session: summary});
			}
			break;
		}

		case 'SessionEnd': {
			store.markSessionEnded(event.session_id);
			broadcast(SSE_EVENTS.SESSION_END, {sessionId: event.session_id});
			broadcast(DOMAIN_EVENTS.SESSION_ENDED, {sessionId: event.session_id});
			break;
		}

		case 'Stop': {
			store.touchSession(event.session_id);
			broadcast(SSE_EVENTS.SESSION_UPDATE, {sessionId: event.session_id});
			const summary = buildSessionSummaryPayloadFromDb(db, event.session_id);
			if (summary) {
				broadcast(DOMAIN_EVENTS.SESSION_UPDATED, {session: summary});
			}
			break;
		}

		case 'PostToolUse': {
			const filePath = (event.tool_input as Record<string, unknown> | undefined)?.['file_path'];
			if (typeof filePath === 'string' && filePath.includes('/tasks/')) {
				broadcast(SSE_EVENTS.TASK_UPDATED, {
					sessionId: event.session_id,
					filePath,
				});
			}
			store.touchSession(event.session_id);
			break;
		}

		case 'TaskCompleted': {
			// Legacy and domain share the 'task:completed' wire name — one broadcast
			// covers both consumers.
			broadcast(SSE_EVENTS.TASK_COMPLETED, {
				sessionId: event.session_id,
				taskId: event.task_id ?? '',
				subject: event.task_subject ?? '',
			});
			store.touchSession(event.session_id);
			break;
		}

		case 'WorktreeCreate': {
			broadcast(SSE_EVENTS.WORKTREE_CREATED, {
				sessionId: event.session_id,
				name: event.name ?? '',
			});
			break;
		}
	}
}
