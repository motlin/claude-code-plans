/**
 * The frame around the docked composer on the session and home routes, kept in a module of its
 * own so the hard-load fallback (app-shell-fallback.tsx) paints the same boxes without pulling the
 * session page or the home composer into the shell bundle.
 */

/**
 * Upstream's rounded chat card, which holds the transcript and the composer dock. `epitaxy-chat-panel` is upstream's
 * name for it, which the session outline's gutter variants select on.
 */
export const SESSION_TILE_CLASS =
	"epitaxy-chat-panel @container flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-r7 bg-surface-2 shadow-panel-sm";

/** The session's sticky footer: the composer dock, opaque to the viewport bottom with a fade over the transcript. */
export const SESSION_FOOTER_CLASS =
	"sticky bottom-0 z-10 shrink-0 pb-[var(--session-dock-bottom,max(env(safe-area-inset-bottom),9px))] bg-surface-2 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-8 before:bg-linear-to-b before:from-transparent before:to-surface-2";

/**
 * The session dock's column, which the composer and its strips stack in. A docked approval card is the one child
 * that shrinks, down to upstream's 144px floor (208px in a tile at most 500px wide). Upstream's live dock column
 * carries no vh-max-420 tokens (2026-11-22).
 */
export const SESSION_DOCK_COLUMN_CLASS =
	"chat-dock-column relative flex flex-col gap-1.5 comfortable:gap-2 [&>*]:shrink-0 [&_.epitaxy-approval-card]:shrink supports-[flex-basis:content]:[&_.epitaxy-approval-card]:basis-[content] supports-[flex-basis:content]:[&_.epitaxy-approval-card]:h-[var(--approval-dock-floor,144px)] [.epitaxy-chat-panel_&]:[@container_tile-slot_(max-width:500px)]:[--approval-dock-floor:208px]";

/** The home composer's wrapper, inset from the tile's bottom like upstream's dock. */
export const HOME_DOCK_CLASS = "pb-[var(--home-dock-bottom,24px)]";
