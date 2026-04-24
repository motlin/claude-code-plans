import {queryOptions} from '@tanstack/react-query';
import {getMemories} from '../lib/server-fns';

export const memoriesQueryOptions = queryOptions({
	queryKey: ['memories'] as const,
	queryFn: () => getMemories(),
	staleTime: Infinity,
	gcTime: Infinity,
});
