import {queryOptions} from '@tanstack/react-query';
import {
	getPluginFileRendered,
	getPluginGroups,
	getPluginsList,
	getUserCommandRendered,
	getUserCommandsList,
} from '../lib/server-fns';

const PLUGINS_STALE_TIME_MS = 30_000;

export const pluginsQueryOptions = queryOptions({
	queryKey: ['plugins'] as const,
	queryFn: () => getPluginsList(),
	staleTime: PLUGINS_STALE_TIME_MS,
});

export const pluginGroupsQueryOptions = queryOptions({
	queryKey: ['plugin-groups'] as const,
	queryFn: () => getPluginGroups(),
	staleTime: PLUGINS_STALE_TIME_MS,
});

export const userCommandsQueryOptions = queryOptions({
	queryKey: ['user-commands'] as const,
	queryFn: () => getUserCommandsList(),
	staleTime: PLUGINS_STALE_TIME_MS,
});

export const pluginFileRenderedQueryOptions = (pluginId: string, pathSegments: ReadonlyArray<string>) =>
	queryOptions({
		queryKey: ['plugin', pluginId, 'file', ...pathSegments] as const,
		queryFn: () => getPluginFileRendered({data: {pluginId, pathSegments: [...pathSegments]}}),
		staleTime: PLUGINS_STALE_TIME_MS,
	});

export const userCommandRenderedQueryOptions = (source: string, filename: string) =>
	queryOptions({
		queryKey: ['user-command', source, filename] as const,
		queryFn: () => getUserCommandRendered({data: {source, filename}}),
		staleTime: PLUGINS_STALE_TIME_MS,
	});
