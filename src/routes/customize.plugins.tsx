import {useQuery} from "@tanstack/react-query";
import {createFileRoute, useNavigate, useSearch} from "@tanstack/react-router";
import {Puzzle} from "lucide-react";
import {CustomizeDiscover} from "../components/customize/customize-discover";
import {CustomizeNotice} from "../components/customize/customize-empty";
import {CustomizeList} from "../components/customize/customize-list";
import {PluginRowActions} from "../components/customize/plugin-row-actions";
import {PluginVersion} from "../components/plugin-version";
import {CUSTOMIZE_SECTIONS, matchesQuery, resolveOption} from "../components/customize/sections";
import {
	customizeDiscoverQueryOptions,
	customizeSettingsTogglesQueryOptions,
	isPluginEnabled,
} from "../lib/api/customize";
import {groupPluginsByMarketplace, pluginsQueryOptions} from "../lib/api/plugins";

export const Route = createFileRoute("/customize/plugins")({
	component: CustomizePlugins,
	loader: ({context: {queryClient}}) => {
		void queryClient.prefetchQuery(pluginsQueryOptions);
		void queryClient.prefetchQuery(customizeDiscoverQueryOptions);
	},
	head: () => ({meta: [{title: "Plugins · Customize"}]}),
});

const SECTION = CUSTOMIZE_SECTIONS[2]!;

function CustomizePlugins() {
	const search = useSearch({from: "/customize"});
	const navigate = useNavigate();
	const {data: plugins, isPending} = useQuery(pluginsQueryOptions);
	const {data: toggles} = useQuery(customizeSettingsTogglesQueryOptions);

	if (search.view === "discover") {
		return (
			<CustomizeDiscover
				section="plugins"
				q={search.q}
				yours={(plugins ?? []).map((plugin) => ({
					key: plugin.id,
					title: plugin.name,
					source: `from ${plugin.marketplace}`,
					subtitle: plugin.description,
					onView: () =>
						void navigate({
							to: "/customize/plugins/id/$pluginId",
							params: {pluginId: plugin.id},
						}),
				}))}
			/>
		);
	}
	if (isPending || plugins === undefined) {
		return <p className="text-body text-t6">Loading plugins…</p>;
	}

	const searching = (search.q ?? "") !== "";
	const show = searching ? "all" : resolveOption(SECTION.filter.options, search.filter).value;
	const sort = resolveOption(SECTION.sort ?? [], search.sort).value;
	const marketplaces = groupPluginsByMarketplace(
		plugins.filter((plugin) => matchesQuery(search.q, plugin.name, plugin.description)),
	).filter((group) => show === "all" || group.isOfficial === (show === "official"));
	const byName = (a: {title: string}, b: {title: string}) => a.title.localeCompare(b.title);
	const marketplaceGroups = marketplaces.map((group) => ({
		key: group.marketplace.id,
		title: group.marketplace.displayName,
		items: group.plugins
			.map((plugin) => ({
				key: plugin.id,
				title: plugin.name,
				source: `from ${group.marketplace.displayName}`,
				subtitle: plugin.description,
				meta: (
					<>
						<PluginVersion version={plugin.version} versionKind={plugin.versionKind} />
						{toggles !== undefined && !isPluginEnabled(toggles, plugin.id) && " · Disabled"}
					</>
				),
				actions: <PluginRowActions pluginId={plugin.id} name={plugin.name} installPath={plugin.installPath} />,
				onView: () =>
					void navigate({
						to: "/customize/plugins/id/$pluginId",
						params: {pluginId: plugin.id},
					}),
			}))
			.sort(byName),
	}));
	const groups =
		sort === "name"
			? [
					{
						key: "all",
						title: "All plugins",
						items: marketplaceGroups.flatMap((group) => group.items).sort(byName),
					},
				]
			: marketplaceGroups;

	return (
		<CustomizeList
			icon={Puzzle}
			noun={SECTION.noun}
			searching={searching}
			groups={groups}
			empty={
				<CustomizeNotice
					title="No plugins yet"
					body="Plugins installed with `claude plugin install` appear here."
				/>
			}
		/>
	);
}
