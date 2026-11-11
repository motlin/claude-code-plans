import type {ITheme} from "ghostty-web";
import {z} from "zod";
import {objectKeys} from "./narrow";
import {contrastRatio, parseHexColor, relativeLuminance, type Rgb} from "./terminal-contrast";
import type {GhosttyAppearance} from "./server-fns";

/**
 * Settings ▸ Code appearance ▸ Terminal colors. Like claude.ai/code, the
 * terminal follows the selected light/dark code theme by default; the local
 * Ghostty config's palette is the alternative.
 */
export const TerminalAppearanceSchema = z.enum(["code-theme", "ghostty"]);
export type TerminalAppearance = z.infer<typeof TerminalAppearanceSchema>;

export const DEFAULT_TERMINAL_APPEARANCE: TerminalAppearance = "code-theme";

/** The slice of a Shiki theme registration the mapper reads. */
export interface CodeThemeColors {
	colors?: Record<string, string>;
}

/** Upstream's key map `Y` (cf718f694): VS Code colour key → terminal theme field. */
const THEME_KEYS = {
	background: "editor.background",
	foreground: "terminal.foreground",
	cursor: "terminalCursor.foreground",
	cursorAccent: "terminalCursor.background",
	selectionBackground: "terminal.selectionBackground",
	selectionForeground: "terminal.selectionForeground",
	black: "terminal.ansiBlack",
	red: "terminal.ansiRed",
	green: "terminal.ansiGreen",
	yellow: "terminal.ansiYellow",
	blue: "terminal.ansiBlue",
	magenta: "terminal.ansiMagenta",
	cyan: "terminal.ansiCyan",
	white: "terminal.ansiWhite",
	brightBlack: "terminal.ansiBrightBlack",
	brightRed: "terminal.ansiBrightRed",
	brightGreen: "terminal.ansiBrightGreen",
	brightYellow: "terminal.ansiBrightYellow",
	brightBlue: "terminal.ansiBrightBlue",
	brightMagenta: "terminal.ansiBrightMagenta",
	brightCyan: "terminal.ansiBrightCyan",
	brightWhite: "terminal.ansiBrightWhite",
} as const satisfies Partial<Record<keyof ITheme, string>>;

/** Upstream's `De`: a terminal foreground below this contrast may give way to the editor's. */
const FOREGROUND_CONTRAST = 10;

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `#rgb[a]` / `#rrggbb[aa]` as lowercase `#rrggbb[aa]`, or undefined for anything else. */
function normalizeHex(color: string | undefined): string | undefined {
	if (color === undefined || !HEX_COLOR.test(color)) return undefined;
	const digits = color.slice(1).toLowerCase();
	const expanded = digits.length <= 4 ? digits.replace(/./g, (digit) => digit + digit) : digits;
	return `#${expanded}`;
}

/**
 * Ghostty's WASM core parses palette, foreground and background as 24-bit
 * integers, so those drop any alpha channel. Selection is only painted on
 * the canvas and keeps its translucency.
 */
function opaqueHex(color: string | undefined): string | undefined {
	return normalizeHex(color)?.slice(0, 7);
}

/** Upstream's colour parser `x`: `#rgb` and `#rrggbb` only, so a colour with alpha is unparseable. */
function parseOpaqueHex(color: string | undefined): Rgb | undefined {
	return color !== undefined && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? parseHexColor(color) : undefined;
}

/**
 * Upstream's `Oe`: the terminal foreground, unless it reads below 10:1 on
 * the background and the editor foreground reads better.
 */
function pickForeground(colors: Record<string, string>, background: string | undefined): string | undefined {
	const terminal = colors["terminal.foreground"];
	const editor = colors["editor.foreground"];
	if (terminal === undefined || editor === undefined) return terminal ?? editor;
	const bg = parseOpaqueHex(background);
	const terminalRgb = parseOpaqueHex(terminal);
	const editorRgb = parseOpaqueHex(editor);
	if (bg === undefined || terminalRgb === undefined || editorRgb === undefined) return terminal;
	const ratio = contrastRatio(bg, terminalRgb);
	return ratio < FOREGROUND_CONTRAST && contrastRatio(bg, editorRgb) > ratio ? editor : terminal;
}

/** Upstream's `ke`: whether `color` is darker than `than`. */
function isDarker(color: string | undefined, than: string): boolean {
	const rgb = parseOpaqueHex(color);
	const thanRgb = parseOpaqueHex(than);
	return rgb !== undefined && thanRgb !== undefined && relativeLuminance(rgb) < relativeLuminance(thanRgb);
}

/**
 * The terminal fields a code theme names, through upstream's key map `X`.
 * Applied to Claude Light or Claude Dark, this is the base every other theme
 * of that mode is merged over.
 */
export function terminalBaseFromCodeTheme(theme: CodeThemeColors): ITheme {
	const colors = theme.colors ?? {};
	const result: ITheme = {};
	for (const field of objectKeys(THEME_KEYS)) {
		const raw = colors[THEME_KEYS[field]];
		const color = field === "selectionBackground" ? normalizeHex(raw) : opaqueHex(raw);
		if (color !== undefined) result[field] = color;
	}
	return result;
}

/**
 * The terminal colors for a VS Code/Shiki theme, merged over `base` (the
 * Claude theme for the mode) as claude.ai/code's `Ae` does: keys the theme
 * names replace the base's, the foreground may fall back to the editor's,
 * selection falls back to the editor selection, and a theme without cursor
 * colours draws the cursor in its foreground over its background. Ghostty
 * paints selected text in `selectionForeground` regardless of the
 * background's alpha, so it follows the foreground unless the theme names one.
 */
export function terminalThemeFromCodeTheme(theme: CodeThemeColors, base: ITheme = {}): ITheme {
	const colors = theme.colors ?? {};
	const result: ITheme = {...base, ...terminalBaseFromCodeTheme(theme)};

	// Upstream measures against the raw colour, so a background with alpha skips the pick.
	const picked = pickForeground(colors, colors["editor.background"] ?? result.background);
	const foreground = opaqueHex(picked);
	if (foreground !== undefined) result.foreground = foreground;
	const terminalForeground = colors["terminal.foreground"];
	if (
		picked !== undefined &&
		foreground !== undefined &&
		terminalForeground !== undefined &&
		picked !== terminalForeground &&
		isDarker(result.brightWhite, picked)
	) {
		result.brightWhite = foreground;
	}

	const editorSelection = normalizeHex(colors["editor.selectionBackground"]);
	if (colors["terminal.selectionBackground"] === undefined && editorSelection !== undefined) {
		result.selectionBackground = editorSelection;
		const selectionForeground = opaqueHex(
			colors["terminal.selectionForeground"] ?? colors["editor.selectionForeground"],
		);
		if (selectionForeground === undefined) delete result.selectionForeground;
		else result.selectionForeground = selectionForeground;
	}
	if (colors["terminalCursor.foreground"] === undefined && result.foreground !== undefined) {
		result.cursor = result.foreground;
	}
	if (colors["terminalCursor.background"] === undefined && result.background !== undefined) {
		result.cursorAccent = result.background;
	}
	if (result.foreground !== undefined) result.selectionForeground ??= result.foreground;
	return result;
}

/**
 * The appearance a terminal is built with: the Ghostty config as-is, or its
 * font with the code theme's colours, keeping Ghostty's background and
 * foreground when the code theme declares neither. A Settings ▸ Code font
 * size replaces Ghostty's font size, as upstream's applies to the terminal.
 */
export function applyTerminalTheme(
	appearance: GhosttyAppearance,
	codeTheme: ITheme | null,
	codeFontSize: number | null,
): GhosttyAppearance {
	const sized = codeFontSize === null ? appearance : {...appearance, fontSize: codeFontSize};
	if (codeTheme === null) return sized;
	return {
		...sized,
		theme: {
			...codeTheme,
			background: codeTheme.background ?? appearance.theme.background,
			foreground: codeTheme.foreground ?? appearance.theme.foreground,
		},
	};
}
