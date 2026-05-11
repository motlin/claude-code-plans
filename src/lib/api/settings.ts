import {z} from 'zod';
import {queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';
import {apiFetch} from './client';

const SettingsFileSchema = z.object({
	filename: z.string(),
	path: z.string(),
	exists: z.boolean(),
	content: z.string(),
});
export const SettingsResponse = z.array(SettingsFileSchema);

export const settingsQueryOptions = queryOptions({
	queryKey: ['settings'] as const,
	queryFn: () => apiFetch('/api/settings', SettingsResponse),
	staleTime: Infinity,
	gcTime: Infinity,
});

export const SettingsSaveResponse = z.object({path: z.string()});

export const useSaveSettingsFile = () => {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({filename, content}: {filename: 'settings.json' | 'settings.local.json'; content: string}) =>
			apiFetch(`/api/settings/${encodeURIComponent(filename)}`, SettingsSaveResponse, {
				method: 'PUT',
				headers: {'Content-Type': 'application/json'},
				body: content,
			}),
		onSuccess: () => {
			void qc.invalidateQueries({queryKey: ['settings']});
			void qc.invalidateQueries({queryKey: ['hooks', 'status']});
		},
	});
};
