import type {CSSProperties} from "react";

/** The palette card's corner, shared by the loading shell and the palette. */
export const PALETTE_RADIUS = "rounded-[calc(var(--radius-composer)+0.375rem)]";

/**
 * Upstream `m8`'s backdrop drops its transition on the closing frame (`data-[ending-style]:transition-none`): the
 * palette's exit copy (`palette-exit-copy`) draws the fade instead.
 */
const BACKDROP_BASE =
	"fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[ending-style]:transition-none motion-reduce:transition-none";

/** The palette backdrop; `handoff` (the loading shell was showing) skips the fade-in so the swap doesn't flash. */
export function paletteBackdropClass(handoff: boolean): string
{
	return handoff ? BACKDROP_BASE : `${BACKDROP_BASE} data-[starting-style]:opacity-0`;
}

/**
 * Upstream's popup (`m8`) with its balanced top (`vk`): centred on a fixed 583.9px settled height, capped at 15vh
 * (sm) or 25vh (lg), so the card never jumps while the module, results or filters load. It hides on the closing
 * frame (`data-[ending-style]:hidden`); the exit copy draws the fade.
 */
export const PALETTE_POPUP_CLASS = `fixed left-1/2 z-50 -translate-x-1/2 top-[var(--cp-top)] w-[calc(100vw-2rem)] md:w-[calc(100vw-5rem)] max-w-2xl data-[ending-style]:hidden outline-none [--cp-inset:0px] [--cp-clearance:0px] [--cp-top:1rem] sm:[--cp-cap:15vh] lg:[--cp-cap:25vh] sm:[--cp-top:max(var(--cp-clearance),min(var(--cp-cap),max(calc(var(--cp-inset)+2rem),calc((100vh-var(--cp-settled-h)+var(--cp-inset))/2))))] ${PALETTE_RADIUS}`;

/** Upstream `g7`: the settled height the balanced top centres on. */
export const PALETTE_POPUP_STYLE =
{
	"--cp-settled-h": "583.9px",
} as CSSProperties;
