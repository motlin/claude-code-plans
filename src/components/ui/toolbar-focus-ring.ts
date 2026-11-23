/**
 * Upstream shared-frame's `qh`: a roving toolbar root's own focus ring, an inset accent line shown only while focus
 * parks on the root itself (keyboard reveal, rest-on-loss), never on pointer focus.
 */
export const TOOLBAR_FOCUS_RING =
	"outline-none focus-visible:outline-hidden forced-colors:focus-visible:-outline-offset-2 focus-visible:[box-shadow:inset_0_0_0_var(--cds-ring-focus-width,1px)_var(--cds-fill-accent,Highlight)]";

/** Upstream's MessageActions root: `focus-visible:rounded` plus {@link TOOLBAR_FOCUS_RING}. */
export const MESSAGE_ACTIONS_RING = `focus-visible:rounded ${TOOLBAR_FOCUS_RING}`;
