import type {ThemeRegistration} from "@shikijs/core";
import type {CodeThemeId} from "./code-themes";

/*
 * Upstream's `completeCodeTheme` (c9668703f): keys merged over a theme as it
 * loads, for themes that leave them out. Only the terminal half is ported:
 * the keys the terminal mapper reads (editor foreground and selection,
 * terminal selection, cursor and ANSI). The `tokenColors` and the bracket,
 * find-match and line-highlight keys are code-theme-completions-token-colors;
 * add them to the same entries, and `completeCodeTheme` already appends
 * `tokenColors`.
 */

interface CodeThemeCompletion
{
	colors?: Record<string, string>;
	tokenColors?: NonNullable<ThemeRegistration["tokenColors"]>;
}

const ANSI_NAMES = ["Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White"] as const;

/** Upstream's `n`: the 16 `terminal.ansi*` keys from two space-separated lists of eight. */
function ansi(normal: string, bright: string): Record<string, string>
{
	return Object.fromEntries(
		[normal, bright].flatMap((list, index) =>
			list.split(" ").map((color, i) => [`terminal.ansi${index === 0 ? "" : "Bright"}${ANSI_NAMES[i]}`, color]),
		),
	);
}

/** Upstream's `r`. */
function terminalSelection(color: string): Record<string, string>
{
	return {
		"terminal.selectionBackground": color,
	};
}

const CODE_THEME_COMPLETIONS: Partial<Record<CodeThemeId, CodeThemeCompletion>> =
{
	"github-dark-dimmed":
	{
		colors:
		{
			"editor.selectionBackground": "#2d97fd5b",
		},
	},
	"vscode-light":
	{
		colors:
		{
			"editor.selectionBackground": "#0069cc2e",
		},
	},
	"vscode-dark":
	{
		colors:
		{
			"editor.selectionBackground": "#3fc8ff38",
		},
	},
	"one-light":
	{
		colors:
		{
			"editor.selectionBackground": "#07071216",
			...terminalSelection("#07071227"),
			...ansi(
				"#383a42 #e45649 #50a14f #986801 #4078f2 #a626a4 #0184bc #696c77",
				"#626772 #e45649 #50a14f #986801 #4078f2 #a626a4 #0184bc #8f9096",
			),
		},
	},
	dracula:
	{
		colors:
		{
			"editor.selectionBackground": "#c3cbfe2e",
		},
	},
	"dracula-soft":
	{
		colors:
		{
			"editor.selectionBackground": "#c3cbfe2e",
		},
	},
	"catppuccin-latte":
	{
		colors:
		{
			"terminalCursor.foreground": "#4c4f69",
		},
	},
	nord:
	{
		colors:
		{
			"editor.selectionBackground": "#7281a040",
			...terminalSelection("#7281a048"),
		},
	},
	"solarized-dark":
	{
		colors:
		{
			"editor.selectionBackground": "#ffdc8427",
		},
	},
	"solarized-light":
	{
		colors:
		{
			"editor.selectionBackground": "#0e170410",
			...terminalSelection("#0e170429"),
		},
	},
	"vitesse-dark":
	{
		colors: terminalSelection("#eeeeee23"),
	},
	"vitesse-light":
	{
		colors: terminalSelection("#2222222c"),
	},
	"min-dark":
	{
		colors:
		{
			...ansi(
				"#444444 #ea4a5a #34d058 #ffea7f #2188ff #b392f0 #39c5cf #d1d5da",
				"#5c5c5c #f97583 #85e89d #ffea7f #79b8ff #b392f0 #56d4dd #fafbfc",
			),
			"editor.foreground": "#bbbbbb",
			"editor.selectionBackground": "#3097fd66",
		},
	},
	"min-light":
	{
		colors:
		{
			"editor.selectionBackground": "#007fff35",
			"terminal.selectionBackground": "#007fff52",
			"terminal.ansiBlue": "#1976d2",
		},
	},
	monokai:
	{
		colors:
		{
			"editor.selectionBackground": "#878b912f",
			"terminal.selectionBackground": "#878b9180",
		},
	},
	"tokyo-night":
	{
		colors: terminalSelection("#515c7e65"),
	},
	"night-owl":
	{
		colors:
		{
			"editor.selectionBackground": "#8acbff34",
		},
	},
	"rose-pine":
	{
		colors: terminalSelection("#6e6a8650"),
	},
	"rose-pine-dawn":
	{
		colors:
		{
			...terminalSelection("#6e6a8644"),
			"terminalCursor.foreground": "#575279",
			"terminalCursor.background": "#faf4ed",
		},
	},
	"slack-dark":
	{
		colors:
		{
			...ansi(
				"#000000 #cd3131 #0dbc79 #e5e510 #2472c8 #bc3fbc #11a8cd #e5e5e5",
				"#666666 #f14c4c #23d18b #f5f543 #3b8eea #d670d6 #29b8db #e5e5e5",
			),
			"editor.selectionBackground": "#2c95fd41",
			"terminal.selectionBackground": "#2c95fd64",
		},
	},
	"slack-ochin":
	{
		colors:
		{
			"editor.selectionBackground": "#0078f251",
		},
	},
};

/** Upstream's `completeCodeTheme`: the theme with its completion's colours merged over and token rules appended. */
export function completeCodeTheme(id: CodeThemeId, theme: ThemeRegistration): ThemeRegistration
{
	const completion = CODE_THEME_COMPLETIONS[id];
	if (completion === undefined) return theme;
	return {
		...theme,
		colors:
		{
			...theme.colors,
			...completion.colors,
		},
		...(completion.tokenColors !== undefined &&
		{
			tokenColors: [...(theme.tokenColors ?? []), ...completion.tokenColors],
		}),
	};
}
