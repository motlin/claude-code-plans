import {queryOptions} from '@tanstack/react-query';
import {getActiveSessions} from '../lib/server-fns';

// Active sessions are more volatile than stable collections; keep the staleTime
// short so polling / revalidation reflects the green-dot indicator quickly.
const ACTIVE_STALE_TIME_MS = 5_000;

export const activeSessionsQueryOptions = queryOptions({
	queryKey: ['active-sessions'] as const,
	queryFn: () => getActiveSessions(),
	staleTime: ACTIVE_STALE_TIME_MS,
});
