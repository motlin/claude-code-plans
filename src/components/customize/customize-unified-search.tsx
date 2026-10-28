import {useQuery} from "@tanstack/react-query";
import {useMemo} from "react";
import {
	customizeClaudeAiConnectorsQueryOptions,
	customizeDiscoverQueryOptions,
	customizeMcpServersQueryOptions,
	customizeSkillsQueryOptions,
} from "../../lib/api/customize";
import {pluginsQueryOptions, userCommandsQueryOptions} from "../../lib/api/plugins";
import {buildUnifiedSearch, type UnifiedHit} from "./unified-search";
import {UnifiedSearchResults, type UnifiedSearchSurface, type UnifiedSectionId} from "./unified-search-results";

interface CustomizeUnifiedSearchProps {
	q: string;
	surface: UnifiedSearchSurface;
	onOpen: (hit: UnifiedHit) => void;
	/** Controlled Show all state; without it each section keeps its own. */
	expanded?: readonly UnifiedSectionId[];
	onExpandedChange?: (sections: UnifiedSectionId[]) => void;
}

/** Upstream's unified results, fed from every Customize source plus the plugin catalog. */
export function CustomizeUnifiedSearch({q, surface, onOpen, expanded, onExpandedChange}: CustomizeUnifiedSearchProps) {
	const skillsQuery = useQuery(customizeSkillsQueryOptions);
	const commandsQuery = useQuery(userCommandsQueryOptions);
	const serversQuery = useQuery(customizeMcpServersQueryOptions);
	const claudeAiQuery = useQuery(customizeClaudeAiConnectorsQueryOptions);
	const pluginsQuery = useQuery(pluginsQueryOptions);
	const catalog = useQuery(customizeDiscoverQueryOptions);
	const {data: skills = []} = skillsQuery;
	const {data: commands = []} = commandsQuery;
	const {data: servers = []} = serversQuery;
	const {data: claudeAi = []} = claudeAiQuery;
	const {data: plugins = []} = pluginsQuery;
	// An unloaded source would read as empty, so hold the count until every source settles.
	const pending = [skillsQuery, commandsQuery, serversQuery, claudeAiQuery, pluginsQuery, catalog].some(
		(query) => query.isPending,
	);
	const search = useMemo(
		() =>
			buildUnifiedSearch({skills, commands, servers, claudeAi, plugins, catalog: catalog.data?.plugins ?? []}, q),
		[skills, commands, servers, claudeAi, plugins, catalog.data, q],
	);
	return (
		<UnifiedSearchResults
			q={q}
			surface={surface}
			search={search}
			pending={pending}
			catalogError={catalog.isError}
			retrying={catalog.isError && catalog.isFetching}
			onRetry={() => void catalog.refetch()}
			onOpen={onOpen}
			{...(expanded === undefined ? {} : {expanded})}
			{...(onExpandedChange === undefined ? {} : {onExpandedChange})}
		/>
	);
}
