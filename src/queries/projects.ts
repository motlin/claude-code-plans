import {queryOptions} from '@tanstack/react-query';
import {getProject, getProjects, getProjectBranches} from '../lib/server-fns';

const PROJECTS_STALE_TIME_MS = 30_000;

export const projectsQueryOptions = queryOptions({
	queryKey: ['projects'] as const,
	queryFn: () => getProjects(),
	staleTime: PROJECTS_STALE_TIME_MS,
});

export const projectQueryOptions = (id: string) =>
	queryOptions({
		queryKey: ['project', id] as const,
		queryFn: () => getProject({data: id}),
		staleTime: PROJECTS_STALE_TIME_MS,
	});

export const projectBranchesQueryOptions = (projectId: string) =>
	queryOptions({
		queryKey: ['project-branches', projectId] as const,
		queryFn: () => getProjectBranches({data: projectId}),
		staleTime: PROJECTS_STALE_TIME_MS,
	});
