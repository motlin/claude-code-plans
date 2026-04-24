import {queryOptions} from '@tanstack/react-query';
import {getTasks} from '../lib/server-fns';

export const tasksQueryOptions = queryOptions({
	queryKey: ['tasks'] as const,
	queryFn: () => getTasks(),
	staleTime: Infinity,
	gcTime: Infinity,
});
