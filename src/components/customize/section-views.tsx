import {useQuery} from "@tanstack/react-query";
import {Puzzle, Scroll} from "lucide-react";
import {
	customizeClaudeAiConnectorsQueryOptions,
	customizeMcpServersQueryOptions,
	customizeSettingsTogglesQueryOptions,
	customizeSkillsQueryOptions,
	isPluginEnabled,
} from "../../lib/api/customize";
import {groupPluginsByMarketplace, pluginsQueryOptions, userCommandsQueryOptions} from "../../lib/api/plugins";
import {toConnectorSlug} from "../../lib/customize/mcp-tool-permissions";
import {PluginVersion} from "../plugin-version";
import {ConnectorsTable, ScopeBadge} from "./connectors-table";
import {CustomizeDiscover} from "./customize-discover";
import {CustomizeNotice, NoSearchMatches} from "./customize-empty";
import {CustomizeList, ShortDate} from "./customize-list";
import {useCustomizeGo} from "./customize-nav";
import {useSectionSort} from "./persisted-sort";
import {PluginRowActions} from "./plugin-row-actions";
import {CUSTOMIZE_SECTIONS, type CustomizeSearch, matchesQuery, resolveOption} from "./sections";
import {SkillRowActions} from "./skill-row-actions";
import {commandRows, filterSkills, groupSkills, sortSkills} from "./skills-view";

interface SectionProps {
	search: CustomizeSearch;
}

const SKILLS_SECTION = CUSTOMIZE_SECTIONS[0]!;

/** The Skills list body under the Customize header (Yours, or Discover when it has one). */
export function SkillsSection({search}: SectionProps) {
	const go = useCustomizeGo();
	const sortValue = useSectionSort(SKILLS_SECTION.sortStorageKey, search.sort);
	const {data: skills, isPending} = useQuery(customizeSkillsQueryOptions);
	const {data: commands} = useQuery(userCommandsQueryOptions);

	if (search.view === "discover") {
		return (
			<CustomizeDiscover
				section="skills"
				q={search.q}
				category={search.category}
				order={search.order}
				yours={(skills ?? []).map((skill) => ({
					key: skill.id,
					title: skill.name,
					source: `from ${skill.sourceLabel}`,
					subtitle: skill.description,
					onView: () => go({kind: "skill", id: skill.id, tab: "overview"}),
				}))}
			/>
		);
	}
	if (isPending || skills === undefined) return <p className="text-body text-t6">Loading skills…</p>;

	const searching = (search.q ?? "") !== "";
	const source = searching ? "all" : resolveOption(SKILLS_SECTION.filter.options, search.filter).value;
	const sort = resolveOption(SKILLS_SECTION.sort ?? [], sortValue).value;
	const groups = groupSkills(sortSkills(filterSkills(skills, source, search.q), sort));
	const commandGroup = {
		key: "commands",
		title: "Custom commands",
		items: commandRows(commands ?? [], source, search.q).map((row) => ({
			key: row.key,
			title: row.invocation,
			source: `from ${row.sourceName}`,
			subtitle: row.description,
			meta: <ScopeBadge>Custom command</ScopeBadge>,
		})),
	};
	const showOnboarding =
		!searching &&
		(source === "all" || source === "personal") &&
		!skills.some((skill) => skill.source === "personal");

	return (
		<div className="flex flex-col gap-6">
			{showOnboarding && (
				<div data-testid="customize-skills-onboarding">
					<CustomizeNotice title="Add your first skills" body="Personal skills live in ~/.claude/skills." />
				</div>
			)}
			<CustomizeList
				icon={Scroll}
				noun={SKILLS_SECTION.noun}
				searching={searching}
				groups={[
					...groups.map((group) => ({
						key: group.key,
						title: group.title,
						items: group.skills.map((skill) => ({
							key: skill.id,
							title: skill.name,
							source: `from ${skill.sourceLabel}`,
							subtitle: skill.description,
							meta: <ShortDate ms={skill.mtime} />,
							actions: <SkillRowActions skill={skill} />,
							onView: () => go({kind: "skill", id: skill.id, tab: "overview"}),
						})),
					})),
					commandGroup,
				]}
				empty={
					showOnboarding ? null : (
						<CustomizeNotice
							title="No skills yet"
							body="Personal skills live in ~/.claude/skills; project skills live in <project>/.claude/skills."
						/>
					)
				}
			/>
		</div>
	);
}

const CONNECTORS_SECTION = CUSTOMIZE_SECTIONS[1]!;

/** The Connectors list body under the Customize header (Yours, or Discover when it has one). */
export function ConnectorsSection({search}: SectionProps) {
	const go = useCustomizeGo();
	const {data: servers, isPending} = useQuery(customizeMcpServersQueryOptions);
	const {data: claudeAi = []} = useQuery(customizeClaudeAiConnectorsQueryOptions);

	if (isPending || servers === undefined) {
		return <p className="text-body text-t6">Loading connectors…</p>;
	}

	const searching = (search.q ?? "") !== "";
	const show = searching ? "all" : resolveOption(CONNECTORS_SECTION.filter.options, search.filter).value;
	const visibleServers = servers
		.filter((server) => show === "all" || server.enabled === (show === "enabled"))
		.filter((server) => matchesQuery(search.q, server.name, server.urlOrCommand));
	// claude.ai connectors have no local enabled state, so only "All" lists them.
	const visibleClaudeAi =
		show === "all" ? claudeAi.filter((connector) => matchesQuery(search.q, connector.name)) : [];

	if (visibleServers.length === 0 && visibleClaudeAi.length === 0) {
		return searching ? (
			<NoSearchMatches noun={CONNECTORS_SECTION.noun} />
		) : (
			<CustomizeNotice
				title="No connectors yet"
				body="MCP servers from ~/.claude.json, project .mcp.json files and plugins appear here."
			/>
		);
	}

	return (
		<ConnectorsTable
			servers={visibleServers}
			claudeAi={visibleClaudeAi}
			onView={(server) => go({kind: "connector", slug: toConnectorSlug(server.id)})}
		/>
	);
}

const PLUGINS_SECTION = CUSTOMIZE_SECTIONS[2]!;

/** The Plugins list body under the Customize header (Yours, or Discover when it has one). */
export function PluginsSection({search}: SectionProps) {
	const go = useCustomizeGo();
	const {data: plugins, isPending} = useQuery(pluginsQueryOptions);
	const {data: toggles} = useQuery(customizeSettingsTogglesQueryOptions);

	if (search.view === "discover") {
		return (
			<CustomizeDiscover
				section="plugins"
				q={search.q}
				category={search.category}
				order={search.order}
				yours={(plugins ?? []).map((plugin) => ({
					key: plugin.id,
					title: plugin.name,
					source: `from ${plugin.marketplace}`,
					subtitle: plugin.description,
					onView: () => go({kind: "plugin", id: plugin.id, tab: "overview"}),
				}))}
			/>
		);
	}
	if (isPending || plugins === undefined) {
		return <p className="text-body text-t6">Loading plugins…</p>;
	}

	const searching = (search.q ?? "") !== "";
	const show = searching ? "all" : resolveOption(PLUGINS_SECTION.filter.options, search.filter).value;
	const sort = resolveOption(PLUGINS_SECTION.sort ?? [], search.sort).value;
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
				onView: () => go({kind: "plugin", id: plugin.id, tab: "overview"}),
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
			noun={PLUGINS_SECTION.noun}
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
