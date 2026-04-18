import {queryOptions} from '@tanstack/react-query';
import {getMemories} from '../lib/server-fns';

const MEMORIES_STALE_TIME_MS = 30_000;

export const memoriesQueryOptions = queryOptions({
	queryKey: ['memories'] as const,
	queryFn: () => getMemories(),
	staleTime: MEMORIES_STALE_TIME_MS,
});
