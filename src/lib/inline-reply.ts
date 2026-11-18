/*
 * Upstream's inline "Comment on selection" reply card, gated by GrowthBook `__gb__554343014` (or the Claude
 * Desktop app, `Gx`) as `inlineReplyEnabled` in the session view cf74bc599. It was off in the browser for
 * the live account on 2026-11-04; locally it ships on (upstream-sync M6, 11-04 Q2 answer c). With it on, the
 * selection bar's Reply (Enter while the bar shows) opens the reply card, and Reply hides for a selection
 * spanning two transcript entries. Switching it off restores Reply as a plain Excerpt attach.
 *
 * Upstream's second gate, `__gb__1533793372` (Send reply as the card's main action, no chord), is off and not
 * built: the card's Enter is Add to prompt and ⌘⏎ is Send reply.
 */
export const INLINE_REPLY_ENABLED = true;
