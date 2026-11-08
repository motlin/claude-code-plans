import type {CustomizeSection} from "./settings-hash";
import {
	navMemberKey,
	navMemberLabel,
	navRowLabel,
	type SettingsNavMember,
	type SettingsNavMemberKey,
	settingsNavGroups,
} from "./settings-nav";
import {SETTINGS_SECTION_KEYWORDS} from "./settings-search";

/** Upstream's per-section search hints for the Customize members. */
const CUSTOMIZE_SECTION_KEYWORDS: Partial<Record<CustomizeSection, readonly string[]>> = {
	connectors: ["integrations", "connections", "mcp", "extensions"],
};

/** One ⌘K command that opens a Settings section (upstream `Ss()` action, group "settings"). */
export interface SettingsPaletteCommand {
	key: SettingsNavMemberKey;
	member: SettingsNavMember;
	description: string;
	searchHints: readonly string[];
	icon: "settings" | "usage";
}

/** Upstream's `X/yufV` "Settings → {section}", or `XE3qsI` "Settings → {group} → {section}" for a named group. */
export function settingsCommandDescription(section: string, group?: string): string {
	return group === undefined ? `Settings → ${section}` : `Settings → ${group} → ${section}`;
}

function sectionKeywords(member: SettingsNavMember): readonly string[] {
	return (
		(member.kind === "settings"
			? SETTINGS_SECTION_KEYWORDS[member.tab]
			: CUSTOMIZE_SECTION_KEYWORDS[member.section]) ?? []
	);
}

/**
 * Every Settings nav member as a palette command, in nav order. A renamed single-member row (Appearance, Code)
 * is described by its row name and also found by its old label; the first member of a multi-member row is also
 * found by the row name ("Customize" on Connectors). Local nav groups are unnamed, so descriptions are two-part.
 */
export function settingsPaletteCommands(): SettingsPaletteCommand[] {
	return settingsNavGroups().flatMap(({rows}) =>
		rows.flatMap((row) =>
			row.members.map((member, index): SettingsPaletteCommand => {
				const label = navMemberLabel(member);
				const renamed = row.members.length === 1 ? navRowLabel(row) : label;
				const groupAlias = index === 0 && row.members.length > 1 && row.name !== undefined ? [row.name] : [];
				const aliases = renamed === label ? groupAlias : [renamed, label];
				const key = navMemberKey(member);
				return {
					key,
					member,
					description: settingsCommandDescription(renamed),
					searchHints: [...new Set(["settings", ...sectionKeywords(member), ...aliases])],
					icon: key === "usage" ? "usage" : "settings",
				};
			}),
		),
	);
}
