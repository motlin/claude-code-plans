import {createContext, useCallback, useContext, useEffect, useReducer, useState, type ReactNode} from 'react';
import {useQueryClient, type QueryClient} from '@tanstack/react-query';
import {
	DOMAIN_EVENTS,
	SSE_EVENTS,
	type MemorySummaryPayload,
	type PlanSummaryPayload,
	type SessionLinesAppendedPayload,
	type SessionSummaryPayload,
} from '../lib/hook-events';
import type {TranscriptData} from '../routes/session.$id';

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

interface ActiveSessionInfo {
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
//
// After the TanStack Query migration the reducer only tracks the activeSessions
// Map — everything else (session lists, plans, memories, tasks) is managed by
// the Query cache and patched directly from the SSE listener.
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
		case DOMAIN_EVENTS.SESSION_UPDATED: {
			// Domain SESSION_UPDATED carries the full session summary; only the id
			// is needed here to keep the active indicator alive.
			const session = action.data['session'] as {id?: string} | undefined;
			const id = session?.id ?? sessionId;
			if (!id) return state;
			const existing = state.activeSessions.get(id);
			if (!existing) return state;
			const activeSessions = new Map(state.activeSessions);
			activeSessions.set(id, {...existing, lastActivity: action.timestamp});
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
// Cache-patching helpers (exported for testing)
//
// Each handler applies a single domain event to the TanStack Query cache in
// place with setQueryData. Data shapes mirror the server functions in
// src/lib/server-fns.ts (groups of {project, projectName, entries}).
// ---------------------------------------------------------------------------

type SessionsGroup = {project: string; projectName: string; sessions: SessionSummaryPayload[]};
type MemoryItem = {filename: string; title: string; mtime: string; project: string};
type MemoriesGroup = {project: string; projectName: string; memories: MemoryItem[]};
type PlansGroup = {projectId: string; projectName: string; plans: PlanSummaryPayload[]};

export function applySessionAdded(queryClient: QueryClient, session: SessionSummaryPayload): void {
	queryClient.setQueryData<SessionsGroup[]>(['sessions'], (old) => {
		if (!old) return old;
		const groupIndex = old.findIndex((g) => g.project === session.project);
		if (groupIndex === -1) {
			return [...old, {project: session.project, projectName: session.projectName, sessions: [session]}];
		}
		return old.map((group, i) => {
			if (i !== groupIndex) return group;
			// If the session already exists, replace it; otherwise prepend (newest first).
			const existingIndex = group.sessions.findIndex((s) => s.id === session.id);
			if (existingIndex >= 0) {
				return {
					...group,
					sessions: group.sessions.map((s, j) => (j === existingIndex ? session : s)),
				};
			}
			return {...group, sessions: [session, ...group.sessions]};
		});
	});
	// Project session counts changed.
	void queryClient.invalidateQueries({queryKey: ['projects']});
	void queryClient.invalidateQueries({queryKey: ['project', session.project]});
	// Plan links are derived from session JSONL content — a new session may
	// reference a plan, so invalidate all plan link queries.
	void queryClient.invalidateQueries({
		predicate: (query) => query.queryKey[0] === 'plan' && query.queryKey[2] === 'links',
	});
}

export function applySessionRemoved(queryClient: QueryClient, sessionId: string, projectDir: string): void {
	queryClient.setQueryData<SessionsGroup[]>(['sessions'], (old) => {
		if (!old) return old;
		return old
			.map((group) =>
				group.project === projectDir
					? {...group, sessions: group.sessions.filter((s) => s.id !== sessionId)}
					: group,
			)
			.filter((group) => group.sessions.length > 0);
	});
	queryClient.setQueryData<SessionSummaryPayload[]>(['starred-sessions'], (old) =>
		old ? old.filter((s) => s.id !== sessionId) : old,
	);
	// Prefix match: evicts every sub-cache under ['session', sessionId, ...]
	// (e.g. 'detail', 'subagents', 'summary', 'starred'). TanStack Query uses
	// partial/prefix matching by default, so no exact flag is required.
	queryClient.removeQueries({queryKey: ['session', sessionId]});
	void queryClient.invalidateQueries({queryKey: ['projects']});
	void queryClient.invalidateQueries({queryKey: ['project', projectDir]});
}

export function applySessionUpdated(queryClient: QueryClient, session: SessionSummaryPayload): void {
	queryClient.setQueryData<SessionsGroup[]>(['sessions'], (old) => {
		if (!old) return old;
		return old.map((group) =>
			group.project === session.project
				? {
						...group,
						sessions: group.sessions.map((s) => (s.id === session.id ? session : s)),
					}
				: group,
		);
	});
	queryClient.setQueryData<SessionSummaryPayload[]>(['starred-sessions'], (old) =>
		old ? old.map((s) => (s.id === session.id ? session : s)) : old,
	);
	// Invalidate the session detail so the message list refetches when the
	// .jsonl file has new content (mtime / messageCount changed on disk).
	void queryClient.invalidateQueries({queryKey: ['session', session.id, 'detail']});
	void queryClient.invalidateQueries({queryKey: ['session', session.id, 'summary']});
}

export function applyPlanChanged(queryClient: QueryClient, plan: PlanSummaryPayload): void {
	queryClient.setQueryData<PlanSummaryPayload[]>(['plans'], (old) => {
		if (!old) return old;
		const index = old.findIndex((p) => p.filename === plan.filename);
		return index >= 0 ? old.map((p, i) => (i === index ? plan : p)) : [plan, ...old];
	});
	// Grouped plans have links we don't know from the event alone — invalidate.
	void queryClient.invalidateQueries({queryKey: ['plans', 'grouped']});
	// Plan detail and raw queries must also be invalidated so the detail/edit
	// pages reflect external edits without waiting for staleTime expiry.
	void queryClient.invalidateQueries({queryKey: ['plan', plan.filename, 'detail']});
	void queryClient.invalidateQueries({queryKey: ['plan', plan.filename, 'raw']});
}

export function applyPlanRemoved(queryClient: QueryClient, filename: string): void {
	queryClient.setQueryData<PlanSummaryPayload[]>(['plans'], (old) =>
		old ? old.filter((p) => p.filename !== filename) : old,
	);
	queryClient.setQueryData<PlansGroup[]>(['plans', 'grouped'], (old) => {
		if (!old) return old;
		return old
			.map((group) => ({...group, plans: group.plans.filter((p) => p.filename !== filename)}))
			.filter((group) => group.plans.length > 0);
	});
	queryClient.removeQueries({queryKey: ['plan', filename, 'links']});
}

export function applyMemoryChanged(queryClient: QueryClient, memory: MemorySummaryPayload): void {
	queryClient.setQueryData<MemoriesGroup[]>(['memories'], (old) => {
		if (!old) return old;
		const summary: MemoryItem = {
			filename: memory.filename,
			title: memory.title,
			mtime: memory.mtime,
			project: memory.project,
		};
		const groupIndex = old.findIndex((g) => g.project === memory.project);
		if (groupIndex === -1) {
			return [...old, {project: memory.project, projectName: memory.projectName, memories: [summary]}];
		}
		return old.map((group, i) => {
			if (i !== groupIndex) return group;
			const existingIndex = group.memories.findIndex((m) => m.filename === memory.filename);
			if (existingIndex >= 0) {
				return {
					...group,
					memories: group.memories.map((m, j) => (j === existingIndex ? summary : m)),
				};
			}
			return {...group, memories: [summary, ...group.memories]};
		});
	});
	// Invalidate detail and raw queries so the detail/edit pages reflect
	// external edits without waiting for staleTime expiry.
	void queryClient.invalidateQueries({queryKey: ['memory', memory.project, memory.filename, 'detail']});
	void queryClient.invalidateQueries({queryKey: ['memory', memory.project, memory.filename, 'raw']});
}

export function applyMemoryRemoved(queryClient: QueryClient, project: string, filename: string): void {
	queryClient.setQueryData<MemoriesGroup[]>(['memories'], (old) => {
		if (!old) return old;
		return old
			.map((group) =>
				group.project === project
					? {...group, memories: group.memories.filter((m) => m.filename !== filename)}
					: group,
			)
			.filter((group) => group.memories.length > 0);
	});
	queryClient.removeQueries({queryKey: ['memory', project, filename]});
}

export function applyTaskChanged(queryClient: QueryClient, projectDir: string): void {
	// Task lists include server-rendered HTML (subjectHtml, descriptionHtml) that
	// the SSE delta does not carry — invalidate the affected queries instead of
	// patching partial data into the cache.
	void queryClient.invalidateQueries({queryKey: ['tasks']});
	void queryClient.invalidateQueries({queryKey: ['tasks', 'project', projectDir]});
}

/**
 * Apply SESSION_LINES_APPENDED: append raw JSONL records to the transcript
 * cache. The component's useMemo on interpretJsonlLines() recomputes
 * automatically when the cache updates.
 */
export function applySessionLinesAppended(
	queryClient: QueryClient,
	sessionId: string,
	payload: SessionLinesAppendedPayload,
): void {
	const queryKey = ['session', sessionId, 'transcript'] as const;
	const cached = queryClient.getQueryData<TranscriptData>(queryKey);

	if (!cached) return;

	if (payload.lines.length === 0) return;

	queryClient.setQueryData<TranscriptData>(queryKey, (old) => {
		if (!old) return old;
		return {
			records: [...old.records, ...payload.lines],
			byteOffset: old.byteOffset,
		};
	});
}

function invalidateActiveSessions(queryClient: QueryClient): void {
	// The reducer owns activeSessions state; we only invalidate the query cache
	// here so components using the active-sessions query pick up changes.
	void queryClient.invalidateQueries({queryKey: ['active-sessions']});
}

// ---------------------------------------------------------------------------
// SSE event types we subscribe to
// ---------------------------------------------------------------------------

const LIFECYCLE_EVENT_TYPES = [SSE_EVENTS.SESSION_START, SSE_EVENTS.SESSION_END] as const;

const DOMAIN_EVENT_TYPES = [
	DOMAIN_EVENTS.SESSION_ADDED,
	DOMAIN_EVENTS.SESSION_REMOVED,
	DOMAIN_EVENTS.SESSION_UPDATED,
	DOMAIN_EVENTS.SESSION_STARTED,
	DOMAIN_EVENTS.SESSION_ENDED,
	DOMAIN_EVENTS.SESSION_LINES_APPENDED,
	DOMAIN_EVENTS.PLAN_CHANGED,
	DOMAIN_EVENTS.PLAN_REMOVED,
	DOMAIN_EVENTS.MEMORY_CHANGED,
	DOMAIN_EVENTS.MEMORY_REMOVED,
	DOMAIN_EVENTS.TASK_CHANGED,
	DOMAIN_EVENTS.TASK_COMPLETED,
] as const;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ClaudeEventsProvider({children}: {children: ReactNode}) {
	const [state, dispatch] = useReducer(claudeEventsReducer, undefined, () => ({
		activeSessions: new Map<string, ActiveSessionInfo>(),
	}));

	const queryClient = useQueryClient();

	useEffect(() => {
		const es = new EventSource('/api/events');

		function handleLifecycleEvent(e: Event) {
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

		function handleDomainEvent(e: Event) {
			const me = e as MessageEvent;
			let data: Record<string, unknown>;
			try {
				data = JSON.parse(me.data) as Record<string, unknown>;
			} catch {
				return;
			}

			switch (e.type) {
				case DOMAIN_EVENTS.SESSION_ADDED: {
					const session = data['session'] as SessionSummaryPayload | undefined;
					if (session) applySessionAdded(queryClient, session);
					break;
				}
				case DOMAIN_EVENTS.SESSION_REMOVED: {
					const sessionId = data['sessionId'];
					const projectDir = data['projectDir'];
					if (typeof sessionId === 'string' && typeof projectDir === 'string') {
						applySessionRemoved(queryClient, sessionId, projectDir);
					}
					break;
				}
				case DOMAIN_EVENTS.SESSION_UPDATED: {
					const session = data['session'] as SessionSummaryPayload | undefined;
					if (session) applySessionUpdated(queryClient, session);
					// Also mirror into the activeSessions reducer so the "active" dot
					// stays green while .jsonl / Stop deltas keep arriving.
					dispatch({
						type: 'SSE_EVENT',
						eventType: e.type,
						data,
						timestamp: Date.now(),
					});
					break;
				}
				case DOMAIN_EVENTS.SESSION_LINES_APPENDED: {
					const sessionId = data['sessionId'];
					const lines = data['lines'];
					if (typeof sessionId === 'string' && Array.isArray(lines)) {
						applySessionLinesAppended(queryClient, sessionId, {
							sessionId,
							lines: lines as Record<string, unknown>[],
						});
					}
					break;
				}
				case DOMAIN_EVENTS.SESSION_STARTED:
				case DOMAIN_EVENTS.SESSION_ENDED: {
					invalidateActiveSessions(queryClient);
					break;
				}
				case DOMAIN_EVENTS.PLAN_CHANGED: {
					const plan = data['plan'] as PlanSummaryPayload | undefined;
					if (plan) applyPlanChanged(queryClient, plan);
					break;
				}
				case DOMAIN_EVENTS.PLAN_REMOVED: {
					const filename = data['filename'];
					if (typeof filename === 'string') applyPlanRemoved(queryClient, filename);
					break;
				}
				case DOMAIN_EVENTS.MEMORY_CHANGED: {
					const memory = data['memory'] as MemorySummaryPayload | undefined;
					if (memory) applyMemoryChanged(queryClient, memory);
					break;
				}
				case DOMAIN_EVENTS.MEMORY_REMOVED: {
					const project = data['project'];
					const filename = data['filename'];
					if (typeof project === 'string' && typeof filename === 'string') {
						applyMemoryRemoved(queryClient, project, filename);
					}
					break;
				}
				case DOMAIN_EVENTS.TASK_CHANGED: {
					const task = data['task'] as {projectDir?: string} | undefined;
					if (task && typeof task.projectDir === 'string') {
						applyTaskChanged(queryClient, task.projectDir);
					} else {
						void queryClient.invalidateQueries({queryKey: ['tasks']});
					}
					break;
				}
				case DOMAIN_EVENTS.TASK_COMPLETED: {
					void queryClient.invalidateQueries({queryKey: ['tasks']});
					break;
				}
				default:
					break;
			}
		}

		for (const eventType of LIFECYCLE_EVENT_TYPES) {
			es.addEventListener(eventType, handleLifecycleEvent);
		}
		for (const eventType of DOMAIN_EVENT_TYPES) {
			es.addEventListener(eventType, handleDomainEvent);
		}

		// SSE reconnection safety: with staleTime: Infinity, data is never
		// "stale" so refetchOnReconnect won't refetch after a disconnect.
		// Track errors and invalidate all queries on reconnect to catch up
		// on events missed during the gap.
		let hadError = false;
		es.onerror = () => {
			hadError = true;
		};
		es.addEventListener('open', () => {
			if (hadError) {
				hadError = false;
				void queryClient.invalidateQueries();
			}
		});

		return () => es.close();
	}, [queryClient]);

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
