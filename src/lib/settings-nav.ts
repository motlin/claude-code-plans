import {customizeSectionLabels, settingsTabLabels} from "./schema-choices";
import type {CustomizeSection, SettingsTab} from "./settings-hash";

/** Upstream's nav groups (`G$` order). Grouped nav groups carry no title. */
export type SettingsNavGroup = "account" | "claude" | "apps" | "more";

const SETTINGS_NAV_GROUP_ORDER: readonly SettingsNavGroup[] = ["account", "claude", "apps", "more"];

/** One section a nav row stands for: a Settings tab or a Customize section. */
export type SettingsNavMember =
	|
	  {
			kind: "settings";
			tab: SettingsTab;
	  }
	|
	  {
			kind: "customize";
			section: CustomizeSection;
	  };

/** Upstream's section id for a member: the tab id, or `customize-<section>`. */
export type SettingsNavMemberKey = SettingsTab | `customize-${CustomizeSection}`;

/**
 * One nav row (upstream `Pi` entry). A row is named when it has several members or `nameWhenAlone`; its
 * name then replaces the first member's label in the nav, page title and search.
 */
export interface SettingsNavRow
{
	group: SettingsNavGroup;
	members: readonly [SettingsNavMember, ...SettingsNavMember[]];
	name?: string;
	nameWhenAlone?: boolean;
	testId: string;
}

const settings = (tab: SettingsTab): SettingsNavMember => (
{
	kind: "settings",
	tab,
});
const customize = (section: CustomizeSection): SettingsNavMember => (
{
	kind: "customize",
	section,
});

/**
 * The Settings nav rows in order, as upstream's grouped nav: Usage; Appearance (General renamed) and
 * Notifications; then
 * Customize (one row for Connectors, Skills and Plugins), Code (Claude Code renamed) and the local
 * Claude Code session extras; then the local application rows.
 */
export const SETTINGS_NAV_ROWS: readonly SettingsNavRow[] = [
	{
		group: "account",
		members: [settings("usage")],
		testId: "usage-settings",
	},
	{
		group: "claude",
		members: [settings("general")],
		name: "Appearance",
		nameWhenAlone: true,
		testId: "general-settings",
	},
	{
		group: "claude",
		members: [settings("notifications")],
		testId: "notifications-settings",
	},
	{
		group: "apps",
		members: [customize("connectors"), customize("skills"), customize("plugins")],
		name: "Customize",
		testId: "customize-connectors-settings",
	},
	{
		group: "apps",
		members: [settings("claude-code")],
		name: "Code",
		nameWhenAlone: true,
		testId: "claude-code-settings",
	},
	{
		group: "apps",
		members: [settings("transcript")],
		testId: "transcript-settings",
	},
	{
		group: "apps",
		members: [settings("sessions")],
		testId: "sessions-settings",
	},
	{
		group: "more",
		members: [settings("application")],
		testId: "application-settings",
	},
	{
		group: "more",
		members: [settings("ai-features")],
		testId: "ai-features-settings",
	},
	{
		group: "more",
		members: [settings("claude-config")],
		testId: "claude-config-settings",
	},
	{
		group: "more",
		members: [settings("setup")],
		testId: "setup-settings",
	},
];

export function navMemberKey(member: SettingsNavMember): SettingsNavMemberKey
{
	return member.kind === "settings" ? member.tab : `customize-${member.section}`;
}

/** The member's own label, before any row rename. */
export function navMemberLabel(member: SettingsNavMember): string
{
	return member.kind === "settings" ? settingsTabLabels[member.tab] : customizeSectionLabels[member.section];
}

function rowNameShown(row: SettingsNavRow): row is SettingsNavRow &
{
	name: string;
}
{
	return row.name !== undefined && (row.members.length > 1 || row.nameWhenAlone === true);
}

/** The row's nav label: its name when shown, else its first member's label. */
export function navRowLabel(row: SettingsNavRow): string
{
	return rowNameShown(row) ? row.name : navMemberLabel(row.members[0]);
}

/** The row that stands for `member` (upstream `standsFor`), so it is current for every member. */
export function navRowFor(
	member: SettingsNavMember,
	rows: readonly SettingsNavRow[] = SETTINGS_NAV_ROWS,
): SettingsNavRow
{
	const key = navMemberKey(member);
	const row = rows.find((candidate) => candidate.members.some((other) => navMemberKey(other) === key));
	if (row === undefined) throw new Error(`No settings nav row for ${key}`);
	return row;
}

/** The rows grouped in upstream's group order, empty groups dropped. */
export function settingsNavGroups(rows: readonly SettingsNavRow[] = SETTINGS_NAV_ROWS):
{
	group: SettingsNavGroup;
	rows: SettingsNavRow[];
}[]
{
	return SETTINGS_NAV_GROUP_ORDER.map((group) => (
	{
		group,
		rows: rows.filter((row) => row.group === group),
	})).filter((entry) => entry.rows.length > 0);
}

/** How search finds a section: an optional new name and the names that also find it (2+ char queries). */
export interface SettingsSearchName
{
	name?: string;
	alsoFoundBy: readonly string[];
}

/**
 * Upstream `bc()`'s `searchNames`: a shown-name single-member row renames its member and keeps the old
 * label as an alias; a multi-member row gives only its first member the row name as an alias.
 */
export function settingsSearchNames(
	rows: readonly SettingsNavRow[] = SETTINGS_NAV_ROWS,
): Partial<Record<SettingsNavMemberKey, SettingsSearchName>>
{
	const names: Partial<Record<SettingsNavMemberKey, SettingsSearchName>> = {};
	for (const row of rows)
	{
		if (!rowNameShown(row)) continue;
		const [first] = row.members;
		names[navMemberKey(first)] =
			row.members.length > 1
				?
					{
						alsoFoundBy: [row.name],
					}
				:
					{
						name: row.name,
						alsoFoundBy: [navMemberLabel(first)],
					};
	}
	return names;
}
