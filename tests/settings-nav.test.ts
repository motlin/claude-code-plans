import {describe, expect, it} from "vite-plus/test";
import {CustomizeSectionSchema, SettingsTabSchema} from "../src/lib/settings-hash";
import {
	navMemberKey,
	navRowFor,
	navRowLabel,
	SETTINGS_NAV_ROWS,
	type SettingsNavRow,
	settingsNavGroups,
	settingsSearchNames,
} from "../src/lib/settings-nav";

describe("SETTINGS_NAV_ROWS", () => {
	it("groups rows like upstream's bc(): account, claude, apps, more, with renamed Appearance, Customize and Code", () => {
		expect(settingsNavGroups().map((group) => [group.group, group.rows.map(navRowLabel)])).toStrictEqual([
			["account", ["Usage"]],
			["claude", ["Appearance"]],
			["apps", ["Customize", "Code", "Transcript", "Sessions"]],
			["more", ["Application", "AI features", "Claude Config", "Setup"]],
		]);
	});

	it("lists every settings tab and customize section exactly once, in upstream member order", () => {
		const keys = SETTINGS_NAV_ROWS.flatMap((row) => row.members.map(navMemberKey));
		expect(keys.toSorted()).toStrictEqual(
			[
				...SettingsTabSchema.options,
				...CustomizeSectionSchema.options.map((section) => `customize-${section}`),
			].toSorted(),
		);
		expect(SETTINGS_NAV_ROWS.map((row) => [row.testId, row.members.map(navMemberKey)])).toStrictEqual([
			["usage-settings", ["usage"]],
			["general-settings", ["general"]],
			["customize-connectors-settings", ["customize-connectors", "customize-skills", "customize-plugins"]],
			["claude-code-settings", ["claude-code"]],
			["transcript-settings", ["transcript"]],
			["sessions-settings", ["sessions"]],
			["application-settings", ["application"]],
			["ai-features-settings", ["ai-features"]],
			["claude-config-settings", ["claude-config"]],
			["setup-settings", ["setup"]],
		]);
	});

	it("maps each member to the row that stands for it (upstream standsFor)", () => {
		expect([
			navRowFor({kind: "customize", section: "skills"}).testId,
			navRowFor({kind: "customize", section: "plugins"}).testId,
			navRowFor({kind: "settings", tab: "general"}).testId,
			navRowFor({kind: "settings", tab: "setup"}).testId,
		]).toStrictEqual([
			"customize-connectors-settings",
			"customize-connectors-settings",
			"general-settings",
			"setup-settings",
		]);
	});

	it("drops empty groups", () => {
		const rows: readonly SettingsNavRow[] = [
			{group: "more", members: [{kind: "settings", tab: "setup"}], testId: "setup-settings"},
			{group: "account", members: [{kind: "settings", tab: "usage"}], testId: "usage-settings"},
		];
		expect(settingsNavGroups(rows).map((group) => [group.group, group.rows.map(navRowLabel)])).toStrictEqual([
			["account", ["Usage"]],
			["more", ["Setup"]],
		]);
	});
});

describe("settingsSearchNames", () => {
	it("renames a named single-member row and gives only a multi-member row's first member the group alias", () => {
		const rows: readonly SettingsNavRow[] = [
			{
				group: "claude",
				members: [{kind: "settings", tab: "general"}],
				name: "Appearance",
				nameWhenAlone: true,
				testId: "general-settings",
			},
			{
				group: "apps",
				members: [
					{kind: "customize", section: "skills"},
					{kind: "customize", section: "connectors"},
				],
				name: "Customize",
				testId: "customize-skills-settings",
			},
			{group: "apps", members: [{kind: "settings", tab: "setup"}], name: "Unused", testId: "setup-settings"},
		];
		expect(settingsSearchNames(rows)).toStrictEqual({
			general: {name: "Appearance", alsoFoundBy: ["General"]},
			"customize-skills": {alsoFoundBy: ["Customize"]},
		});
	});

	it("derives the real table's names", () => {
		expect(settingsSearchNames()).toStrictEqual({
			general: {name: "Appearance", alsoFoundBy: ["General"]},
			"customize-connectors": {alsoFoundBy: ["Customize"]},
			"claude-code": {name: "Code", alsoFoundBy: ["Claude Code"]},
		});
	});
});
