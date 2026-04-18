import {queryOptions} from '@tanstack/react-query';
import {getProjectTasks, getTasks} from '../lib/server-fns';

const TASKS_STALE_TIME_MS = 30_000;

export const tasksQueryOptions = queryOptions({
	queryKey: ['tasks'] as const,
	queryFn: () => getTasks(),
	staleTime: TASKS_STALE_TIME_MS,
});

export const projectTasksQueryOptions = (projectDir: string) =>
	queryOptions({
		queryKey: ['tasks', 'project', projectDir] as const,
		queryFn: () => getProjectTasks({data: projectDir}),
		staleTime: TASKS_STALE_TIME_MS,
	});
