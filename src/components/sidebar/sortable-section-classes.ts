/** Upstream `AW()` less the web-root and session-list variants, which have no local root to match. */
export const SORTABLE_SECTION_CLASS = "df-sortable-section not-empty:[&+[data-gap-after]]:mt-2";
/** Upstream `iG`: the dragged section's pill (`.df-section-lifted::before` in globals.css). */
export const LIFTED_CLASS = "df-section-lifted";
/**
 * A folder section's wrapper: inside the session list upstream's `not-[.df-session-list_*]`
 * variant never matches, so its mt-2 gap is dead and the wrapper adds no spacing.
 */
export const SORTABLE_FOLDER_SECTION_CLASS = "df-sortable-section";
