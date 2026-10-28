import {useQuery} from "@tanstack/react-query";
import {useCallback, useMemo, useState} from "react";
import {
	customizeClaudeAiConnectorsQueryOptions,
	customizeDiscoverQueryOptions,
	customizeMcpServersQueryOptions,
	customizePluginFileQueryOptions,
	customizeSkillFileQueryOptions,
	customizeSkillsQueryOptions,
} from "../../lib/api/customize";
import {pluginsQueryOptions, userCommandsQueryOptions} from "../../lib/api/plugins";
import {type CustomizeLocation, type CustomizeSection, customizeHash} from "../../lib/settings-hash";
import {ContentsViewer} from "./contents-viewer";
import {CustomizeHeader} from "./customize-header";
import {CustomizeNavContext, type CustomizeNavigator, type CustomizeTarget} from "./customize-navigation";
import {ConnectorDetailFrame, PluginDetailFrame, SkillDetailFrame} from "./detail-frames";
import {PluginConnectors, PluginFiles, PluginHooks, PluginOverview, PluginSkills} from "./plugin-detail";
import {ConnectorsSection, PluginsSection, SkillsSection} from "./section-views";
import {CUSTOMIZE_SECTIONS, type CustomizeSearch, dropEmpty} from "./sections";
import {SkillOverview} from "./skill-detail";
import {buildUnifiedSearch, type UnifiedHit} from "./unified-search";
import {UnifiedSearchResults} from "./unified-search-results";
import {assertNever} from "../../lib/assert-never";

/** The hash (without `#`) a Customize target opens inside the Settings dialog. */
function targetHash(target: CustomizeTarget, withFile = true): string {
	switch (target.kind) {
		case "list":
			return customizeHash({
				section: target.section,
				view: target.search?.view === "discover" ? "discover" : "yours",
			});
		case "skill":
			return customizeHash({
				section: "skills",
				id: target.id,
				tab: target.tab === "contents" ? "contents" : null,
			});
		case "plugin":
			return customizeHash({
				section: "plugins",
				id: target.id,
				tab: target.tab === "overview" ? null : target.tab,
				file: withFile ? (target.file ?? null) : null,
			});
		case "connector":
			return customizeHash({section: "connectors", id: target.slug});
		default:
			return assertNever(target);
	}
}

interface CustomizeDialogPanelProps {
	location: CustomizeLocation;
	/** Moves the dialog to `hash` (without `#`), replacing the history entry when asked. */
	onNavigate: (hash: string, replace: boolean) => void;
}

/**
 * Skills, Connectors and Plugins inside the Settings dialog, as upstream's
 * `#customize/<section>/yours`. The view and open detail live in the hash;
 * Filter and Sort are kept per section for as long as the panel is open. The
 * query is shared: any non-empty one swaps the section body for upstream's
 * unified results, which are the same in every section and view.
 */
export default function CustomizeDialogPanel({location, onNavigate}: CustomizeDialogPanelProps) {
	const [searches, setSearches] = useState<Partial<Record<CustomizeSection, CustomizeSearch>>>({});
	const [query, setQuery] = useState("");
	const section = CUSTOMIZE_SECTIONS.find((config) => config.id === location.section) ?? CUSTOMIZE_SECTIONS[0];

	const patchSearch = useCallback((id: CustomizeSection, patch: CustomizeSearch) => {
		const {q, ...rest} = patch;
		if ("q" in patch) setQuery(q ?? "");
		setSearches((previous) => ({...previous, [id]: dropEmpty({...previous[id], ...rest, view: undefined})}));
	}, []);

	const current = customizeHash({...location, file: null});
	const navigator = useMemo(
		(): CustomizeNavigator => ({
			href: (target) => `#${targetHash(target)}`,
			isCurrent: (target) => targetHash(target, false) === current,
			go: (target) => {
				if (target.kind === "list" && target.search !== undefined) patchSearch(target.section, target.search);
				onNavigate(targetHash(target), false);
			},
		}),
		[current, onNavigate, patchSearch],
	);

	const search: CustomizeSearch = {
		...searches[section.id],
		...(section.hasDiscover && location.view === "discover" ? {view: "discover" as const} : {}),
	};
	const openHit = useCallback(
		(hit: UnifiedHit) => {
			if (hit.open === null) return;
			if (hit.open.kind === "external") {
				window.open(hit.open.href, "_blank", "noopener,noreferrer");
				return;
			}
			navigator.go(hit.open);
		},
		[navigator],
	);

	return (
		<CustomizeNavContext.Provider value={navigator}>
			{location.id === null ? (
				<div className="flex flex-col gap-6">
					<CustomizeHeader
						embedded
						section={section}
						search={query === "" ? search : {...search, q: query}}
						onSearchChange={(patch) => {
							const {view, ...rest} = patch;
							if (Object.keys(rest).length > 0) patchSearch(section.id, rest);
							if ("view" in patch && view !== search.view) {
								onNavigate(
									customizeHash({
										section: section.id,
										view: view === "discover" ? "discover" : "yours",
									}),
									true,
								);
							}
						}}
					/>
					{query === "" ? (
						<SectionBody location={location} search={search} />
					) : (
						<DialogUnifiedSearch q={query} onOpen={openHit} />
					)}
				</div>
			) : (
				<DetailBody location={location} id={location.id} />
			)}
		</CustomizeNavContext.Provider>
	);
}

/** Upstream's unified results, fed from every Customize source plus the plugin catalog. */
function DialogUnifiedSearch({q, onOpen}: {q: string; onOpen: (hit: UnifiedHit) => void}) {
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
			search={search}
			catalogPending={catalog.isPending}
			catalogError={catalog.isError}
			retrying={catalog.isError && catalog.isFetching}
			onRetry={() => void catalog.refetch()}
			onOpen={onOpen}
		/>
	);
}

function SectionBody({location, search}: {location: CustomizeLocation; search: CustomizeSearch}) {
	switch (location.section) {
		case "skills":
			return <SkillsSection search={search} />;
		case "connectors":
			return <ConnectorsSection search={search} />;
		case "plugins":
			return <PluginsSection search={search} />;
		default:
			return assertNever(location.section);
	}
}

function DetailBody({location, id}: {location: CustomizeLocation; id: string}) {
	switch (location.section) {
		case "skills":
			return (
				<SkillDetailFrame skillId={id}>
					{(detail) =>
						location.tab === "contents" ? (
							<ContentsViewer
								name={detail.skill.name}
								tree={detail.tree}
								fileQuery={(path) => customizeSkillFileQueryOptions(id, path)}
							/>
						) : (
							<SkillOverview detail={detail} />
						)
					}
				</SkillDetailFrame>
			);
		case "connectors":
			return <ConnectorDetailFrame serverId={id} />;
		case "plugins":
			return (
				<PluginDetailFrame pluginId={id}>
					{(detail) => {
						switch (location.tab) {
							case null:
								return <PluginOverview detail={detail} />;
							case "contents":
								return (
									<ContentsViewer
										key={location.file ?? ""}
										name={`${detail.plugin.name} ${detail.plugin.version}`}
										tree={detail.tree}
										initialFile={location.file ?? undefined}
										fileQuery={(path) => customizePluginFileQueryOptions(id, path)}
									/>
								);
							case "skills":
								return <PluginSkills plugin={detail.plugin} />;
							case "connectors":
								return <PluginConnectors detail={detail} />;
							case "agents":
							case "commands":
								return <PluginFiles plugin={detail.plugin} kind={location.tab} />;
							case "hooks":
								return <PluginHooks hooks={detail.hooks} />;
							default:
								return assertNever(location.tab);
						}
					}}
				</PluginDetailFrame>
			);
		default:
			return assertNever(location.section);
	}
}
