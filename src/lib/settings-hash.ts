import { z } from "zod";

/** Settings dialog tabs, in nav order. Upstream deep-links them as `#settings/<tab>[/<row>]`. */
export const SettingsTabSchema = z.enum([
  "general",
  "usage",
  "claude-code",
  "transcript",
  "sessions",
  "notifications",
  "application",
  "ai-features",
  "claude-config",
  "setup",
]);

export type SettingsTab = z.infer<typeof SettingsTabSchema>;

export interface SettingsLocation {
  tab: SettingsTab;
  row: string | null;
}

const SETTINGS_HASH = /^#?settings\/([^/]+)(?:\/([a-z0-9-]*))?$/;

/** Parse a location hash (with or without the leading `#`) into a Settings tab and row. */
export function parseSettingsHash(hash: string): SettingsLocation | null {
  const match = SETTINGS_HASH.exec(hash);
  if (match === null) return null;
  const tab = SettingsTabSchema.safeParse(match[1]);
  if (!tab.success) return null;
  const row = match[2];
  return { tab: tab.data, row: row === undefined || row === "" ? null : row };
}

/** The hash (without `#`) that opens Settings on `tab`, optionally at `row`. */
export function settingsHash(tab: SettingsTab, row?: string): string {
  return row === undefined ? `settings/${tab}` : `settings/${tab}/${row}`;
}
