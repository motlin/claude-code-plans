import {describe, expect, it} from "vite-plus/test";
import {settingsCommandDescription, settingsPaletteCommands} from "../src/lib/palette-settings-commands";

describe("settingsPaletteCommands (upstream Ss)", () => {
	it("lists one Settings → section command per nav member in nav order, renamed rows by their row name", () => {
		expect(settingsPaletteCommands().map((command) => [command.key, command.description])).toStrictEqual([
			["usage", "Settings → Usage"],
			["general", "Settings → Appearance"],
			["notifications", "Settings → Notifications"],
			["customize-connectors", "Settings → Connectors"],
			["customize-skills", "Settings → Skills"],
			["customize-plugins", "Settings → Plugins"],
			["claude-code", "Settings → Code"],
			["transcript", "Settings → Transcript"],
			["sessions", "Settings → Sessions"],
			["application", "Settings → Application"],
			["ai-features", "Settings → AI features"],
			["claude-config", "Settings → Claude Config"],
			["setup", "Settings → Setup"],
		]);
	});

	it("builds de-duplicated search hints: settings, section keywords, the row name, then the old label", () => {
		const byKey = Object.fromEntries(
			settingsPaletteCommands().map((command) => [command.key, {hints: command.searchHints, icon: command.icon}]),
		);
		expect({
			general: byKey["general"],
			code: byKey["claude-code"],
			connectors: byKey["customize-connectors"],
			skills: byKey["customize-skills"],
			usage: byKey["usage"],
		}).toStrictEqual({
			general: {hints: ["settings", "Appearance", "General"], icon: "settings"},
			code: {hints: ["settings", "Code", "Claude Code"], icon: "settings"},
			connectors: {
				hints: ["settings", "integrations", "connections", "mcp", "extensions", "Customize"],
				icon: "settings",
			},
			skills: {hints: ["settings"], icon: "settings"},
			usage: {hints: ["settings", "overage", "extra usage", "spend limit", "usage credits"], icon: "usage"},
		});
	});

	it("carries each command's nav member", () => {
		expect(
			settingsPaletteCommands()
				.filter((command) => ["general", "customize-skills"].includes(command.key))
				.map((command) => command.member),
		).toStrictEqual([
			{kind: "settings", tab: "general"},
			{kind: "customize", section: "skills"},
		]);
	});
});

describe("settingsCommandDescription", () => {
	it("pins upstream's two- and three-part forms", () => {
		expect([
			settingsCommandDescription("Appearance"),
			settingsCommandDescription("Skills", "Customize"),
		]).toStrictEqual(["Settings → Appearance", "Settings → Customize → Skills"]);
	});
});
