import {z} from 'zod';
import {queryOptions, useMutation, useQueryClient} from '@tanstack/react-query';
import {apiFetch} from './client';

const MemoryListItemSchema = z.object({
	filename: z.string(),
	title: z.string(),
	mtime: z.string(),
	project: z.string(),
});
export type MemoryListItem = z.infer<typeof MemoryListItemSchema>;

const ProjectScopeSchema = z.object({
	id: z.string(),
	name: z.string(),
	projectPath: z.string().nullable(),
});

export const MemoryListResponse = z
	.object({
		project: ProjectScopeSchema,
		memories: z.array(MemoryListItemSchema),
	})
	.nullable();
export type MemoryListData = z.infer<typeof MemoryListResponse>;

export const MemoryDetailResponse = z
	.object({
		markdown: z.string(),
		mtime: z.string().nullable(),
		projectName: z.string(),
	})
	.nullable();
export type MemoryDetail = z.infer<typeof MemoryDetailResponse>;

export const projectMemoriesQueryOptions = (id: string) =>
	queryOptions({
		queryKey: ['projects', id, 'memories'] as const,
		queryFn: () => apiFetch(`/api/projects/${encodeURIComponent(id)}/memories`, MemoryListResponse),
		staleTime: Infinity,
		gcTime: Infinity,
	});

export const memoryDetailQueryOptions = (project: string, filename: string) =>
	queryOptions({
		queryKey: ['projects', project, 'memories', filename] as const,
		queryFn: () =>
			apiFetch(
				`/api/projects/${encodeURIComponent(project)}/memories/${encodeURIComponent(filename)}`,
				MemoryDetailResponse,
			),
		staleTime: Infinity,
		gcTime: Infinity,
	});

export const MemorySaveResponse = z.object({ok: z.boolean()});
export const MemoryDeleteResponse = z.object({ok: z.boolean()});

export const useSaveMemory = (project: string, filename: string) => {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (content: string) =>
			apiFetch(
				`/api/projects/${encodeURIComponent(project)}/memories/${encodeURIComponent(filename)}`,
				MemorySaveResponse,
				{
					method: 'PUT',
					headers: {'Content-Type': 'text/plain'},
					body: content,
				},
			),
		onSuccess: () => {
			void qc.invalidateQueries({queryKey: ['projects', project, 'memories']});
			void qc.invalidateQueries({queryKey: ['projects', project, 'memories', filename]});
		},
	});
};

export const useRemoveMemory = (project: string, filename: string) => {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: () =>
			apiFetch(
				`/api/projects/${encodeURIComponent(project)}/memories/${encodeURIComponent(filename)}`,
				MemoryDeleteResponse,
				{method: 'DELETE'},
			),
		onSuccess: () => {
			void qc.invalidateQueries({queryKey: ['projects', project, 'memories']});
		},
	});
};
