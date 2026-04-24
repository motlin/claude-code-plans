import {queryOptions} from '@tanstack/react-query';
import {getPlans, getPlansGrouped} from '../lib/server-fns';

export const plansQueryOptions = queryOptions({
	queryKey: ['plans'] as const,
	queryFn: () => getPlans(),
	staleTime: Infinity,
	gcTime: Infinity,
});

export const plansGroupedQueryOptions = queryOptions({
	queryKey: ['plans', 'grouped'] as const,
	queryFn: () => getPlansGrouped(),
	staleTime: Infinity,
	gcTime: Infinity,
});
