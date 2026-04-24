import {queryOptions} from '@tanstack/react-query';
import {getSessions} from '../lib/server-fns';

export const sessionsQueryOptions = queryOptions({
	queryKey: ['sessions'] as const,
	queryFn: () => getSessions(),
	staleTime: Infinity,
	gcTime: Infinity,
});
