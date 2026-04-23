import {queryOptions} from '@tanstack/react-query';
import {getSessions} from '../lib/server-fns';

const SESSIONS_STALE_TIME_MS = 30_000;

export const sessionsQueryOptions = queryOptions({
	queryKey: ['sessions'] as const,
	queryFn: () => getSessions(),
	staleTime: SESSIONS_STALE_TIME_MS,
});
