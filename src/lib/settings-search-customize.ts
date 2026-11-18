import type {CustomizeTarget} from "../components/customize/customize-navigation";
import {commandDetailId, commandRows} from "../components/customize/skills-view";
import type {ClaudeAiConnectorSummary, McpServerSummary, SkillSummary} from "./api/customize";
import type {PluginInfoData, UserCommandGroupData} from "./api/plugins";
import {toConnectorSlug} from "./customize/mcp-tool-permissions";
import type {CustomizeIndexEntry, CustomizeSearchIndex} from "./settings-search";

/** The Customize data the Settings dialog loads, as the search index's sources. */
export interface CustomizeSearchSources
{
	skills: readonly SkillSummary[];
	commands: readonly UserCommandGroupData[];
	servers: readonly McpServerSummary[];
	claudeAi: readonly ClaudeAiConnectorSummary[];
	plugins: readonly PluginInfoData[];
}

function skillTarget(id: string): CustomizeTarget
{
	return {
		kind: "skill",
		id,
		tab: "overview",
	};
}

/** Upstream's plugin-skill label ("fix · build") and the text it ranks against ("fix build"). */
function pluginSkillText(
	skill: string,
	plugin: string,
):
{
	title: string;
	searchText: string;
}
{
	return {
		title: `${skill} · ${plugin}`,
		searchText: `${skill} ${plugin}`,
	};
}

/**
 * Upstream's Customize rows in the Settings search (`xn`), from the local data: Skills lists every skill
 * (plugin skills as "skill · plugin") and custom command, Connectors every MCP server and claude.ai connector,
 * and Plugins every plugin then every plugin skill, which collapse by skill name.
 */
export function buildCustomizeIndex(sources: CustomizeSearchSources): CustomizeSearchIndex
{
	const skills = sources.skills.map((skill): CustomizeIndexEntry => (
	{
		rowSlug: `skill:${skill.id}`,
		...(skill.source === "plugin"
			? pluginSkillText(skill.name, skill.sourceLabel)
			:
				{
					title: skill.name,
				}),
		target: skillTarget(skill.id),
	}));
	const commands = commandRows(sources.commands, "all", undefined).map((row): CustomizeIndexEntry => (
	{
		rowSlug: commandDetailId(row.source, row.filename),
		title: row.invocation,
		target:
		{
			kind: "command",
			source: row.source,
			filename: row.filename,
		},
	}));
	const servers = sources.servers.map((server): CustomizeIndexEntry =>
	{
		const slug = toConnectorSlug(server.id);
		return {
			rowSlug: `connector:${slug}`,
			title: server.name,
			target:
			{
				kind: "connector",
				slug,
			},
		};
	});
	// claude.ai connectors have no local detail; choosing one opens the Connectors list.
	const claudeAi = sources.claudeAi.map((connector): CustomizeIndexEntry => (
	{
		rowSlug: "list:connectors",
		title: connector.name,
		target:
		{
			kind: "list",
			section: "connectors",
		},
	}));
	const plugins = sources.plugins.map((plugin): CustomizeIndexEntry => (
	{
		rowSlug: `plugin:${plugin.id}`,
		title: plugin.name,
		target:
		{
			kind: "plugin",
			id: plugin.id,
			tab: "overview",
		},
	}));
	const pluginSkills = sources.plugins.flatMap((plugin) =>
		plugin.skills.map((skill): CustomizeIndexEntry =>
		{
			// The same id the skills inventory gives this plugin skill, so Skills and Plugins rows compare equal.
			const id = `plugin:${plugin.id}:${skill.name}`;
			return {
				rowSlug: `skill:${id}`,
				...pluginSkillText(skill.name, plugin.name),
				target: skillTarget(id),
				collapseKey: `plugin-skill\0${skill.name.toLowerCase()}`,
			};
		}),
	);
	return {
		"customize-skills": [...skills, ...commands],
		"customize-connectors": [...servers, ...claudeAi],
		"customize-plugins": [...plugins, ...pluginSkills],
	};
}
