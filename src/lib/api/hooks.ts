import {z} from 'zod';
import {queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';
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

export const HookMutationResponse = z.object({ok: z.boolean(), settingsPath: z.string()});

export const useInstallHooks = () => {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({port}: {port?: number} = {}) =>
			apiFetch('/api/hooks', HookMutationResponse, {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify(port !== undefined ? {port} : {}),
			}),
		onSuccess: () => {
			void qc.invalidateQueries({queryKey: ['hooks', 'status']});
			void qc.invalidateQueries({queryKey: ['settings']});
		},
	});
};

export const useUninstallHooks = () => {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({port}: {port?: number} = {}) =>
			apiFetch('/api/hooks', HookMutationResponse, {
				method: 'DELETE',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify(port !== undefined ? {port} : {}),
			}),
		onSuccess: () => {
			void qc.invalidateQueries({queryKey: ['hooks', 'status']});
			void qc.invalidateQueries({queryKey: ['settings']});
		},
	});
};
