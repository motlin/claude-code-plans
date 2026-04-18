import {queryOptions} from '@tanstack/react-query';
import {getStarredSessionList} from '../lib/server-fns';

const STARRED_STALE_TIME_MS = 30_000;

export const starredSessionsQueryOptions = queryOptions({
	queryKey: ['starred-sessions'] as const,
	queryFn: () => getStarredSessionList(),
	staleTime: STARRED_STALE_TIME_MS,
});
