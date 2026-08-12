import { createServerFn } from "@tanstack/react-start";
import type { ITheme } from "ghostty-web";
import { readGhosttyConfig, type GhosttyConfig } from "./ghostty/config";

const DEFAULT_FONT_FAMILY = '"JetBrains Mono", monospace';
const NERD_FONT_FALLBACKS =
  '"MesloLGS Nerd Font Mono", "MesloLGS NF Web", "JetBrains Mono", monospace';

export interface GhosttyAppearance {
  fontFamily: string;
  fontSize: number;
  theme: ITheme & {
    background: string;
    foreground: string;
  };
}

function compactTheme(theme: GhosttyConfig["theme"]): ITheme {
  const colorEntries = Object.entries(theme ?? {}).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return Object.fromEntries(colorEntries);
}

function resolveGhosttyAppearance(config: GhosttyConfig): GhosttyAppearance {
  const theme = compactTheme(config.theme);
  return {
    fontFamily: config.fontFamily
      ? `"${config.fontFamily}", ${NERD_FONT_FALLBACKS}`
      : DEFAULT_FONT_FAMILY,
    fontSize: config.fontSize ?? 13,
    theme: {
      ...theme,
      background: theme.background ?? "#111318",
      foreground: theme.foreground ?? "#e6e6e6",
    },
  };
}

export const getGhosttyAppearance = createServerFn({ method: "GET" }).handler(() =>
  resolveGhosttyAppearance(readGhosttyConfig()),
);
