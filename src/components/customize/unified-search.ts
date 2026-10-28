import type {ClaudeAiConnectorSummary, DiscoverPlugin, McpServerSummary, SkillSummary} from "../../lib/api/customize";
import type {PluginInfoData, UserCommandGroupData} from "../../lib/api/plugins";
import {formatMarketplaceName, isOfficialMarketplace} from "../../lib/marketplace-labels";
import {toConnectorSlug} from "../../lib/customize/mcp-tool-permissions";
import {CLAUDE_AI_CONNECTORS_URL, SCOPE_LABEL} from "./connector-labels";
import type {CustomizeTarget} from "./customize-navigation";
import {addableMatches} from "./discover-view";
import {matchesQuery} from "./sections";
import {commandRows} from "./skills-view";

/** Upstream `vl`: unified results need at least two letters or digits. */
const MIN_TERM_CHARS = 2;
/** Upstream caps the query it sends at 200 characters. */
const MAX_TERM_CODE_POINTS = 200;

export function searchTermReady(q: string): boolean {
	return (q.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= MIN_TERM_CHARS;
}

export type UnifiedHitKind = "Skill" | "Custom command" | "Connector" | "Plugin";

/** Where a hit leads: a Customize detail, claude.ai, or nowhere (commands and addable plugins). */
export type UnifiedHitOpen = CustomizeTarget | {kind: "external"; href: string} | null;

export interface UnifiedHit {
	key: string;
	kind: UnifiedHitKind;
	name: string;
	byline: string;
	description: string;
	verified: boolean;
	/** The first case-insensitive range of the term in `name`; null when another field matched. */
	match: readonly [number, number] | null;
	open: UnifiedHitOpen;
}

export interface UnifiedSearchSources {
	skills: readonly SkillSummary[];
	commands: readonly UserCommandGroupData[];
	servers: readonly McpServerSummary[];
	claudeAi: readonly ClaudeAiConnectorSummary[];
	plugins: readonly PluginInfoData[];
	catalog: readonly DiscoverPlugin[];
	/** GitHub `owner/repo` per marketplace id, for the "More" byline. */
	marketplaceRepos?: ReadonlyMap<string, string>;
}

export interface UnifiedSearch {
	yours: UnifiedHit[];
	more: UnifiedHit[];
}

function matchRange(name: string, term: string): readonly [number, number] | null {
	const start = name.toLowerCase().indexOf(term);
	return start === -1 ? null : [start, start + term.length];
}

const byName = (a: {name: string}, b: {name: string}) => a.name.localeCompare(b.name);

/** Plugin skill ids are `plugin:<name>@<marketplace>:<skill>`. */
function skillMarketplace(skill: SkillSummary): string | null {
	if (skill.source !== "plugin") return null;
	const pluginId = skill.id.slice("plugin:".length, skill.id.lastIndexOf(":"));
	return pluginId.slice(pluginId.lastIndexOf("@") + 1);
}

/**
 * Upstream's unified Customize search: everything you have that matches goes
 * in "Yours" (skills, custom commands, connectors, then installed plugins),
 * and catalog plugins you could add go in "More you can add".
 */
export function buildUnifiedSearch(sources: UnifiedSearchSources, q: string): UnifiedSearch {
	const term = Array.from(q.trim()).slice(0, MAX_TERM_CODE_POINTS).join("").toLowerCase();
	if (!searchTermReady(term)) return {yours: [], more: []};

	const skills = sources.skills
		.filter((skill) => matchesQuery(term, skill.name, skill.description, skill.sourceLabel))
		.toSorted(byName)
		.map((skill): UnifiedHit => {
			const marketplace = skillMarketplace(skill);
			return {
				key: `skill:${skill.id}`,
				kind: "Skill",
				name: skill.name,
				byline: `from ${skill.sourceLabel}`,
				description: skill.description,
				verified: marketplace !== null && isOfficialMarketplace(marketplace),
				match: matchRange(skill.name, term),
				open: {kind: "skill", id: skill.id, tab: "overview"},
			};
		});

	const commands = commandRows(sources.commands, "all", term).map((row): UnifiedHit => ({
		key: `command:${row.key}`,
		kind: "Custom command",
		name: row.invocation,
		byline: `from ${row.sourceName}`,
		description: row.description,
		verified: false,
		match: matchRange(row.invocation, term),
		open: null,
	}));

	const servers = sources.servers
		.filter((server) => matchesQuery(term, server.name, server.urlOrCommand))
		.toSorted(byName)
		.map((server): UnifiedHit => ({
			key: `server:${server.id}`,
			kind: "Connector",
			name: server.name,
			byline: SCOPE_LABEL[server.scope],
			description: server.urlOrCommand,
			verified: false,
			match: matchRange(server.name, term),
			open: {kind: "connector", slug: toConnectorSlug(server.id)},
		}));

	const claudeAi = sources.claudeAi
		.filter((connector) => matchesQuery(term, connector.name))
		.toSorted(byName)
		.map((connector): UnifiedHit => ({
			key: `claude-ai:${connector.key}`,
			kind: "Connector",
			name: connector.name,
			byline: "claude.ai",
			description: "",
			verified: false,
			match: matchRange(connector.name, term),
			open: {kind: "external", href: CLAUDE_AI_CONNECTORS_URL},
		}));

	const plugins = sources.plugins
		.filter((plugin) => matchesQuery(term, plugin.name, plugin.description))
		.toSorted(byName)
		.map((plugin): UnifiedHit => ({
			key: `plugin:${plugin.id}`,
			kind: "Plugin",
			name: plugin.name,
			byline: `from ${formatMarketplaceName(plugin.marketplace)}`,
			description: plugin.description,
			verified: isOfficialMarketplace(plugin.marketplace),
			match: matchRange(plugin.name, term),
			open: {kind: "plugin", id: plugin.id, tab: "overview"},
		}));

	const more = addableMatches(sources.catalog, term).map((plugin): UnifiedHit => ({
		key: `catalog:${plugin.id}`,
		kind: "Plugin",
		name: plugin.title,
		byline: sources.marketplaceRepos?.get(plugin.marketplace) ?? plugin.marketplace,
		description: plugin.description,
		verified: isOfficialMarketplace(plugin.marketplace),
		match: matchRange(plugin.title, term),
		open: null,
	}));

	return {yours: [...skills, ...commands, ...servers, ...claudeAi, ...plugins], more};
}
