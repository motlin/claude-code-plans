import { describe, expect, it } from "vite-plus/test";
import type { GhosttyAppearance } from "../src/lib/server-fns";
import {
  applyTerminalTheme,
  DEFAULT_TERMINAL_APPEARANCE,
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
  theme: { background: "#1d1f21", foreground: "#c5c8c6", cursor: "#dddddd", red: "#cc6666" },
};

describe("terminalThemeFromCodeTheme", () => {
  it("maps the 16 ANSI colours, cursor and selection from terminal.* keys", () => {
    expect(terminalThemeFromCodeTheme(FULL_THEME)).toStrictEqual({
      background: "#0a0b0c",
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

  it("falls back to editor.background and editor.foreground and omits missing keys", () => {
    expect(
      terminalThemeFromCodeTheme({
        colors: {
          "editor.background": "#FFFFFF",
          "editor.foreground": "#24292eff",
          "terminal.ansiRed": "#d73a49",
          "terminal.ansiBlue": "not-a-colour",
        },
      }),
    ).toStrictEqual({
      background: "#ffffff",
      foreground: "#24292e",
      selectionForeground: "#24292e",
      red: "#d73a49",
    });
  });

  it("returns an empty theme when the code theme has no colours", () => {
    expect(terminalThemeFromCodeTheme({})).toStrictEqual({});
  });
});

describe("applyTerminalTheme", () => {
  it("keeps the Ghostty appearance untouched in ghostty mode", () => {
    expect(applyTerminalTheme(GHOSTTY, null)).toBe(GHOSTTY);
  });

  it("replaces the Ghostty colours with the code theme, keeping its font and background fallbacks", () => {
    expect(applyTerminalTheme(GHOSTTY, { red: "#d73a49", cursor: "#000000" })).toStrictEqual({
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
    }).toStrictEqual({ options: ["code-theme", "ghostty"], default: "code-theme" });
  });
});
