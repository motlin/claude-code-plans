import {queryOptions} from '@tanstack/react-query';
import {
	getSessions,
	getSubagents,
	getSessionSummary,
	isStarred,
	searchSessions,
	searchMessageContent,
} from '../lib/server-fns';

const SESSIONS_STALE_TIME_MS = 30_000;
const SEARCH_STALE_TIME_MS = 10_000;

export const sessionsQueryOptions = queryOptions({
	queryKey: ['sessions'] as const,
	queryFn: () => getSessions(),
	staleTime: SESSIONS_STALE_TIME_MS,
});

export const sessionSubagentsQueryOptions = (sessionId: string) =>
	queryOptions({
		queryKey: ['session', sessionId, 'subagents'] as const,
		queryFn: () => getSubagents({data: sessionId}),
		staleTime: SESSIONS_STALE_TIME_MS,
	});

export const sessionSummaryQueryOptions = (sessionId: string) =>
	queryOptions({
		queryKey: ['session', sessionId, 'summary'] as const,
		queryFn: () => getSessionSummary({data: sessionId}),
		staleTime: SESSIONS_STALE_TIME_MS,
	});

export const sessionStarredQueryOptions = (sessionId: string) =>
	queryOptions({
		queryKey: ['session', sessionId, 'starred'] as const,
		queryFn: () => isStarred({data: sessionId}),
		staleTime: SESSIONS_STALE_TIME_MS,
	});

export const sessionSearchQueryOptions = (query: string) =>
	queryOptions({
		queryKey: ['sessions', 'search', query] as const,
		queryFn: () => searchSessions({data: query}),
		staleTime: SEARCH_STALE_TIME_MS,
	});

export const messageContentSearchQueryOptions = (query: string) =>
	queryOptions({
		queryKey: ['sessions', 'search-messages', query] as const,
		queryFn: () => searchMessageContent({data: query}),
		staleTime: SEARCH_STALE_TIME_MS,
	});
