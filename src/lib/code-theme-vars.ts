type Mode = "light" | "dark";
type Colors = Readonly<Record<string, string>>;

/**
 * Upstream c5d464fa3's claude-light / claude-dark colours that `L` and c74f29bd2 `r` fall back to, as in
 * src/lib/claude-light-theme.ts and src/lib/claude-dark-theme.ts (kept here so the hooks don't pull in the
 * whole themes).
 */
const CLAUDE_DEFAULT_COLORS: Record<Mode, Colors> =
{
	light:
	{
		"editor.selectionBackground": "#0073e640",
		"editor.selectionHighlightBackground": "#0073e61a",
		"editor.findMatchBackground": "#ffd5008c",
		"editor.findMatchForeground": "#000000",
		"editor.findMatchHighlightBackground": "#ffd50040",
	},
	dark:
	{
		"editor.selectionBackground": "#0099ff4d",
		"editor.selectionHighlightBackground": "#0099ff24",
		"editor.findMatchBackground": "#ffd5008c",
		"editor.findMatchForeground": "#000000",
		"editor.findMatchHighlightBackground": "#ffd5002e",
	},
};

/** Upstream c5d464fa3 `L`: the Claude theme's colour for a key, or empty. */
function claudeDefault(mode: Mode, key: string): string
{
	return CLAUDE_DEFAULT_COLORS[mode][key] ?? "";
}

/**
 * Upstream c5d464fa3 `R`: the theme's `editor.selectionHighlightBackground` unless it equals its
 * `editor.selectionBackground`, else `editor.findMatchHighlightBackground`, else the Claude default.
 */
export function selectionMatchColor(colors: Colors, mode: Mode): string
{
	const highlight = colors["editor.selectionHighlightBackground"];
	return (
		(highlight === colors["editor.selectionBackground"] ? undefined : highlight) ??
		colors["editor.findMatchHighlightBackground"] ??
		claudeDefault(mode, "editor.selectionHighlightBackground")
	);
}

const GIT_KEYS =
{
	modified: ["modifiedResourceForeground"],
	untracked: ["untrackedResourceForeground"],
	added: ["addedResourceForeground", "untrackedResourceForeground"],
	renamed: ["renamedResourceForeground", "untrackedResourceForeground"],
	conflict: ["conflictingResourceForeground", "deletedResourceForeground"],
} as const;

type GitStatus = keyof typeof GIT_KEYS;
const GIT_STATUSES: readonly GitStatus[] = ["modified", "untracked", "added", "renamed", "conflict"];

/** Upstream ccdb50d10 `A`. */
const GIT_DEFAULTS: Record<Mode, Record<GitStatus, string>> =
{
	light:
	{
		modified: "#895503",
		untracked: "#007100",
		added: "#587c0c",
		renamed: "#007100",
		conflict: "#ad0707",
	},
	dark:
	{
		modified: "#e2c08d",
		untracked: "#73c991",
		added: "#81b88b",
		renamed: "#73c991",
		conflict: "#f48771",
	},
};

/** Upstream ccdb50d10 `j`: a #rgb / #rrggbb / #rrggbbaa colour as 0-1 RGBA, or undefined. */
function hexChannels(color: string): number[] | undefined
{
	const hex = color.length === 4 ? color.replace(/[^#]/g, "$&$&") : color;
	return /^#([0-9a-f]{2}){3,4}$/i.test(hex)
		? [1, 3, 5, 7].map((start) => parseInt(hex.slice(start, start + 2) || "ff", 16) / 255)
		: undefined;
}

/** Upstream ccdb50d10 `M`: relative luminance. */
function luminance([r = 0, g = 0, b = 0]: number[]): number
{
	const [lr = 0, lg = 0, lb = 0] = [r, g, b].map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** Upstream ccdb50d10 `N`: whether `color`, composited over `background`, reaches 4.5:1 contrast. */
function readableOn(color: string, background: string): boolean
{
	const fg = hexChannels(color);
	const bg = hexChannels(background);
	if (fg === undefined || bg === undefined) return false;
	const alpha = fg[3] ?? 1;
	const a = luminance(fg.map((c, i) => c * alpha + (bg[i] ?? 0) * (1 - alpha)));
	const b = luminance(bg);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5;
}

/** Upstream ccdb50d10 `P`: each git status's first readable theme colour, else the default if readable. */
function gitColors(colors: Colors, background: string, mode: Mode): [GitStatus, string | undefined][]
{
	return GIT_STATUSES.map((status) =>
	{
		const candidates = [
			...GIT_KEYS[status].map((key) => colors[`gitDecoration.${key}`]),
			GIT_DEFAULTS[mode][status],
		];
		return [
			status,
			candidates.find((color) => color !== undefined && color !== "" && readableOn(color, background)),
		];
	});
}

interface FindColors
{
	background: string;
	foreground: string | undefined;
	border: string | undefined;
}

/** Upstream c74f29bd2 `r`: a find key's colours, from the theme when it sets the background, else Claude's. */
function findKeyColors(colors: Colors, mode: Mode, key: string): FindColors
{
	const background = colors[`${key}Background`];
	const themed = background !== undefined && background !== "";
	const source = themed ? colors : CLAUDE_DEFAULT_COLORS[mode];
	return {
		background: themed ? background : claudeDefault(mode, `${key}Background`),
		foreground: source[`${key}Foreground`],
		border: source[`${key}Border`],
	};
}

const FIND_MATCH_BORDER = "color-mix(in srgb, currentColor 60%, transparent)";

/** Upstream c74f29bd2 `a`: the current match's and other matches' colours. */
function findColors(
	colors: Colors,
	mode: Mode,
):
{
	current: FindColors;
	others: FindColors;
}
{
	const current = findKeyColors(colors, mode, "editor.findMatch");
	const others = findKeyColors(colors, mode, "editor.findMatchHighlight");
	return {
		current:
		{
			...current,
			foreground: current.foreground ?? colors["editor.foreground"],
			border: current.border ?? FIND_MATCH_BORDER,
		},
		others:
		{
			...others,
			foreground: others.foreground ?? colors["editor.foreground"],
		},
	};
}

/** Upstream c74f29bd2 `o`. */
function findVars(prefix: string, light: FindColors, dark: FindColors): Record<string, string>
{
	return {
		[`${prefix}-bg`]: `light-dark(${light.background}, ${dark.background})`,
		[`${prefix}-fg`]: `light-dark(${light.foreground ?? "currentColor"}, ${dark.foreground ?? "currentColor"})`,
		[`${prefix}-border`]: `light-dark(${light.border ?? "transparent"}, ${dark.border ?? "transparent"})`,
	};
}

export interface CodeThemeColors
{
	bg: string;
	colors: Colors;
}

/** Upstream c6e73333a `E`: the values one loaded theme feeds into the var block. */
function themeValues({bg, colors}: CodeThemeColors, mode: Mode)
{
	return {
		lineNumber: colors["editorLineNumber.foreground"] ?? colors["editorWhitespace.foreground"],
		editor: bg,
		selection: colors["editor.selectionBackground"] ?? claudeDefault(mode, "editor.selectionBackground"),
		selectionMatch: selectionMatchColor(colors, mode),
		git: gitColors(colors, bg, mode),
		find: findColors(colors, mode),
	};
}

/**
 * Upstream c6e73333a `v` (with `k` and `A`): the code-theme custom properties set on a code tile for the
 * chosen light and dark themes. Undefined values (an unreadable git colour, a theme without line numbers)
 * are left out, as React drops them from upstream's inline style.
 */
export function codeThemeVars(lightTheme: CodeThemeColors, darkTheme: CodeThemeColors): Record<string, string>
{
	const light = themeValues(lightTheme, "light");
	const dark = themeValues(darkTheme, "dark");
	// Upstream sets --code-theme-bg unless CSS.supports says light-dark() is unsupported.
	const supportsLightDark = typeof CSS === "undefined" || CSS.supports("color", "light-dark(#000, #fff)");
	const gitVars = (mode: Mode, git: [GitStatus, string | undefined][]): Record<string, string | undefined> =>
		Object.fromEntries(git.map(([status, color]) => [`--code-theme-${mode}-git-${status}`, color]));
	const vars: Record<string, string | undefined> =
	{
		"--code-theme-light-bg": light.editor,
		"--code-theme-dark-bg": dark.editor,
		...gitVars("light", light.git),
		...gitVars("dark", dark.git),
		...(supportsLightDark &&
		{
			"--code-theme-bg": `light-dark(${light.editor}, ${dark.editor})`,
		}),
		"--code-theme-light-selection-bg": light.selection,
		"--code-theme-dark-selection-bg": dark.selection,
		"--code-theme-light-line-number-fg": light.lineNumber,
		"--code-theme-dark-line-number-fg": dark.lineNumber,
		"--cds-code-text-selection-bg": `light-dark(${light.selection}, ${dark.selection})`,
		"--code-theme-selection-match-bg": `light-dark(${light.selectionMatch}, ${dark.selectionMatch})`,
		...findVars("--code-theme-find-match", light.find.current, dark.find.current),
		...findVars("--code-theme-find-match-highlight", light.find.others, dark.find.others),
	};
	return Object.fromEntries(
		Object.entries(vars).filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
}
