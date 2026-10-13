import type {CSSProperties} from "react";
import {assertNever} from "./assert-never";

/** How the sidebar shows: docked beside main, collapsed to the floating toggle, or the phone sheet. */
export type SidebarLayout = "docked" | "collapsed" | "phone";

/** The session titlebar's row height. */
export const TITLEBAR_HEIGHT_PX = 32;

/**
 * Below 640px the "Show sidebar" toggle sits in the titlebar's lead slot, as on claude.ai/code:
 * a 24px square at the 16px page gutter, vertically centred in the 32px bar.
 */
export const PHONE_SIDEBAR_TOGGLE = {left: 16, top: 4, size: 24} as const;

/**
 * Space the main pane's top-left corner leaves for the sidebar toggle. Collapsed desktop: the
 * floating 24x24 toggle at 12,12, so the titlebar row starts at x=41 and its 32px row at y=9 to
 * line its centre up with the toggle's. Phone: the toggle fills the lead slot, so the title
 * starts 4px after it.
 */
export function topLeftClearance(layout: SidebarLayout): {start: number; top: number} | null {
	switch (layout) {
		case "docked":
			return null;
		case "collapsed":
			return {start: 41, top: 9};
		case "phone":
			return {start: PHONE_SIDEBAR_TOGGLE.left + PHONE_SIDEBAR_TOGGLE.size + 4, top: 0};
		default:
			return assertNever(layout);
	}
}

/** The clearance as CSS vars for <main>; sticky titlebars read them with a 0px fallback. */
export function topLeftClearanceStyle(layout: SidebarLayout): CSSProperties | undefined {
	const clearance = topLeftClearance(layout);
	if (!clearance) return undefined;
	return {
		"--top-left-clearance-start": `${clearance.start}px`,
		"--top-left-clearance-top": `${clearance.top}px`,
	} as CSSProperties;
}
