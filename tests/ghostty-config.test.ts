import { describe, expect, it } from "vite-plus/test";
import {
  GhosttyConfigSchema,
  parseGhosttyConfig,
  readGhosttyConfig,
  resolveGhosttyConfigPath,
} from "../src/lib/ghostty/config";

function errorDetails(action: () => unknown): { message: string; name: string } | null {
  try {
    action();
    return null;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { message: error.message, name: error.name };
  }
}

describe("Ghostty config", () => {
  it("parses every supported appearance setting and maps the ANSI palette", () => {
    const config = parseGhosttyConfig(`
font-family = Alice Mono
font-size = 16
background = #000000
foreground = #eeeeee
cursor-color = #dddddd
selection-background = #cccccc
selection-foreground = #111111
palette = 0=#000000
palette = 1=#110000
palette = 2=#001100
palette = 3=#111100
palette = 4=#000011
palette = 5=#110011
palette = 6=#001111
palette = 7=#aaaaaa
palette = 8=#555555
palette = 9=#ff0000
palette = 10=#00ff00
palette = 11=#ffff00
palette = 12=#0000ff
palette = 13=#ff00ff
palette = 14=#00ffff
palette = 15=#ffffff
`);

    expect(config).toStrictEqual({
      fontFamily: "Alice Mono",
      fontSize: 16,
      theme: {
        foreground: "#eeeeee",
        background: "#000000",
        cursor: "#dddddd",
        selectionBackground: "#cccccc",
        selectionForeground: "#111111",
        black: "#000000",
        red: "#110000",
        green: "#001100",
        yellow: "#111100",
        blue: "#000011",
        magenta: "#110011",
        cyan: "#001111",
        white: "#aaaaaa",
        brightBlack: "#555555",
        brightRed: "#ff0000",
        brightGreen: "#00ff00",
        brightYellow: "#ffff00",
        brightBlue: "#0000ff",
        brightMagenta: "#ff00ff",
        brightCyan: "#00ffff",
        brightWhite: "#ffffff",
      },
    });
  });

  it("returns optional-field defaults when the config file is missing", () => {
    expect(readGhosttyConfig("/tmp/test/missing-ghostty-config/config")).toStrictEqual({});
  });

  it("parses a partial config without inventing absent settings", () => {
    expect(
      parseGhosttyConfig(`
font-family = Bob Mono
background = #101010
palette = 4=#0000aa
`),
    ).toStrictEqual({
      fontFamily: "Bob Mono",
      theme: {
        background: "#101010",
        blue: "#0000aa",
      },
    });
  });

  it("ignores comments, blank lines, and unsupported Ghostty settings", () => {
    expect(
      parseGhosttyConfig(`
# Fabricated Ghostty config

  font-size = 14.5

shell-integration-features = no-title
# Another comment
`),
    ).toStrictEqual({ fontSize: 14.5 });
  });

  it("rejects malformed palette entries with their source line", () => {
    const malformedEntries = [
      "palette = -1=#000000",
      "palette = 16=#ffffff",
      "palette = 1=000000",
      "palette = 2=#12345",
    ];

    expect(
      malformedEntries.map((entry) => errorDetails(() => parseGhosttyConfig(entry))),
    ).toStrictEqual([
      {
        name: "Error",
        message: 'Invalid Ghostty palette entry on line 1: "-1=#000000"',
      },
      {
        name: "Error",
        message: 'Invalid Ghostty palette entry on line 1: "16=#ffffff"',
      },
      {
        name: "Error",
        message: 'Invalid Ghostty palette entry on line 1: "1=000000"',
      },
      {
        name: "Error",
        message: 'Invalid Ghostty palette entry on line 1: "2=#12345"',
      },
    ]);
  });

  it("rejects unknown fields at both strict schema boundaries", () => {
    expect([
      GhosttyConfigSchema.safeParse({ unknownSetting: true }).success,
      GhosttyConfigSchema.safeParse({ theme: { unknownColor: "#000000" } }).success,
    ]).toStrictEqual([false, false]);
  });

  it("resolves the config path from XDG_CONFIG_HOME before HOME", () => {
    expect([
      resolveGhosttyConfigPath({
        XDG_CONFIG_HOME: "/tmp/test/xdg",
        HOME: "/tmp/test/home",
      }),
      resolveGhosttyConfigPath({ HOME: "/tmp/test/home" }),
    ]).toStrictEqual(["/tmp/test/xdg/ghostty/config", "/tmp/test/home/.config/ghostty/config"]);
  });
});
