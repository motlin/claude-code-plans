import {createContext, useContext, useEffect, useReducer, type ReactNode} from 'react';
import {useRouter} from '@tanstack/react-router';
import {SSE_EVENTS, type SseEventType} from '../lib/hook-events';
import type {Section} from '../components/sidebar/types';

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export interface ActiveSessionInfo {
	sessionId: string;
	cwd: string;
	model: string;
	startedAt: number;
	lastActivity: number;
}

export interface ClaudeEventsState {
	activeSessions: Map<string, ActiveSessionInfo>;
	lastEventByType: Map<string, number>;
	lastEventTimestamp: number;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ClaudeEventsAction =
	| {
			type: 'SSE_EVENT';
			eventType: string;
			data: Record<string, unknown>;
			timestamp: number;
	  }
	| {type: 'RESET'};

// ---------------------------------------------------------------------------
// Reducer (exported for testing)
// ---------------------------------------------------------------------------

function cloneState(state: ClaudeEventsState): ClaudeEventsState {
	return {
		activeSessions: new Map(state.activeSessions),
		lastEventByType: new Map(state.lastEventByType),
		lastEventTimestamp: state.lastEventTimestamp,
	};
}

export function claudeEventsReducer(state: ClaudeEventsState, action: ClaudeEventsAction): ClaudeEventsState {
	if (action.type === 'RESET') {
		return {
			activeSessions: new Map(),
			lastEventByType: new Map(),
			lastEventTimestamp: 0,
		};
	}

	const next = cloneState(state);
	next.lastEventByType.set(action.eventType, action.timestamp);
	next.lastEventTimestamp = action.timestamp;

	const sessionId = typeof action.data['sessionId'] === 'string' ? action.data['sessionId'] : undefined;

	switch (action.eventType) {
		case SSE_EVENTS.SESSION_START: {
			if (sessionId) {
				next.activeSessions.set(sessionId, {
					sessionId,
					cwd: typeof action.data['cwd'] === 'string' ? action.data['cwd'] : '',
					model: typeof action.data['model'] === 'string' ? action.data['model'] : '',
					startedAt: action.timestamp,
					lastActivity: action.timestamp,
				});
			}
			break;
		}
		case SSE_EVENTS.SESSION_END: {
			if (sessionId) {
				next.activeSessions.delete(sessionId);
			}
			break;
		}
		case SSE_EVENTS.SESSION_UPDATE: {
			if (sessionId) {
				const existing = next.activeSessions.get(sessionId);
				if (existing) {
					next.activeSessions.set(sessionId, {
						...existing,
						lastActivity: action.timestamp,
					});
				}
			}
			break;
		}
		default:
			break;
	}

	return next;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ClaudeEventsContext = createContext<ClaudeEventsState | null>(null);

export function useClaudeEvents(): ClaudeEventsState {
	const ctx = useContext(ClaudeEventsContext);
	if (!ctx) {
		throw new Error('useClaudeEvents must be used within a ClaudeEventsProvider');
	}
	return ctx;
}

/**
 * Convenience hook: returns true if the given session ID is in the active sessions map.
 */
export function useIsSessionActive(sessionId: string): boolean {
	const {activeSessions} = useClaudeEvents();
	return activeSessions.has(sessionId);
}

/**
 * Convenience hook: returns the timestamp of the last event of any type,
 * useful as a refreshKey for components that re-fetch on any change.
 */
export function useLastEventTimestamp(): number {
	return useClaudeEvents().lastEventTimestamp;
}

// ---------------------------------------------------------------------------
// Per-section refresh keys
// ---------------------------------------------------------------------------

const SECTION_EVENTS: Record<Section, readonly SseEventType[]> = {
	active: [SSE_EVENTS.SESSION_START, SSE_EVENTS.SESSION_END, SSE_EVENTS.SESSION_UPDATE],
	sessions: [SSE_EVENTS.SESSION_START, SSE_EVENTS.SESSION_END, SSE_EVENTS.SESSIONS_REINDEXED],
	projects: [SSE_EVENTS.SESSIONS_REINDEXED, SSE_EVENTS.WORKTREE_CREATED],
	tasks: [SSE_EVENTS.TASK_UPDATED, SSE_EVENTS.TASK_COMPLETED],
	plans: [SSE_EVENTS.PLAN_UPDATED],
	memories: [SSE_EVENTS.MEMORY_UPDATED],
	plugins: [SSE_EVENTS.CONTENT_UPDATED],
	starred: [SSE_EVENTS.SESSIONS_REINDEXED],
	setup: [],
};

/**
 * Pure function: compute the refresh key for a sidebar section from the
 * lastEventByType map. Only events relevant to the section are considered.
 */
export function getSectionRefreshKey(lastEventByType: Map<string, number>, section: Section): number {
	const events = SECTION_EVENTS[section];
	let max = 0;
	for (const e of events) {
		const ts = lastEventByType.get(e);
		if (ts !== undefined && ts > max) max = ts;
	}
	return max;
}

/**
 * Hook: returns a refresh key that only changes when SSE events relevant to
 * the given sidebar section are received. Prevents unrelated events from
 * causing re-fetches in other sections.
 */
export function useSectionRefreshKey(section: Section): number {
	const {lastEventByType} = useClaudeEvents();
	return getSectionRefreshKey(lastEventByType, section);
}

// ---------------------------------------------------------------------------
// Selective route invalidation
// ---------------------------------------------------------------------------

/**
 * Determine whether a router invalidation is needed for the given SSE event
 * type based on the currently active route pathname. This avoids needless
 * loader re-runs for events that are irrelevant to the visible page.
 */
export function shouldInvalidateRoute(eventType: string, data: Record<string, unknown>, pathname: string): boolean {
	switch (eventType) {
		case SSE_EVENTS.SESSION_START:
		case SSE_EVENTS.SESSION_END:
			return (
				pathname === '/' ||
				pathname === '/active' ||
				pathname === '/sessions' ||
				pathname.startsWith('/session/')
			);

		case SSE_EVENTS.SESSION_UPDATE: {
			if (pathname === '/active' || pathname === '/sessions' || pathname === '/') return true;
			// Only invalidate a specific session detail page if the IDs match
			if (pathname.startsWith('/session/')) {
				const viewedId = pathname.slice('/session/'.length);
				const eventSessionId = typeof data['sessionId'] === 'string' ? data['sessionId'] : '';
				return viewedId === eventSessionId;
			}
			return false;
		}

		case SSE_EVENTS.SESSIONS_REINDEXED:
			return (
				pathname === '/' ||
				pathname === '/sessions' ||
				pathname === '/projects' ||
				pathname === '/search' ||
				pathname === '/starred' ||
				pathname.startsWith('/session/') ||
				pathname.startsWith('/project/')
			);

		case SSE_EVENTS.TASK_UPDATED:
		case SSE_EVENTS.TASK_COMPLETED:
			return pathname.startsWith('/project/') || pathname === '/';

		case SSE_EVENTS.PLAN_UPDATED:
			return pathname === '/plans' || pathname.startsWith('/plan/');

		case SSE_EVENTS.MEMORY_UPDATED:
			return pathname === '/memories' || pathname.startsWith('/memory/');

		case SSE_EVENTS.WORKTREE_CREATED:
			return pathname.startsWith('/project/') || pathname === '/projects';

		case SSE_EVENTS.CONTENT_UPDATED:
		default:
			// Catch-all and unknown events always invalidate
			return true;
	}
}

// ---------------------------------------------------------------------------
// SSE event types we listen for
// ---------------------------------------------------------------------------

const ALL_SSE_EVENT_TYPES: SseEventType[] = Object.values(SSE_EVENTS);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ClaudeEventsProvider({children}: {children: ReactNode}) {
	const router = useRouter();
	const [state, dispatch] = useReducer(claudeEventsReducer, undefined, () => ({
		activeSessions: new Map<string, ActiveSessionInfo>(),
		lastEventByType: new Map<string, number>(),
		lastEventTimestamp: 0,
	}));

	useEffect(() => {
		const es = new EventSource('/api/events');

		function handleEvent(e: Event) {
			const me = e as MessageEvent;
			let data: Record<string, unknown> = {};
			try {
				data = JSON.parse(me.data) as Record<string, unknown>;
			} catch {
				// empty or non-JSON data is fine
			}
			dispatch({
				type: 'SSE_EVENT',
				eventType: e.type,
				data,
				timestamp: Date.now(),
			});

			const pathname = router.state.location.pathname;
			if (shouldInvalidateRoute(e.type, data, pathname)) {
				router.invalidate();
			}
		}

		for (const eventType of ALL_SSE_EVENT_TYPES) {
			es.addEventListener(eventType, handleEvent);
		}

		return () => es.close();
	}, [router]);

	return <ClaudeEventsContext.Provider value={state}>{children}</ClaudeEventsContext.Provider>;
}
