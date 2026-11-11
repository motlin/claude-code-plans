import {describe, expect, it} from "vite-plus/test";
import {claudeDark} from "../src/lib/claude-dark-theme";
import {claudeLight} from "../src/lib/claude-light-theme";
import {loadCodeTheme} from "../src/lib/code-themes";
import type {GhosttyAppearance} from "../src/lib/server-fns";
import {
	applyTerminalTheme,
	DEFAULT_TERMINAL_APPEARANCE,
	terminalBaseFromCodeTheme,
	terminalThemeFromCodeTheme,
	TerminalAppearanceSchema,
} from "../src/lib/terminal-theme";

const FULL_THEME = {
	name: "fixture-dark",
	colors: {
		"editor.background": "#101010",
		"editor.foreground": "#eeeeee",
		"terminal.background": "#0A0B0C",
		"terminal.foreground": "#D0D1D2",
		"terminalCursor.foreground": "#ff00ffcc",
		"terminalCursor.background": "#123",
		"terminal.selectionBackground": "#3a3d4180",
		"terminal.ansiBlack": "#000000",
		"terminal.ansiRed": "#aa0000",
		"terminal.ansiGreen": "#00aa00",
		"terminal.ansiYellow": "#aaaa00",
		"terminal.ansiBlue": "#0000aa",
		"terminal.ansiMagenta": "#aa00aa",
		"terminal.ansiCyan": "#00aaaa",
		"terminal.ansiWhite": "#aaaaaa",
		"terminal.ansiBrightBlack": "#555555",
		"terminal.ansiBrightRed": "#ff5555",
		"terminal.ansiBrightGreen": "#55ff55",
		"terminal.ansiBrightYellow": "#ffff55",
		"terminal.ansiBrightBlue": "#5555ff",
		"terminal.ansiBrightMagenta": "#ff55ff",
		"terminal.ansiBrightCyan": "#55ffff",
		"terminal.ansiBrightWhite": "#ffffff",
	},
};

const GHOSTTY: GhosttyAppearance = {
	fontFamily: '"Alice Mono", monospace',
	fontSize: 16,
	theme: {background: "#1d1f21", foreground: "#c5c8c6", cursor: "#dddddd", red: "#cc6666"},
};

describe("terminalThemeFromCodeTheme", () => {
	it("maps the 16 ANSI colours, cursor and selection from terminal.* keys, and the background from editor.background", () => {
		expect(terminalThemeFromCodeTheme(FULL_THEME)).toStrictEqual({
			background: "#101010",
			foreground: "#d0d1d2",
			cursor: "#ff00ff",
			cursorAccent: "#112233",
			selectionBackground: "#3a3d4180",
			selectionForeground: "#d0d1d2",
			black: "#000000",
			red: "#aa0000",
			green: "#00aa00",
			yellow: "#aaaa00",
			blue: "#0000aa",
			magenta: "#aa00aa",
			cyan: "#00aaaa",
			white: "#aaaaaa",
			brightBlack: "#555555",
			brightRed: "#ff5555",
			brightGreen: "#55ff55",
			brightYellow: "#ffff55",
			brightBlue: "#5555ff",
			brightMagenta: "#ff55ff",
			brightCyan: "#55ffff",
			brightWhite: "#ffffff",
		});
	});

	it("starts from the base theme and fills cursor keys from the foreground and background, like upstream's Ae", () => {
		expect(
			terminalThemeFromCodeTheme(
				{
					colors: {
						"editor.background": "#FFFFFF",
						"editor.foreground": "#24292eff",
						"terminal.ansiRed": "#d73a49",
						"terminal.ansiBlue": "not-a-colour",
					},
				},
				{
					background: "#101010",
					foreground: "#eeeeee",
					cursor: "#0099ff",
					cursorAccent: "#101010",
					selectionBackground: "#0099ff4d",
					red: "#aa0000",
					green: "#00aa00",
				},
			),
		).toStrictEqual({
			background: "#ffffff",
			foreground: "#24292e",
			cursor: "#24292e",
			cursorAccent: "#ffffff",
			selectionBackground: "#0099ff4d",
			selectionForeground: "#24292e",
			red: "#d73a49",
			green: "#00aa00",
		});
	});

	it("picks editor.foreground over a terminal.foreground below 10:1, raising a darker brightWhite to it", () => {
		const theme = (terminalForeground: string) =>
			terminalThemeFromCodeTheme({
				colors: {
					"editor.background": "#ffffff",
					"editor.foreground": "#222222",
					"terminal.foreground": terminalForeground,
					"terminal.ansiBrightWhite": "#111111",
				},
			});
		const pick = ({foreground, brightWhite}: ReturnType<typeof theme>) => ({foreground, brightWhite});
		expect([pick(theme("#888888")), pick(theme("#333333")), pick(theme("#888888cc"))]).toStrictEqual([
			{foreground: "#222222", brightWhite: "#222222"},
			{foreground: "#333333", brightWhite: "#111111"},
			{foreground: "#888888", brightWhite: "#111111"},
		]);
	});

	it("falls back to editor.selectionBackground when the theme has no terminal selection", () => {
		expect(
			terminalThemeFromCodeTheme(
				{colors: {"editor.background": "#ffffff", "editor.selectionBackground": "#11223344"}},
				{foreground: "#000011", selectionBackground: "#0099ff4d", selectionForeground: "#ff0000"},
			),
		).toStrictEqual({
			background: "#ffffff",
			foreground: "#000011",
			cursor: "#000011",
			cursorAccent: "#ffffff",
			selectionBackground: "#11223344",
			selectionForeground: "#000011",
		});
	});

	it("maps real themes the way upstream merges them over the Claude default for the mode", async () => {
		const [light, dark] = [
			terminalBaseFromCodeTheme(await loadCodeTheme("claude-light")),
			terminalBaseFromCodeTheme(await loadCodeTheme("claude-dark")),
		];
		const github = terminalThemeFromCodeTheme(await loadCodeTheme("github-light"), light);
		const pierre = terminalThemeFromCodeTheme(await loadCodeTheme("pierre-dark"), dark);
		expect({
			github: {foreground: github.foreground, selectionBackground: github.selectionBackground},
			pierre: {
				background: pierre.background,
				foreground: pierre.foreground,
				brightWhite: pierre.brightWhite,
				cursor: pierre.cursor,
			},
		}).toStrictEqual({
			github: {foreground: "#24292e", selectionBackground: "#0366d625"},
			pierre: {background: "#0a0a0a", foreground: "#fafafa", brightWhite: "#fafafa", cursor: "#fafafa"},
		});
	});

	it("maps upstream's Claude Light and Claude Dark terminal colours exactly", () => {
		const LIGHT = {
			background: "#ffffff",
			foreground: "#14181f",
			cursor: "#0073e6",
			cursorAccent: "#ffffff",
			selectionBackground: "#0073e640",
			black: "#1a1a1a",
			red: "#ff3a30",
			green: "#1e9e3c",
			yellow: "#98801f",
			blue: "#0073e6",
			magenta: "#cd2054",
			cyan: "#8e6bd9",
			white: "#999999",
			brightBlack: "#666666",
			brightRed: "#ff5047",
			brightGreen: "#1e9e3c",
			brightYellow: "#98801f",
			brightBlue: "#0078f0",
			brightMagenta: "#cd2054",
			brightCyan: "#8e6bd9",
			brightWhite: "#d6d6d6",
		};
		const DARK = {
			background: "#191919",
			foreground: "#eaecf0",
			cursor: "#0099ff",
			cursorAccent: "#191919",
			selectionBackground: "#0099ff4d",
			black: "#262626",
			red: "#ff3a30",
			green: "#32d74b",
			yellow: "#ffd014",
			blue: "#0099ff",
			magenta: "#ff2c56",
			cyan: "#b796ff",
			white: "#a6a6a6",
			brightBlack: "#525252",
			brightRed: "#ff5047",
			brightGreen: "#32d74b",
			brightYellow: "#ffd014",
			brightBlue: "#0087ee",
			brightMagenta: "#ff2c56",
			brightCyan: "#b796ff",
			brightWhite: "#ededed",
		};
		expect({
			light: terminalThemeFromCodeTheme(claudeLight),
			dark: terminalThemeFromCodeTheme(claudeDark),
			lightBase: terminalBaseFromCodeTheme(claudeLight),
			darkBase: terminalBaseFromCodeTheme(claudeDark),
		}).toStrictEqual({
			light: {...LIGHT, selectionForeground: "#14181f"},
			dark: {...DARK, selectionForeground: "#eaecf0"},
			lightBase: LIGHT,
			darkBase: DARK,
		});
	});

	it("returns an empty theme when the code theme has no colours", () => {
		expect(terminalThemeFromCodeTheme({})).toStrictEqual({});
	});
});

describe("applyTerminalTheme", () => {
	it("keeps the Ghostty appearance untouched in ghostty mode", () => {
		expect(applyTerminalTheme(GHOSTTY, null, null)).toBe(GHOSTTY);
	});

	it("sizes the terminal font from Settings ▸ Code font size when one is set", () => {
		expect([
			applyTerminalTheme(GHOSTTY, null, 20).fontSize,
			applyTerminalTheme(GHOSTTY, {}, 11).fontSize,
		]).toStrictEqual([20, 11]);
	});

	it("replaces the Ghostty colours with the code theme, keeping its font and background fallbacks", () => {
		expect(applyTerminalTheme(GHOSTTY, {red: "#d73a49", cursor: "#000000"}, null)).toStrictEqual({
			fontFamily: '"Alice Mono", monospace',
			fontSize: 16,
			theme: {
				background: "#1d1f21",
				foreground: "#c5c8c6",
				red: "#d73a49",
				cursor: "#000000",
			},
		});
	});
});

describe("TerminalAppearanceSchema", () => {
	it("follows the code theme by default, with Ghostty as the alternative", () => {
		expect({
			options: TerminalAppearanceSchema.options,
			default: DEFAULT_TERMINAL_APPEARANCE,
		}).toStrictEqual({options: ["code-theme", "ghostty"], default: "code-theme"});
	});
});
