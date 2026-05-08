import {z} from 'zod';
import {queryOptions} from '@tanstack/react-query';
import {apiFetch} from './client';

const SettingsFileSchema = z.object({
	filename: z.string(),
	path: z.string(),
	exists: z.boolean(),
	content: z.string(),
});
export type SettingsFile = z.infer<typeof SettingsFileSchema>;
export const SettingsResponse = z.array(SettingsFileSchema);

export const settingsQueryOptions = queryOptions({
	queryKey: ['settings'] as const,
	queryFn: () => apiFetch('/api/settings', SettingsResponse),
	staleTime: Infinity,
	gcTime: Infinity,
});
