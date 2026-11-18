/*
 * Upstream's wide title row, gated by GrowthBook `__gb__2285377532` (shared-20 `pv7`, cc43287c9 `wd`): when it returns
 * "tall" or "short", the tile host renders a row across the top of every tile and the session header lifts into it,
 * so it spans the chat and every top pane. Upstream skips it while the side panel is tabbed, in the desktop app on
 * Windows/Linux and in a pop-out window; locally the phone sheet stands in for those. The key read as off for the live
 * account on 2026-11-06; locally it ships on as "tall" (upstream-sync M6, 11-04 Q2 answer c). `null` restores the
 * header inside the chat tile, "short" also shortens the pane header rows.
 */
export type WideTitleRowVariant = "tall" | "short";

export const WIDE_TITLE_ROW: WideTitleRowVariant | null = "tall";
