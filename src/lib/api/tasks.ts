import {z} from 'zod';
import {queryOptions} from '@tanstack/react-query';
import {apiFetch} from './client';

const TaskItemSchema = z.object({
	taskId: z.string(),
	projectDir: z.string(),
	subject: z.string(),
	description: z.string(),
	status: z.string(),
	activeForm: z.string().nullable(),
	blocks: z.array(z.string()),
	blockedBy: z.array(z.string()),
});
export type TaskItem = z.infer<typeof TaskItemSchema>;

const TaskGroupSchema = z.object({
	projectDir: z.string(),
	tasks: z.array(TaskItemSchema),
	totalPending: z.number(),
	totalInProgress: z.number(),
});
export type TaskGroup = z.infer<typeof TaskGroupSchema>;

export const TaskListResponse = z.array(TaskGroupSchema);

export const tasksQueryOptions = queryOptions({
	queryKey: ['tasks'] as const,
	queryFn: () => apiFetch('/api/tasks', TaskListResponse),
	staleTime: Infinity,
	gcTime: Infinity,
});
