import {queryOptions} from '@tanstack/react-query';
import {getPlanLinks, getPlans, getPlansGrouped} from '../lib/server-fns';

const PLANS_STALE_TIME_MS = 30_000;

export const plansQueryOptions = queryOptions({
	queryKey: ['plans'] as const,
	queryFn: () => getPlans(),
	staleTime: PLANS_STALE_TIME_MS,
});

export const plansGroupedQueryOptions = queryOptions({
	queryKey: ['plans', 'grouped'] as const,
	queryFn: () => getPlansGrouped(),
	staleTime: PLANS_STALE_TIME_MS,
});

export const planLinksQueryOptions = (filename: string) =>
	queryOptions({
		queryKey: ['plan', filename, 'links'] as const,
		queryFn: () => getPlanLinks({data: filename}),
		staleTime: PLANS_STALE_TIME_MS,
	});
