import {z} from 'zod';
import {queryOptions} from '@tanstack/react-query';
import {apiFetch} from './client';

const ProjectListItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	projectPath: z.string().nullable(),
	sessionCount: z.number(),
	memoryCount: z.number(),
	planCount: z.number(),
	taskCount: z.number(),
	activeCount: z.number(),
	lastActivity: z.string(),
});
export const ProjectListResponse = z.array(ProjectListItemSchema);

export const projectsQueryOptions = () =>
	queryOptions({
		queryKey: ['projects'] as const,
		queryFn: () => apiFetch('/api/projects', ProjectListResponse),
		staleTime: Infinity,
		gcTime: Infinity,
	});
