import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ITheme } from "ghostty-web";
import { z } from "zod";

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const GhosttyThemeSchema = z
  .object({
    foreground: HexColorSchema.optional(),
    background: HexColorSchema.optional(),
    cursor: HexColorSchema.optional(),
    selectionBackground: HexColorSchema.optional(),
    selectionForeground: HexColorSchema.optional(),
    black: HexColorSchema.optional(),
    red: HexColorSchema.optional(),
    green: HexColorSchema.optional(),
    yellow: HexColorSchema.optional(),
    blue: HexColorSchema.optional(),
    magenta: HexColorSchema.optional(),
    cyan: HexColorSchema.optional(),
    white: HexColorSchema.optional(),
    brightBlack: HexColorSchema.optional(),
    brightRed: HexColorSchema.optional(),
    brightGreen: HexColorSchema.optional(),
    brightYellow: HexColorSchema.optional(),
    brightBlue: HexColorSchema.optional(),
    brightMagenta: HexColorSchema.optional(),
    brightCyan: HexColorSchema.optional(),
    brightWhite: HexColorSchema.optional(),
  })
  .strict();

export const GhosttyConfigSchema = z
  .object({
    fontFamily: z.string().trim().min(1).optional(),
    fontSize: z.number().positive().optional(),
    theme: GhosttyThemeSchema.optional(),
  })
  .strict();

export type GhosttyConfig = z.infer<typeof GhosttyConfigSchema>;

const PaletteEntrySchema = z
  .object({
    index: z
      .string()
      .regex(/^(?:[0-9]|1[0-5])$/)
      .transform((value) => Number(value)),
    color: HexColorSchema,
  })
  .strict();

const PALETTE_THEME_FIELDS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const satisfies readonly (keyof ITheme)[];

const THEME_SETTING_FIELDS = {
  background: "background",
  foreground: "foreground",
  "cursor-color": "cursor",
  "selection-background": "selectionBackground",
  "selection-foreground": "selectionForeground",
} as const satisfies Record<string, keyof ITheme>;

function parsePaletteEntry(value: string, lineNumber: number): z.infer<typeof PaletteEntrySchema> {
  const separatorIndex = value.indexOf("=");
  const result = PaletteEntrySchema.safeParse({
    index: value.slice(0, separatorIndex).trim(),
    color: value.slice(separatorIndex + 1).trim(),
  });
  if (!result.success) {
    throw new Error(`Invalid Ghostty palette entry on line ${lineNumber}: "${value}"`);
  }
  return result.data;
}

export function resolveGhosttyConfigPath(environment: NodeJS.ProcessEnv = process.env): string {
  const xdgConfigHome = environment["XDG_CONFIG_HOME"];
  const home = environment["HOME"];
  let configHome: string;
  if (xdgConfigHome) {
    configHome = xdgConfigHome;
  } else if (home) {
    configHome = join(home, ".config");
  } else {
    throw new Error("HOME must be set when XDG_CONFIG_HOME is unavailable");
  }

  return join(configHome, "ghostty", "config");
}

export function parseGhosttyConfig(contents: string): GhosttyConfig {
  const config: {
    fontFamily?: string;
    fontSize?: number;
    theme?: z.infer<typeof GhosttyThemeSchema>;
  } = {};
  const theme: z.infer<typeof GhosttyThemeSchema> = {};

  for (const [lineIndex, sourceLine] of contents.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key === "font-family") {
      config.fontFamily = value;
    } else if (key === "font-size") {
      config.fontSize = Number(value);
    } else if (key === "palette") {
      const palette = parsePaletteEntry(value, lineIndex + 1);
      const themeField = PALETTE_THEME_FIELDS[palette.index]!;
      theme[themeField] = palette.color;
    } else if (Object.hasOwn(THEME_SETTING_FIELDS, key)) {
      const themeField = THEME_SETTING_FIELDS[key as keyof typeof THEME_SETTING_FIELDS];
      theme[themeField] = value;
    }
  }

  if (Object.keys(theme).length > 0) config.theme = theme;
  return GhosttyConfigSchema.parse(config);
}

export function readGhosttyConfig(configPath: string = resolveGhosttyConfigPath()): GhosttyConfig {
  let contents: string;
  try {
    contents = readFileSync(configPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return GhosttyConfigSchema.parse({});
    }
    throw error;
  }
  return parseGhosttyConfig(contents);
}
