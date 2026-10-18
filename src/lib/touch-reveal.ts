import {useMediaQuery} from "./use-phone-sheet";

/**
 * Reveals a hover-only control on touch: coarse pointers and devices without hover never fire the
 * `group-hover` that shows it. Append to any control hidden behind `opacity-0` until hover, as
 * upstream's tool-row trail does.
 */
export const TOUCH_REVEAL =
	"pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto";

/** The devices `TOUCH_REVEAL` targets: coarse pointers or no hover at all. */
const TOUCH_QUERY = "(pointer: coarse), (hover: none)";

/** True on the devices where `TOUCH_REVEAL` shows hover-only controls, so they can join the tab order. */
export function useTouchDevice(): boolean {
	return useMediaQuery(TOUCH_QUERY);
}
