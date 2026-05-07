import {z} from 'zod';
import {queryOptions} from '@tanstack/react-query';
import {apiFetch} from './client';

const SessionListItemSchema = z.object({
	id: z.string(),
	title: z.string(),
	summary: z.string().optional(),
	mtime: z.string(),
	created: z.string(),
	project: z.string(),
	projectName: z.string(),
	messageCount: z.number(),
	gitBranch: z.string().optional(),
	starred: z.boolean(),
});
export type SessionListItem = z.infer<typeof SessionListItemSchema>;

const SessionProjectGroupSchema = z.object({
	project: z.string(),
	projectName: z.string(),
	sessions: z.array(SessionListItemSchema),
});
export const SessionListResponse = z.array(SessionProjectGroupSchema);

const ActiveSessionSchema = z.object({
	sessionId: z.string(),
	projectDir: z.string(),
	projectName: z.string(),
	lastModified: z.number(),
});
export const ActiveSessionListResponse = z.array(ActiveSessionSchema);

export const sessionsQueryOptions = () =>
	queryOptions({
		queryKey: ['sessions'] as const,
		queryFn: () => apiFetch('/api/sessions', SessionListResponse),
		staleTime: Infinity,
		gcTime: Infinity,
	});

export const activeSessionsQueryOptions = (activeTimeoutMs?: number) => {
	const url =
		activeTimeoutMs !== undefined
			? `/api/sessions/active?activeTimeoutMs=${activeTimeoutMs}`
			: '/api/sessions/active';
	return queryOptions({
		queryKey: ['sessions', 'active', activeTimeoutMs] as const,
		queryFn: () => apiFetch(url, ActiveSessionListResponse),
		staleTime: Infinity,
		gcTime: Infinity,
	});
};
