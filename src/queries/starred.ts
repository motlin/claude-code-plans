import {queryOptions} from '@tanstack/react-query';
import {getStarredSessionList} from '../lib/server-fns';

export const starredSessionsQueryOptions = queryOptions({
	queryKey: ['starred-sessions'] as const,
	queryFn: () => getStarredSessionList(),
	staleTime: Infinity,
	gcTime: Infinity,
});
