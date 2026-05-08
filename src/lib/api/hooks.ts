import {z} from 'zod';
import {queryOptions} from '@tanstack/react-query';
import {apiFetch} from './client';

export const HookStatusResponse = z.object({
	installed: z.boolean(),
	partial: z.boolean(),
	installedCount: z.number().optional(),
	totalCount: z.number().optional(),
	settingsPath: z.string(),
});
export type HookStatus = z.infer<typeof HookStatusResponse>;

export const hookStatusQueryOptions = queryOptions({
	queryKey: ['hooks', 'status'] as const,
	queryFn: () => apiFetch('/api/hooks/status', HookStatusResponse),
	staleTime: Infinity,
	gcTime: Infinity,
});
