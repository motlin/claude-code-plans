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
	const {data: skills = []} = useQuery(customizeSkillsQueryOptions);
	const {data: commands = []} = useQuery(userCommandsQueryOptions);
	const {data: servers = []} = useQuery(customizeMcpServersQueryOptions);
	const {data: claudeAi = []} = useQuery(customizeClaudeAiConnectorsQueryOptions);
	const {data: plugins = []} = useQuery(pluginsQueryOptions);
	const catalog = useQuery(customizeDiscoverQueryOptions);
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
			catalogPending={catalog.isPending}
			catalogError={catalog.isError}
			retrying={catalog.isError && catalog.isFetching}
			onRetry={() => void catalog.refetch()}
			onOpen={onOpen}
			{...(expanded === undefined ? {} : {expanded})}
			{...(onExpandedChange === undefined ? {} : {onExpandedChange})}
		/>
	);
}
