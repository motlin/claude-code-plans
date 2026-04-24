import {queryOptions} from '@tanstack/react-query';
import {getActiveSessions} from '../lib/server-fns';

export const activeSessionsQueryOptions = (activeTimeoutMs?: number) =>
	queryOptions({
		queryKey: ['active-sessions', activeTimeoutMs] as const,
		queryFn: () => getActiveSessions({data: activeTimeoutMs !== undefined ? {activeTimeoutMs} : undefined}),
		staleTime: Infinity,
		gcTime: Infinity,
	});
