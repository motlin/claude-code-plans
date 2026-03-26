import {createContext, useContext, useEffect, useReducer, type ReactNode} from 'react';
import {useRouter} from '@tanstack/react-router';
import {SSE_EVENTS, type SseEventType} from '../lib/hook-events';

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
			router.invalidate();
		}

		for (const eventType of ALL_SSE_EVENT_TYPES) {
			es.addEventListener(eventType, handleEvent);
		}

		return () => es.close();
	}, [router]);

	return <ClaudeEventsContext.Provider value={state}>{children}</ClaudeEventsContext.Provider>;
}
