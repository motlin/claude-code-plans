import type { ITheme } from "ghostty-web";
import { z } from "zod";
import type { GhosttyAppearance } from "./server-fns";

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

const ANSI_KEYS = {
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

/**
 * The terminal colors a VS Code/Shiki theme declares, as claude.ai/code maps
 * them: `terminal.*` for background, foreground, selection and the 16 ANSI
 * colours, `terminalCursor.*` for the cursor, and the editor colours when the
 * theme has no terminal background or foreground. Keys the theme leaves out
 * stay out, so Ghostty's defaults fill them. Ghostty paints selected text in
 * `selectionForeground` regardless of the background's alpha, so it follows
 * the terminal foreground unless the theme names one.
 */
export function terminalThemeFromCodeTheme(theme: CodeThemeColors): ITheme {
  const colors = theme.colors ?? {};
  const result: ITheme = {};
  const background = opaqueHex(colors["terminal.background"] ?? colors["editor.background"]);
  const foreground = opaqueHex(colors["terminal.foreground"] ?? colors["editor.foreground"]);
  const cursor = opaqueHex(colors["terminalCursor.foreground"]);
  const cursorAccent = opaqueHex(colors["terminalCursor.background"]);
  const selectionBackground = normalizeHex(colors["terminal.selectionBackground"]);
  const selectionForeground = opaqueHex(colors["terminal.selectionForeground"]) ?? foreground;

  if (background !== undefined) result.background = background;
  if (foreground !== undefined) result.foreground = foreground;
  if (cursor !== undefined) result.cursor = cursor;
  if (cursorAccent !== undefined) result.cursorAccent = cursorAccent;
  if (selectionBackground !== undefined) result.selectionBackground = selectionBackground;
  if (selectionForeground !== undefined) result.selectionForeground = selectionForeground;
  for (const [field, key] of Object.entries(ANSI_KEYS) as Array<[keyof typeof ANSI_KEYS, string]>) {
    const color = opaqueHex(colors[key]);
    if (color !== undefined) result[field] = color;
  }
  return result;
}

/**
 * The appearance a terminal is built with: the Ghostty config as-is, or its
 * font with the code theme's colours, keeping Ghostty's background and
 * foreground when the code theme declares neither.
 */
export function applyTerminalTheme(
  appearance: GhosttyAppearance,
  codeTheme: ITheme | null,
): GhosttyAppearance {
  if (codeTheme === null) return appearance;
  return {
    ...appearance,
    theme: {
      ...codeTheme,
      background: codeTheme.background ?? appearance.theme.background,
      foreground: codeTheme.foreground ?? appearance.theme.foreground,
    },
  };
}
