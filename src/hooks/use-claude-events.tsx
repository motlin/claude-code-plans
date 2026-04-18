import {createContext, useCallback, useContext, useEffect, useReducer, useState, type ReactNode} from 'react';
import {SSE_EVENTS} from '../lib/hook-events';

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

export function claudeEventsReducer(state: ClaudeEventsState, action: ClaudeEventsAction): ClaudeEventsState {
	if (action.type === 'RESET') {
		return {activeSessions: new Map()};
	}

	const sessionId = typeof action.data['sessionId'] === 'string' ? action.data['sessionId'] : undefined;

	switch (action.eventType) {
		case SSE_EVENTS.SESSION_START: {
			if (!sessionId) return state;
			const activeSessions = new Map(state.activeSessions);
			activeSessions.set(sessionId, {
				sessionId,
				cwd: typeof action.data['cwd'] === 'string' ? action.data['cwd'] : '',
				model: typeof action.data['model'] === 'string' ? action.data['model'] : '',
				startedAt: action.timestamp,
				lastActivity: action.timestamp,
			});
			return {activeSessions};
		}
		case SSE_EVENTS.SESSION_END: {
			if (!sessionId || !state.activeSessions.has(sessionId)) return state;
			const activeSessions = new Map(state.activeSessions);
			activeSessions.delete(sessionId);
			return {activeSessions};
		}
		case SSE_EVENTS.SESSION_UPDATE: {
			if (!sessionId) return state;
			const existing = state.activeSessions.get(sessionId);
			if (!existing) return state;
			const activeSessions = new Map(state.activeSessions);
			activeSessions.set(sessionId, {...existing, lastActivity: action.timestamp});
			return {activeSessions};
		}
		default:
			return state;
	}
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

// ---------------------------------------------------------------------------
// SSE event types we listen for (lifecycle events feeding the reducer)
// ---------------------------------------------------------------------------

const LIFECYCLE_EVENT_TYPES = [SSE_EVENTS.SESSION_START, SSE_EVENTS.SESSION_END, SSE_EVENTS.SESSION_UPDATE] as const;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ClaudeEventsProvider({children}: {children: ReactNode}) {
	const [state, dispatch] = useReducer(claudeEventsReducer, undefined, () => ({
		activeSessions: new Map<string, ActiveSessionInfo>(),
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
		}

		for (const eventType of LIFECYCLE_EVENT_TYPES) {
			es.addEventListener(eventType, handleEvent);
		}

		return () => es.close();
	}, []);

	return <ClaudeEventsContext.Provider value={state}>{children}</ClaudeEventsContext.Provider>;
}

// ---------------------------------------------------------------------------
// Statusline hook — fetches statusline JSON and re-fetches on SSE updates
// ---------------------------------------------------------------------------

export function useStatusline(sessionId: string): Record<string, unknown> | null {
	const [data, setData] = useState<Record<string, unknown> | null>(null);

	const fetchStatusline = useCallback(async () => {
		try {
			const {getStatusline} = await import('../lib/server-fns');
			const result = await getStatusline({data: {sessionId}});
			if (result) {
				setData(result as Record<string, unknown>);
			}
		} catch {
			// statusline not available
		}
	}, [sessionId]);

	// Initial fetch
	useEffect(() => {
		fetchStatusline();
	}, [fetchStatusline]);

	// Subscribe to statusline SSE updates for this session
	useEffect(() => {
		const es = new EventSource('/api/events');
		const handler = (e: Event) => {
			const me = e as MessageEvent;
			try {
				const parsed = JSON.parse(me.data) as Record<string, unknown>;
				if (parsed['sessionId'] === sessionId) {
					fetchStatusline();
				}
			} catch {
				// ignore
			}
		};
		es.addEventListener(SSE_EVENTS.STATUSLINE_UPDATED, handler);
		return () => es.close();
	}, [sessionId, fetchStatusline]);

	return data;
}
