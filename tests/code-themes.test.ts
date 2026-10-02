import {describe, expect, it} from "vite-plus/test";
import {DEFAULTS, settingStorageKey} from "../src/components/settings-provider";
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
				"one-light",
				"catppuccin-latte",
				"solarized-light",
				"vitesse-light",
				"min-light",
				"rose-pine-dawn",
				"slack-ochin",
			],
			dark: [
				"github-dark",
				"github-dark-dimmed",
				"pierre-dark",
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
				"One Light",
				"Catppuccin Latte",
				"Solarized Light",
				"Vitesse Light",
				"Min Light",
				"Rosé Pine Dawn",
				"Slack Ochin",
			],
			darkLabels: [
				"GitHub Dark",
				"GitHub Dark Dimmed",
				"Pierre Dark",
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
			unportedClaudeDark: CodeThemeDarkSchema.safeParse("claude-dark").success,
			unknown: CodeThemeLightSchema.safeParse("solarized").success,
		}).toStrictEqual({
			darkAsLight: false,
			lightAsDark: false,
			unportedClaudeDark: false,
			unknown: false,
		});
	});

	it("defaults to Claude Light, GitHub Dark and the built-in code font", () => {
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
			codeThemeDark: "github-dark",
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
});
