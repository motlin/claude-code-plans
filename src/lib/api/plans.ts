import {z} from 'zod';
import {queryOptions} from '@tanstack/react-query';
import {apiFetch} from './client';

const PlanLinkSchema = z.object({
	sessionId: z.string(),
	project: z.string(),
	projectName: z.string(),
	sessionTitle: z.string().nullable(),
});
export const PlanLinksResponse = z.array(PlanLinkSchema);

export const PlanDetailResponse = z.object({
	markdown: z.string(),
	sha: z.string(),
	systemFrom: z.string(),
	title: z.string(),
});

const PlanProjectRefSchema = z.object({
	projectId: z.string(),
	projectName: z.string(),
});
const PlanListItemSchema = z.object({
	filename: z.string(),
	title: z.string(),
	sha: z.string(),
	systemFrom: z.string(),
	projects: z.array(PlanProjectRefSchema),
});
export const PlanListResponse = z.array(PlanListItemSchema);
export type PlanListItem = z.infer<typeof PlanListItemSchema>;

export const plansQueryOptions = () =>
	queryOptions({
		queryKey: ['plans'] as const,
		queryFn: () => apiFetch('/api/plans', PlanListResponse),
		staleTime: Infinity,
		gcTime: Infinity,
	});

export const planQueryOptions = (filename: string) =>
	queryOptions({
		queryKey: ['plans', filename] as const,
		queryFn: () => apiFetch(`/api/plans/${encodeURIComponent(filename)}`, PlanDetailResponse),
		staleTime: Infinity,
		gcTime: Infinity,
	});

export const planLinksQueryOptions = (filename: string) =>
	queryOptions({
		queryKey: ['plans', filename, 'links'] as const,
		queryFn: () => apiFetch(`/api/plans/${encodeURIComponent(filename)}/links`, PlanLinksResponse),
		staleTime: Infinity,
		gcTime: Infinity,
	});
