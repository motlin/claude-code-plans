import {queryOptions} from '@tanstack/react-query';
import {getSettings} from '../lib/server-fns';

const SETTINGS_STALE_TIME_MS = 30_000;

export const settingsQueryOptions = queryOptions({
	queryKey: ['settings'] as const,
	queryFn: () => getSettings(),
	staleTime: SETTINGS_STALE_TIME_MS,
});
