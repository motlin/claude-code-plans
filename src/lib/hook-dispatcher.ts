import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import * as schema from './db/schema';
import type {ActiveSessionEntry} from './active-session-store';
import {DOMAIN_EVENTS, SSE_EVENTS, type HookEvent} from './hook-events';
import {buildSessionSummaryPayloadFromDb, toActiveSessionPayload} from './session-summary';

type IndexDb = BetterSQLite3Database<typeof schema>;

/**
 * Narrow surface of the active-session store the dispatcher needs. Exposed as
 * an interface so tests can substitute a fake without loading the real
 * HMR-persisted singleton.
 */
interface ActiveSessionStore {
	markSessionActive(sessionId: string, meta: {cwd: string; model?: string; claudeEnv?: Record<string, string>}): void;
	markSessionEnded(sessionId: string): void;
	touchSession(sessionId: string): void;
	getActiveSessionEntry(sessionId: string): ActiveSessionEntry | null;
}

interface DispatchHookEventArgs {
	event: HookEvent;
	db: IndexDb;
	store: ActiveSessionStore;
	broadcast: (type: string, data: Record<string, unknown>) => void;
}

/**
 * Route a single parsed hook event to the active-session store and SSE
 * broadcaster. Each case emits enriched domain-level deltas that the client
 * patches directly into the TanStack Query cache. SESSION_START / SESSION_END
 * remain on the wire as lifecycle signals for the active-session indicator;
 * everything else is a DOMAIN_EVENTS delta.
 */
export function dispatchHookEvent({event, db, store, broadcast}: DispatchHookEventArgs): void {
	switch (event.hook_event_name) {
		case 'SessionStart': {
			const meta: {cwd: string; model?: string; claudeEnv?: Record<string, string>} = {
				cwd: event.cwd ?? '',
			};
			if (event.model !== undefined) {
				meta.model = event.model;
			}
			if (event.claude_env !== undefined) {
				meta.claudeEnv = event.claude_env;
			}
			store.markSessionActive(event.session_id, meta);

			// Lifecycle signal for the active-session indicator.
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
			const summary = buildSessionSummaryPayloadFromDb(db, event.session_id);
			if (summary) {
				broadcast(DOMAIN_EVENTS.SESSION_UPDATED, {session: summary});
			}
			break;
		}

		case 'PostToolUse': {
			store.touchSession(event.session_id);
			break;
		}

		case 'TaskCompleted': {
			broadcast(DOMAIN_EVENTS.TASK_COMPLETED, {
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
