/*
 * Upstream's composer notice region, gated by GrowthBook `__gb__100087145` in c8642adab/cc43287c9:
 * `mce` wraps the Claude Code column in the notice provider and region (`gce`) only when
 * `Vg("__gb__100087145", true)` is on, latched per mountKey. Bands then register by slot and stack
 * in NOTICE_ORDER inside one polite status list; with the gate off each band renders its legacy
 * markup inline in its own slot. The gate was `{defaultValue:false}` for the live account on
 * 2026-10-20 and 2026-11-03; locally it ships on (upstream-sync M6, 11-04 Q2 answer c).
 * Switching it off restores the inline bands.
 */
export const COMPOSER_NOTICE_REGION: boolean = true;
