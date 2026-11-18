/*
 * Upstream's Artifacts row "+" at rest, gated by GrowthBook `__gb__348723301` in the nav list (shared-21):
 * `createAtRest = Vg("__gb__348723301", Z && te) && SF.has(item.id)`, where `SF` holds the artifacts nav ids
 * (`epitaxy-apps` in code mode), `Z` needs the template menu available, the row pinned and the sidebar not in
 * edit mode, and `te` latches once the sidebar has been shown. The row shell `Xx` then sets
 * `data-action-at-rest` on its wrapper, which keeps the "+" visible and clickable, pads the link clear of it,
 * and swaps the label's ellipsis for the cleared fade label. The gate was off for the live account on
 * 2026-11-05; locally it ships on (upstream-sync M6, 11-04 Q2 answer c). Switching it off restores the
 * hover-only "+".
 */
export const ARTIFACTS_CREATE_AT_REST: boolean = true;
