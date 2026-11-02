import {resolveTheme} from "@pierre/diffs";
import {describe, expect, it} from "vite-plus/test";
import {DEFAULTS, settingStorageKey} from "../src/components/settings-context";
import {CodeThemeDarkSchema, CodeThemeLightSchema, codeFontFamily, loadCodeTheme} from "../src/lib/code-themes";
import {codeThemeDarkLabels, codeThemeLightLabels} from "../src/lib/schema-choices";

describe("code theme settings", () => {
	it("offers upstream's light and dark Shiki themes as strict enums", () => {
		expect({
			light: CodeThemeLightSchema.options,
			dark: CodeThemeDarkSchema.options,
			lightLabels: Object.values(codeThemeLightLabels),
			darkLabels: Object.values(codeThemeDarkLabels),
		}).toStrictEqual({
			light: [
				"claude-light",
				"github-light",
				"pierre-light",
				"vscode-light",
				"one-light",
				"catppuccin-latte",
				"solarized-light",
				"vitesse-light",
				"min-light",
				"rose-pine-dawn",
				"slack-ochin",
			],
			dark: [
				"claude-dark",
				"github-dark",
				"github-dark-dimmed",
				"pierre-dark",
				"vscode-dark",
				"one-dark-pro",
				"dracula",
				"dracula-soft",
				"catppuccin-mocha",
				"nord",
				"solarized-dark",
				"vitesse-dark",
				"min-dark",
				"monokai",
				"tokyo-night",
				"night-owl",
				"rose-pine",
				"ayu-dark",
				"slack-dark",
			],
			lightLabels: [
				"Claude Light",
				"GitHub Light",
				"Pierre Light",
				"VS Code Light",
				"One Light",
				"Catppuccin Latte",
				"Solarized Light",
				"Vitesse Light",
				"Min Light",
				"Rosé Pine Dawn",
				"Slack Ochin",
			],
			darkLabels: [
				"Claude Dark",
				"GitHub Dark",
				"GitHub Dark Dimmed",
				"Pierre Dark",
				"VS Code Dark",
				"One Dark Pro",
				"Dracula",
				"Dracula Soft",
				"Catppuccin Mocha",
				"Nord",
				"Solarized Dark",
				"Vitesse Dark",
				"Min Dark",
				"Monokai",
				"Tokyo Night",
				"Night Owl",
				"Rosé Pine",
				"Ayu Dark",
				"Slack Dark",
			],
		});
	});

	it("rejects ids from the other mode and unknown themes", () => {
		expect({
			darkAsLight: CodeThemeLightSchema.safeParse("nord").success,
			lightAsDark: CodeThemeDarkSchema.safeParse("claude-light").success,
			darkAsDark: CodeThemeDarkSchema.safeParse("claude-dark").success,
			unknown: CodeThemeLightSchema.safeParse("solarized").success,
		}).toStrictEqual({
			darkAsLight: false,
			lightAsDark: false,
			darkAsDark: true,
			unknown: false,
		});
	});

	it("defaults to Claude Light, Claude Dark and the built-in code font", () => {
		expect({
			codeThemeLight: DEFAULTS.codeThemeLight,
			codeThemeDark: DEFAULTS.codeThemeDark,
			codeFont: DEFAULTS.codeFont,
			keys: [
				settingStorageKey("codeThemeLight"),
				settingStorageKey("codeThemeDark"),
				settingStorageKey("codeFont"),
			],
		}).toStrictEqual({
			codeThemeLight: "claude-light",
			codeThemeDark: "claude-dark",
			codeFont: "",
			keys: ["ccp-code-theme-light", "ccp-code-theme-dark", "ccp-code-font"],
		});
	});

	it("puts a custom code font ahead of the built-in monospace stack", () => {
		expect([
			codeFontFamily(""),
			codeFontFamily("   "),
			codeFontFamily("Fira Code"),
			codeFontFamily(' "Berkeley Mono";} '),
		]).toStrictEqual([
			null,
			null,
			'"Fira Code", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
			'"Berkeley Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
		]);
	});

	it("ports upstream's Claude Dark colours exactly", async () => {
		const theme = await loadCodeTheme("claude-dark");
		const foreground = (scope: string) =>
			theme.settings?.find((rule) => [rule.scope].flat().includes(scope))?.settings.foreground;
		expect({
			type: theme.type,
			fg: theme.fg,
			bg: theme.bg,
			editor: [theme.colors?.["editor.background"], theme.colors?.["editor.foreground"]],
			rules: theme.settings?.length,
			scopes: Object.fromEntries(
				[
					"comment",
					"punctuation",
					"keyword",
					"keyword.operator",
					"string",
					"string.regexp",
					"constant.numeric",
					"entity.name.tag",
					"entity.other.attribute-name",
					"entity.name.function",
					"variable.parameter",
					"entity.name.type",
					"variable.other.property",
				].map((scope) => [scope, foreground(scope)]),
			),
		}).toStrictEqual({
			type: "dark",
			fg: "#eaecf0",
			bg: "#191919",
			editor: ["#191919", "#eaecf0"],
			rules: 36,
			scopes: {
				comment: "#818898",
				punctuation: "#d3d7de",
				keyword: "#cc7bf4",
				"keyword.operator": "#eaecf0",
				string: "#9be963",
				"string.regexp": "#96e35f",
				"constant.numeric": "#5eeded",
				"entity.name.tag": "#f47b85",
				"entity.other.attribute-name": "#f0757f",
				"entity.name.function": "#70b8ff",
				"variable.parameter": "#f7ab5f",
				"entity.name.type": "#fbad60",
				"variable.other.property": "#eaecf0",
			},
		});
	});

	it.each([
		{
			id: "vscode-light",
			type: "light",
			fg: "#202020",
			bg: "#FFFFFF",
			selection: ["#0069cc2e", "#0069CC15"],
			brackets: ["#0431FA", "#319331", "#7B3814"],
			rules: 118,
			scopes: {
				comment: "#008000",
				keyword: "#0000ff",
				string: "#a31515",
				"string.regexp": "#811f3f",
				"constant.numeric": "#098658",
				"entity.name.tag": "#800000",
				"entity.other.attribute-name": "#e50000",
				"entity.name.function": "#795E26",
				variable: "#001080",
				"entity.name.type": "#267f99",
			},
		},
		{
			id: "vscode-dark",
			type: "dark",
			fg: "#BBBEBF",
			bg: "#121314",
			selection: ["#3fc8ff38", "#27678240"],
			brackets: ["#FFD700", "#DA70D6", "#179FFF"],
			rules: 119,
			scopes: {
				comment: "#6A9955",
				keyword: "#569cd6",
				string: "#ce9178",
				"string.regexp": "#d16969",
				"constant.numeric": "#b5cea8",
				"entity.name.tag": "#569cd6",
				"entity.other.attribute-name": "#9cdcfe",
				"entity.name.function": "#DCDCAA",
				variable: "#9CDCFE",
				"entity.name.type": "#4EC9B0",
			},
		},
	] as const)("ports upstream's $id colours exactly", async (expected) => {
		const theme = await loadCodeTheme(expected.id);
		const foreground = (scope: string) =>
			theme.settings?.find((rule) => [rule.scope].flat().includes(scope))?.settings.foreground;
		expect({
			id: expected.id,
			type: theme.type,
			fg: theme.fg,
			bg: theme.bg,
			selection: [
				theme.colors?.["editor.selectionBackground"],
				theme.colors?.["editor.selectionHighlightBackground"],
			],
			brackets: [1, 2, 3].map((n) => theme.colors?.[`editorBracketHighlight.foreground${n}`]),
			rules: theme.settings?.length,
			scopes: Object.fromEntries(Object.keys(expected.scopes).map((scope) => [scope, foreground(scope)])),
		}).toStrictEqual(expected);
	});

	it("lazily loads every offered theme under its own id", async () => {
		const ids = [...CodeThemeLightSchema.options, ...CodeThemeDarkSchema.options];
		const loaded = await Promise.all(
			ids.map(async (id) => {
				const theme = await loadCodeTheme(id);
				return {id, name: theme.name};
			}),
		);
		expect(loaded).toStrictEqual(ids.map((id) => ({id, name: id})));
	});

	it("registers the upstream-only themes with @pierre/diffs", async () => {
		// Importing the config module performs the registrations.
		await import("../src/components/changes/diffs-config");
		const ids = ["claude-light", "claude-dark", "vscode-light", "vscode-dark"] as const;
		const resolved = await Promise.all(
			ids.map(async (id) => {
				const theme = await resolveTheme(id);
				return {id, type: theme.type, bg: theme.bg};
			}),
		);
		expect(resolved).toStrictEqual([
			{id: "claude-light", type: "light", bg: "#faf9f580"},
			{id: "claude-dark", type: "dark", bg: "#191919"},
			{id: "vscode-light", type: "light", bg: "#FFFFFF"},
			{id: "vscode-dark", type: "dark", bg: "#121314"},
		]);
	});
});
